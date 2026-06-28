import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { after } from "next/server";
import { NextResponse } from "next/server";

import { getAnthropicModel } from "@/lib/ai/anthropic";
import { processArchiveAfterTurn } from "@/lib/archive/archive-event";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { ensureCurrentConversation } from "@/lib/conversations";
import { getUiMessageText } from "@/lib/safety/crisis";
import { createClient } from "@/lib/supabase/server";
import type { Entry, Message, ProfileFact, Topic } from "@/lib/types";

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

function buildSystemPrompt(
  profileFacts: ProfileFact[],
  personTopics: Topic[],
  recentEntries: Entry[],
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

  if (profileFacts.length === 0) {
    return `${SYSTEM_PROMPT}

【真实记忆】
现在还没有沉淀出可用的"关于用户"事实。用户问你记不记得时，要坦诚说还没记清，不要编。

【真实记忆：人物】
${people}

【最近上下文】
下面是最近几天/最近几条已经归档的事件摘要，是短期情景记忆。用户提到"刚才/刚刚/之前那件事/那个海鲜/那家店"这类相关线索时，可以自然接上；不相关时不要主动逐条复述。只能引用摘要里写明的事实，不要补出谁做的、地点、关系或动机；缺细节就说只记得大概。
${recentContext}`;
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
${people}

【最近上下文】
下面是最近几天/最近几条已经归档的事件摘要，是短期情景记忆。用户提到"刚才/刚刚/之前那件事/那个海鲜/那家店"这类相关线索时，可以自然接上；不相关时不要主动逐条复述。只能引用摘要里写明的事实，不要补出谁做的、地点、关系或动机；缺细节就说只记得大概。
${recentContext}`;
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

  const result = streamText({
    model: getAnthropicModel(),
    system: buildSystemPrompt(
      (profileFactData ?? []) as ProfileFact[],
      (personTopicData ?? []) as Topic[],
      (recentEntryData ?? []) as Entry[],
    ),
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
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
