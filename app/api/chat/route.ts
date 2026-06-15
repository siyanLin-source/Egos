import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { NextResponse } from "next/server";

import { getAnthropicModel } from "@/lib/ai/anthropic";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { containsCrisisSignal, getUiMessageText } from "@/lib/safety/crisis";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;
export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { messages?: UIMessage[] };
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

  const { error: userMessageError } = await supabase.from("messages").insert({
    user_id: user.id,
    sender: "user",
    content: userText,
  });

  if (userMessageError) {
    return NextResponse.json(
      { error: "Could not save user message." },
      { status: 500 },
    );
  }

  const modelMessages = await convertToModelMessages(messages);
  const hasCrisisSignal = containsCrisisSignal(userText);

  const result = streamText({
    model: getAnthropicModel(),
    system: hasCrisisSignal
      ? `${SYSTEM_PROMPT}

本轮用户可能表达了自伤、自杀或活不下去的危机信号。请保持朋友口吻,不要变成机械稿。先认真接住 TA 的难受,温柔确认 TA 现在是否安全、是否身边有人可以立刻联系;如果 TA 有立即危险,鼓励 TA 现在就联系身边真人或拨打急救电话。不要自称心理咨询师或治疗师。`
      : SYSTEM_PROMPT,
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

      await supabase.from("messages").insert({
        user_id: user.id,
        sender: "ai",
        content: assistantText,
      });
    },
  });
}
