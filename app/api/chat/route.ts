import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAnthropicModel } from "@/lib/ai/anthropic";
import { processArchiveAfterTurn } from "@/lib/archive/archive-event";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { ensureCurrentConversation } from "@/lib/conversations";
import { formatCoreProfile, getCoreProfile } from "@/lib/memory/injection";
import { getTimeContext, type TimeContext } from "@/lib/memory/time-context";
import {
  createReminder,
  formatReminderLine,
  getReminderContext,
} from "@/lib/reminders/reminders";
import { searchEntries } from "@/lib/retrieval/search";
import { containsCrisisSignal, getUiMessageText } from "@/lib/safety/crisis";
import { getUserTimezone } from "@/lib/settings/user-settings";
import { createClient } from "@/lib/supabase/server";
import type { Entry, Message, ProfileFact, Reminder, Topic } from "@/lib/types";

// 实时记忆召回（Sprint 4）：相似度低于这个值的旧记忆不注入，避免 TA 引用牵强的记忆。
const MEMORY_RECALL_MIN_SIMILARITY = 0.3;

// 危机兜底（红线 #2）：用户消息命中急性信号时，强化一次系统提示，
// 确保 TA 用自己的话自然提一次 12356——只在语气里，绝不弹 UI 卡片。
const CRISIS_REINFORCEMENT = `
【此刻需要特别注意】
用户这条消息里出现了强烈痛苦或自伤倾向的信号。请务必：先稳稳接住、共情，不连环追问；
在这一轮里用你自己温柔的话自然地提一次全国统一心理援助热线 12356（免费、24 小时、可匿名），提一次就够。
不要弹任何卡片式格式，不要承诺保密或"一定没事"，之后安静地陪着。`;

export const maxDuration = 30;
export const runtime = "nodejs";

function formatMemoryDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

const RECENT_CONTEXT_DAYS = 14;
const RECENT_CONTEXT_LIMIT = 8;

function formatRecentEntry(entry: Entry) {
  const parts = [
    formatMemoryDate(entry.created_at),
    entry.category,
    entry.emotion,
  ];
  const people = entry.people.length > 0 ? `人: ${entry.people.join("、")}` : "";
  const keywords =
    entry.keywords.length > 0 ? `关键词: ${entry.keywords.join("、")}` : "";

  return `- [${parts.join(" / ")}] ${entry.summary}${
    people || keywords ? `（${[people, keywords].filter(Boolean).join("；")}）` : ""
  }`;
}

function buildRecentContext(recentEntries: Entry[]) {
  if (recentEntries.length === 0) {
    return "暂无最近事件。";
  }

  return recentEntries.map(formatRecentEntry).join("\n");
}

function buildRelevantMemories(relevantEntries: Entry[]) {
  if (relevantEntries.length === 0) {
    return "";
  }

  const lines = relevantEntries.map(formatRecentEntry).join("\n");

  return `

【相关记忆（按和用户这条消息的相关度召回，可能来自很久以前）】
这些是数据库里和用户当前这句话最相关的旧事件。如果接得自然，可以像朋友一样轻轻提一句（"你这状态，跟你上次那回有点像"）；但只能引用摘要里写明的事实，绝不补出没写明的细节。引错记忆比不提更伤信任——不确定就别提具体细节，也不要硬塞。
${lines}`;
}

// 记忆使用规则（固定文案）：追加在所有记忆区块之后，约束"怎么用"而不是"有什么"。
const MEMORY_USAGE_RULES = `# 记忆使用规则
1. 把上面的记忆自然织入对话，像老朋友随口想起，而不是背档案。
2. 禁止「根据记录」「根据我的记忆」「数据显示」这类表述。
3. 不罗列日期，不列清单。
4. 记忆和用户此刻说的矛盾时，以用户此刻说的为准，可以自然地求证一句。
5. 近期负面与敏感的内容不要主动提起，用户先开口才接。`;

