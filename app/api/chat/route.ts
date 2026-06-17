import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { after } from "next/server";
import { NextResponse } from "next/server";

import { getAnthropicModel } from "@/lib/ai/anthropic";
import { processArchiveAfterTurn } from "@/lib/archive/archive-event";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { getUiMessageText } from "@/lib/safety/crisis";
import { createClient } from "@/lib/supabase/server";
import type { Message } from "@/lib/types";

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

  const { data: userMessage, error: userMessageError } = await supabase
    .from("messages")
    .insert({
      user_id: user.id,
      sender: "user",
      content: userText,
    })
    .select("id,user_id,sender,content,image_url,created_at")
    .single();

  if (userMessageError || !userMessage) {
    return NextResponse.json(
      { error: "Could not save user message." },
      { status: 500 },
    );
  }

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model: getAnthropicModel(),
    system: SYSTEM_PROMPT,
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
            user_id: user.id,
            sender: "ai",
            content: assistantText,
          })
          .select("id,user_id,sender,content,image_url,created_at")
          .single();

      if (assistantMessageError || !assistantMessage) {
        console.error("Could not save assistant message.", assistantMessageError);
        return;
      }

      after(async () => {
        try {
          await processArchiveAfterTurn({
            supabase,
            userId: user.id,
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
