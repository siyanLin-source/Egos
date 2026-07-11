"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import Link from "next/link";

import { MessageBubble } from "@/components/chat/message-bubble";
import { MessageComposer } from "@/components/chat/message-composer";
import {
  ReminderBar,
  REMINDERS_CHANGED_EVENT,
} from "@/components/reminders/reminder-bar";
import { DEV_TOOLS_ENABLED } from "@/lib/dev-tools";
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
  conversationId,
}: {
  initialMessages: Message[];
  userEmail: string;
  conversationId: string;
}) {
  const initialUiMessages = useMemo(
    () => initialMessages.map(toUiMessage),
    [initialMessages],
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  // 当前会话 id 的唯一事实来源：useChat 会缓存首次创建的 transport，
  // useMemo 重建的实例不会被采用，所以请求体里的会话 id 必须在发送时动态读取。
  const currentConversationRef = useRef(conversationId);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        credentials: "include",
        prepareSendMessagesRequest: ({ messages: outgoingMessages }) => ({
          body: {
            messages: outgoingMessages,
            conversationId: currentConversationRef.current,
          },
        }),
      }),
    [],
  );
  const { messages, sendMessage, setMessages, status, stop, error } = useChat({
    messages: initialUiMessages,
    transport,
    onFinish: () => {
      // TA 可能在这一轮里创建了提醒，通知待办条刷新。
      window.dispatchEvent(new Event(REMINDERS_CHANGED_EVENT));
    },
  });
  const [isArchiving, setIsArchiving] = useState(false);
  const [isStartingConversation, setIsStartingConversation] = useState(false);
  const [showNewConversationConfirm, setShowNewConversationConfirm] =
    useState(false);
  const isStreaming = status === "streaming" || status === "submitted";
  // 每个会话只请求一次开屏问候；问候是 best-effort，失败保持静默。
  // 问候响应回来时用户可能已切到别的会话：迟到的问候只认当时的会话（currentConversationRef）。
  const greetingRequestedRef = useRef<Set<string>>(new Set());

  const requestGreeting = useCallback(
    async (targetConversationId: string) => {
      if (greetingRequestedRef.current.has(targetConversationId)) {
        return;
      }

      greetingRequestedRef.current.add(targetConversationId);

      try {
        const response = await fetch("/api/greeting", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            conversationId: targetConversationId,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as { message?: Message | null };

        if (
          !data.message ||
          currentConversationRef.current !== targetConversationId
        ) {
          return;
        }

        const greeting = toUiMessage(data.message);

        // 问候创建于会话最前面；用户若已抢先开口，就把问候排在最前，不打断。
        setMessages((current) =>
          current.some((message) => message.id === greeting.id)
            ? current
            : [greeting, ...current],
        );
      } catch (greetingError) {
        console.error("Could not load the opening greeting.", greetingError);
      }
    },
    [setMessages],
  );

  useEffect(() => {
    currentConversationRef.current = conversationId;
    setMessages(initialUiMessages);

    // 空会话（新用户首次进来 / 服务端新会话）：让 TA 先开口。
    if (initialUiMessages.length === 0) {
      void requestGreeting(conversationId);
    }
  }, [conversationId, initialUiMessages, setMessages, requestGreeting]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  async function handleArchiveNow() {
    if (isStreaming || isArchiving || messages.length === 0) {
      return;
    }

    // 归档只是后台索引，不能从 live chat 移除任何消息。
    setIsArchiving(true);
    try {
      const response = await fetch("/api/archive/flush", { method: "POST" });
      if (!response.ok) {
        throw new Error(`Archive request failed: ${response.status}`);
      }
    } catch (flushError) {
      console.error("Could not archive before starting a new chat.", flushError);
    } finally {
      setIsArchiving(false);
    }
  }

  async function handleNewConversation() {
    if (isStreaming || isStartingConversation) {
      return;
    }

    setIsStartingConversation(true);
    try {
      const response = await fetch("/api/conversations/new", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`New conversation request failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        conversationId?: string;
      };

      if (!data.conversationId) {
        throw new Error("New conversation response did not include id.");
      }

      currentConversationRef.current = data.conversationId;
      setMessages([]);
      // 新会话由 TA 先开口。
      void requestGreeting(data.conversationId);
    } catch (conversationError) {
      console.error("Could not start a new conversation.", conversationError);
    } finally {
      setIsStartingConversation(false);
    }
  }

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
          {DEV_TOOLS_ENABLED ? (
            <button
              type="button"
              onClick={handleArchiveNow}
              disabled={
                isStreaming ||
                isArchiving ||
                isStartingConversation ||
                messages.length === 0
              }
              className="rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
              title="把未归档的消息写进档案索引，不会清空聊天"
            >
              {isArchiving ? "归档中" : "归档"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              // 空对话没什么可归档的，直接开；聊过了才需要确认。
              if (messages.length === 0) {
                void handleNewConversation();
              } else {
                setShowNewConversationConfirm(true);
              }
            }}
            disabled={isStreaming || isStartingConversation || isArchiving}
            className="rounded-full bg-neutral-950 px-3 py-1 text-xs font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
            title="归档当前对话的未归档消息，然后开始一段空的新对话"
          >
            {isStartingConversation ? "开启中" : "新对话"}
          </button>
          <Link
            href="/ask"
            className="rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 transition hover:bg-neutral-50"
          >
            问问过去
          </Link>
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

      <ReminderBar />

      {showNewConversationConfirm ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-neutral-950/30 px-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <p className="text-base font-semibold text-neutral-950">
              开始新的对话？
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              刚才聊的不会丢，会由 TA 轻轻整理进档案。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewConversationConfirm(false)}
                className="rounded-full px-4 py-1.5 text-sm text-neutral-600 transition hover:bg-neutral-100"
              >
                再聊聊
              </button>
              <button
                type="button"
                disabled={isStartingConversation}
                onClick={() => {
                  setShowNewConversationConfirm(false);
                  void handleNewConversation();
                }}
                className="rounded-full bg-neutral-950 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
              >
                开始新对话
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