// 提醒工具使用规则（追加段，人格条款一字不改）。
const REMINDER_TOOL_RULES = `# 提醒工具使用规则
1. 仅当用户表达了未来要做的具体事情、且有提醒意图（“提醒我 / 别让我忘了”）或接受了你的提醒提议时，才调用 create_reminder。随口聊计划不等于要提醒。
2. 信息不全时优先提议默认值而不是追问：没说时间就提议一个（“要不我明早 9 点提醒你？”）。一次回复最多一个问题的规则继续适用。
3. due_at 必须是带时区偏移的 ISO 8601 时间；用上面给你的当前时间推算“明天 / 下午三点”这类说法。
4. 创建成功后用一句自然的话确认（“好，明天下午三点提醒你去取电脑”），不复述参数，不出现“已为您创建提醒”式系统腔。
5. 工具返回错误时（时间已过去 / 解析不了），把问题自然地向用户确认，不要念错误原文。`;

function buildUpcomingRemindersSection(
  reminders: Reminder[],
  timezone: string,
) {
  if (reminders.length === 0) {
    return "";
  }

  const lines = reminders
    .map((reminder) => formatReminderLine(reminder, timezone))
    .join("\n");

  return `

【近期待办】ta 接下来 24 小时内的提醒事项。相关话题聊到时可以自然带一句，别整段复述：
${lines}`;
}

function buildSystemPrompt(
  coreProfile: ProfileFact[],
  personTopics: Topic[],
  recentEntries: Entry[],
  relevantEntries: Entry[],
  inCrisis: boolean,
  openingLines: string[],
  timeContext: TimeContext,
  upcomingReminders: Reminder[],
) {
  const people =
    personTopics.length > 0
      ? personTopics
          .map((topic) => {
            return `- ${topic.name}（提到 ${topic.mention_count} 次）`;
          })
          .join("\n")
      : "暂无稳定人物线索。";
  const recentContext = buildRecentContext(recentEntries);
  const relevantMemories = buildRelevantMemories(relevantEntries);
  const crisis = inCrisis ? `\n${CRISIS_REINFORCEMENT}` : "";
  // 开屏问候是会话里 TA 先说的话。Anthropic 要求 messages 首条必须是 user，
  // 所以问候不能留在消息序列里，改为在这里告诉 TA 自己刚开的场。
  const opening =
    openingLines.length > 0
      ? `\n\n【这段对话是你先开的场，你刚说了】\n${openingLines
          .map((line) => `“${line}”`)
          .join("\n")}\n用户正是在回应这句话，接着聊就好，不要重复打招呼。`
      : "";

  const upcoming = buildUpcomingRemindersSection(
    upcomingReminders,
    timeContext.timezone,
  );

  // 组装顺序（固定）：人格规则 → L1 画像 → L2 近况 → 记忆/提醒使用规则。
  return `${SYSTEM_PROMPT}

${timeContext.line}。

${formatCoreProfile(coreProfile)}

# TA 的近况
下面是最近几天/最近几条已经归档的事件摘要，是短期情景记忆。用户提到"刚才/刚刚/之前那件事/那个海鲜/那家店"这类相关线索时，可以自然接上；不相关时不要主动逐条复述。只能引用摘要里写明的事实，不要补出谁做的、地点、关系或动机；缺细节就说只记得大概。
${recentContext}${upcoming}

【人物线索】这些是对话里出现过的人物称呼，只能作为称呼线索，不能扩展关系细节。
${people}${relevantMemories}${opening}

${MEMORY_USAGE_RULES}

${REMINDER_TOOL_RULES}${crisis}`;
}

// 落库用的回复文本：多段文字用换行连接（工具轮前后两段直接拼会粘连）；
// 纯工具调用无文字时，从成功的提醒结果合成一句兜底确认，避免
// 「提醒已创建但对话历史无痕」。
function extractAssistantReply(message: UIMessage) {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n");

  if (text) {
    return text;
  }

  for (const part of message.parts) {
    const toolPart = part as {
      type: string;
      state?: string;
      output?: { ok?: boolean; title?: string; due_at_local?: string };
    };

    if (
      toolPart.type === "tool-create_reminder" &&
      toolPart.state === "output-available" &&
      toolPart.output?.ok &&
      toolPart.output.title &&
      toolPart.output.due_at_local
    ) {
      return `好，${toolPart.output.due_at_local} 提醒你${toolPart.output.title}。`;
    }
  }

  return "";
}

