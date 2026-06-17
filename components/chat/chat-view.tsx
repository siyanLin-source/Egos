"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";

import { MessageBubble } from "@/components/chat/message-bubble";
import { MessageComposer } from "@/components/chat/message-composer";
import type { Message } from "@/lib/types";

function toUiMessage(message: Message): UIMessage {
  return {
    id: message.id,
    role: message.sender === "user" ? "user" : "assistant",
    metadata: {
      createdAt: message.created_at,
    },
    parts: [
      {
        type: "text",
        text: message.content,
      },
    ],
  };
}

export function ChatView({
  initialMessages,
  userEmail,
}: {
  initialMessages: Message[];
  userEmail: string;
}) {
  const initialUiMessages = useMemo(
    () => initialMessages.map(toUiMessage),
    [initialMessages],
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);
  const { messages, sendMessage, status, stop, error } = useChat({
    messages: initialUiMessages,
    transport,
  });
  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  return (
    <main className="flex h-dvh flex-col bg-[#f7f4ef] text-neutral-950">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-[#f7f4ef]/95 px-4 py-3 backdrop-blur sm:px-6">
        <div>
          <h1 className="text-base font-semibold">你和你</h1>
          <p className="text-xs text-neutral-500">
            {userEmail ? userEmail : "已登录"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/archive"
            className="rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 transition hover:bg-neutral-50"
          >
            档案
          </Link>
          <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
            在线
          </div>
        </div>
      </header>

      <section className="flex-1 overflow-y-auto px-3 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {messages.length === 0 ? (
            <div className="mt-24 text-center">
              <p className="text-2xl font-semibold text-neutral-950">欸，来了。</p>
              <p className="mt-3 text-sm leading-6 text-neutral-500">
                今天先随便聊两句吧，不用组织语言。
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))
          )}

          {error ? (
            <p className="self-center rounded-full bg-red-50 px-3 py-1 text-sm text-red-600">
              刚才回复失败了。可能是 API key 或网络问题，我们等下查一下。
            </p>
          ) : null}

          <div ref={bottomRef} />
        </div>
      </section>

      <MessageComposer
        disabled={status === "streaming" || status === "submitted"}
        isStreaming={isStreaming}
        onSend={(text) => {
          sendMessage({
            parts: [{ type: "text", text }],
          });
        }}
        onStop={stop}
      />
    </main>
  );
}
