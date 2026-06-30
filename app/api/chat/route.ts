import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { after } from "next/server";
import { NextResponse } from "next/server";

import { getAnthropicModel } from "@/lib/ai/anthropic";
import { processArchiveAfterTurn } from "@/lib/archive/archive-event";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { ensureCurrentConversation } from "@/lib/conversations";
import { searchEntries } from "@/lib/retrieval/search";
import { containsCrisisSignal, getUiMessageText } from "@/lib/safety/crisis";
import { createClient } from "@/lib/supabase/server";
import type { Entry, Message, ProfileFact, Topic } from "@/lib/types";

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

function buildSystemPrompt(
  profileFacts: ProfileFact[],
  personTopics: Topic[],
  recentEntries: Entry[],
  relevantEntries: Entry[],
  inCrisis: boolean,
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

  if (profileFacts.length === 0) {
    return `${SYSTEM_PROMPT}

【真实记忆】
现在还没有沉淀出可用的"关于用户"事实。用户问你记不记得时，要坦诚说还没记清，不要编。

【真实记忆：人物】
${people}${relevantMemories}

【最近上下文】
下面是最近几天/最近几条已经归档的事件摘要，是短期情景记忆。用户提到"刚才/刚刚/之前那件事/那个海鲜/那家店"这类相关线索时，可以自然接上；不相关时不要主动逐条复述。只能引用摘要里写明的事实，不要补出谁做的、地点、关系或动机；缺细节就说只记得大概。
${recentContext}${crisis}`;
  }

  const facts = profileFacts
    .map((fact) => {
      return `- [${fact.kind}] ${fact.text}（${formatMemoryDate(fact.last_observed_at)}）`;
    })
    .join("\n");

  return `${SYSTEM_PROMPT}

【真实记忆：关于用户】
下面是数据库里已经沉淀的事实。你可以自然使用它们，但不要说成完整档案，也不要扩展出没有写明的细节。
${facts}

【真实记忆：人物】
这些是对话里出现过的人物称呼，只能作为称呼线索，不能扩展关系细节。
${people}${relevantMemories}

【最近上下文】
下面是最近几天/最近几条已经归档的事件摘要，是短期情景记忆。用户提到"刚才/刚刚/之前那件事/那个海鲜/那家店"这类相关线索时，可以自然接上；不相关时不要主动逐条复述。只能引用摘要里写明的事实，不要补出谁做的、地点、关系或动机；缺细节就说只记得大概。
${recentContext}${crisis}`;
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

  const modelMessages = await convertToModelMessages(messages);
  const [
    { data: profileFactData, error: profileFactError },
    { data: personTopicData, error: personTopicError },
    { data: recentEntryData, error: recentEntryError },
    relevantResult,
  ] = await Promise.all([
    supabase
      .from("profile_facts")
      .select(
        "id,user_id,kind,subject,text,importance,pinned,source_entry_id,source_message_ids,first_observed_at,last_observed_at,created_at,updated_at",
      )
      .eq("user_id", userId)
      .order("importance", { ascending: false })
      .order("last_observed_at", { ascending: false })
      .limit(24),
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

  if (profileFactError) {
    console.error("Could not load profile facts for chat memory.", profileFactError);
  }

  if (personTopicError) {
    console.error("Could not load person topics for chat memory.", personTopicError);
  }

  if (recentEntryError) {
    console.error("Could not load recent entries for chat context.", recentEntryError);
  }

  const recentEntries = (recentEntryData ?? []) as Entry[];
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
          .slice(0, 5);
  const inCrisis = containsCrisisSignal(userText);

  const result = streamText({
    model: getAnthropicModel(),
    system: buildSystemPrompt(
      (profileFactData ?? []) as ProfileFact[],
      (personTopicData ?? []) as Topic[],
      recentEntries,
      relevantEntries,
      inCrisis,
    ),
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onError: (error) => {
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
      if (isAborted) {
        return;
      }

      const assistantText = getUiMessageText(responseMessage);

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