// Anthropic Messages API 要求首条消息必须是 user 角色。
// 会话以 TA 的开屏问候开头时，把打头的 assistant 消息从序列里剥掉，
// 文本交给 system prompt 转述，否则问候之后的每一次对话都会被 API 400 拒绝。
function splitLeadingAssistantMessages(modelMessages: ModelMessage[]) {
  let firstUserIndex = 0;

  while (
    firstUserIndex < modelMessages.length &&
    modelMessages[firstUserIndex].role === "assistant"
  ) {
    firstUserIndex += 1;
  }

  const openingLines = modelMessages
    .slice(0, firstUserIndex)
    .map((message) => {
      if (typeof message.content === "string") {
        return message.content.trim();
      }

      return message.content
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("")
        .trim();
    })
    .filter(Boolean);

  return { openingLines, chatMessages: modelMessages.slice(firstUserIndex) };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = claims.sub;

  const body = (await request.json()) as {
    messages?: UIMessage[];
    conversationId?: string;
  };
  const messages = body.messages ?? [];
  const lastMessage = messages.at(-1);

  if (!lastMessage || lastMessage.role !== "user") {
    return NextResponse.json(
      { error: "Last message must be from the user." },
      { status: 400 },
    );
  }

  const userText = getUiMessageText(lastMessage);

  if (!userText) {
    return NextResponse.json(
      { error: "Message cannot be empty." },
      { status: 400 },
    );
  }

  const currentConversation = await ensureCurrentConversation({
    supabase,
    userId,
  });
  const conversationId =
    body.conversationId === currentConversation.id
      ? body.conversationId
      : currentConversation.id;

  const { data: userMessage, error: userMessageError } = await supabase
    .from("messages")
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      sender: "user",
      content: userText,
    })
    .select("id,user_id,conversation_id,sender,content,image_url,created_at")
    .single();

  if (userMessageError || !userMessage) {
    return NextResponse.json(
      { error: "Could not save user message." },
      { status: 500 },
    );
  }

  // ignoreIncompleteToolCalls：用户中途停止/断网会在 useChat 状态里留下
  // 有入参无结果的工具 part，直接转换会产生未配对的 tool_use → Anthropic 400，
  // 且这个 400 会让该会话此后每条消息都失败。
  const modelMessages = await convertToModelMessages(messages, {
    ignoreIncompleteToolCalls: true,
  });
  const { openingLines, chatMessages } =
    splitLeadingAssistantMessages(modelMessages);
  // L1（核心画像）与 L2（近况）等注入源全部并行获取，不叠加串行延迟。
  const [
    coreProfile,
    timezone,
    reminderContext,
    { data: personTopicData, error: personTopicError },
    { data: recentEntryData, error: recentEntryError },
    relevantResult,
  ] = await Promise.all([
    getCoreProfile({ supabase, userId }),
    getUserTimezone({ supabase, userId }),
    getReminderContext({ supabase, userId, windowHours: 24, limit: 3 }),
    supabase
      .from("topics")
      .select(
        "id,user_id,type,name,first_mentioned_at,last_mentioned_at,mention_count,facts,created_at,updated_at",
      )
      .eq("user_id", userId)
      .eq("type", "person")
      .order("mention_count", { ascending: false })
      .limit(24),
    supabase
      .from("entries")
      .select(
        "id,user_id,summary,emotion,emotion_intensity,category,people,places,keywords,message_ids,is_crisis,created_at,updated_at",
      )
      .eq("user_id", userId)
      .eq("is_crisis", false)
      .gte(
        "created_at",
        new Date(
          Date.now() - RECENT_CONTEXT_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString(),
      )
      .order("created_at", { ascending: false })
      .limit(RECENT_CONTEXT_LIMIT),
    // Sprint 4：实时语义召回——按和这条消息的相关度找回旧记忆（可能跨越很久）。
    searchEntries({
      supabase,
      userId,
      query: userText,
      matchCount: 6,
    }),
  ]);

  if (personTopicError) {
    console.error("Could not load person topics for chat memory.", personTopicError);
  }

  if (recentEntryError) {
    console.error("Could not load recent entries for chat context.", recentEntryError);
  }

  // is_crisis 标志由归档侧的窄词表打标，可能漏掉会话级危机词表里的表达
  // （如"撑不下去"）。注入面在这里对 summary 再做一次内容级复检兜底。
  const recentEntries = ((recentEntryData ?? []) as Entry[]).filter(
    (entry) => !containsCrisisSignal(entry.summary),
  );
  const recentIds = new Set(recentEntries.map((entry) => entry.id));
  // 只注入真正相关的旧记忆：向量命中要过相似度阈值；纯"最近记录"兜底(mode=none)
  // 已经由【最近上下文】覆盖，不重复注入。也去掉和最近上下文重叠的条目。
  const relevantEntries =
    relevantResult.mode === "none"
      ? []
      : relevantResult.entries
          .filter(
            (entry) =>
              entry.similarity === null ||
              entry.similarity >= MEMORY_RECALL_MIN_SIMILARITY,
          )
          .filter((entry) => !recentIds.has(entry.id))
          .filter((entry) => !containsCrisisSignal(entry.summary))
          .slice(0, 5);
  const inCrisis = containsCrisisSignal(userText);
  const timeContext = getTimeContext(timezone);

  const result = streamText({
    model: getAnthropicModel(),
    // 客户端断开/点停止时中止服务端生成，onFinish 里 isAborted 才会为真，
    // 避免把拦腰截断的半句话落库。
    abortSignal: request.signal,
    system: buildSystemPrompt(
      coreProfile,
      (personTopicData ?? []) as Topic[],
      recentEntries,
      relevantEntries,
      inCrisis,
      openingLines,
      timeContext,
      reminderContext.upcoming,
    ),
    messages: chatMessages,
    tools: {
      create_reminder: tool({
        description:
          "为用户创建一个提醒事项。仅在用户表达了未来要做的具体事情、且有提醒意图或接受了提醒提议时使用。",
        inputSchema: z.object({
          title: z.string().describe("要提醒的事，一句话，例如「去取电脑」"),
          due_at: z
            .string()
            .describe(
              "到期时间，ISO 8601 且必须带时区偏移，例如 2026-07-13T15:00:00+08:00",
            ),
          location: z.string().optional().describe("地点（可选）"),
          notes: z.string().optional().describe("备注（可选）"),
        }),
        execute: async ({ title, due_at, location, notes }) => {
          const created = await createReminder({
            supabase,
            userId,
            input: {
              title,
              dueAt: due_at,
              location: location ?? null,
              notes: notes ?? null,
              source: "chat",
              sourceConversationId: conversationId,
            },
          });

          if (!created.ok) {
            return { ok: false, error: created.error };
          }

          const dueAtLocal = new Intl.DateTimeFormat("zh-CN", {
            timeZone: timeContext.timezone,
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            hourCycle: "h23",
          }).format(new Date(created.reminder.due_at));

          return {
            ok: true,
            title: created.reminder.title,
            due_at_local: dueAtLocal,
          };
        },
      }),
    },
    // 工具调用后要继续生成确认文本：给 3 步封顶（调用 → 结果 → 收尾）。
    stopWhen: stepCountIs(3),
  });

  // onError 与 onFinish 在流出错时会先后触发：这里用标记保证
  // 「删用户消息」和「落库部分回复」不会同时发生（否则会产生幽灵对话）。
  let streamFailed = false;

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onError: (error) => {
      streamFailed = true;
      console.error("Chat stream failed before a reply was saved.", error);
      // 生成失败：删掉刚插入、永远不会有回复的孤儿用户消息，
      // 否则它会污染可见历史，并被后台归档当成素材产出垃圾 Entry。
      void supabase
        .from("messages")
        .delete()
        .eq("id", userMessage.id)
        .eq("user_id", userId);

      return "刚才回复失败了，再发一次试试。";
    },
    onFinish: async ({ responseMessage, isAborted }) => {
      if (isAborted || streamFailed) {
        return;
      }

      const assistantText = extractAssistantReply(responseMessage);

      if (!assistantText) {
        return;
      }

      const { data: assistantMessage, error: assistantMessageError } =
        await supabase
          .from("messages")
          .insert({
            user_id: userId,
            conversation_id: conversationId,
            sender: "ai",
            content: assistantText,
          })
          .select("id,user_id,conversation_id,sender,content,image_url,created_at")
          .single();

      if (assistantMessageError || !assistantMessage) {
        console.error("Could not save assistant message.", assistantMessageError);
        return;
      }

      after(async () => {
        try {
          await processArchiveAfterTurn({
            supabase,
            userId,
            userMessage: userMessage as Message,
            assistantMessage: assistantMessage as Message,
          });
        } catch (error) {
          console.error("Archive processing failed.", error);
        }
      });
    },
  });
}
