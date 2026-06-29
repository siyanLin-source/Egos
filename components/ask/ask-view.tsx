"use client";

import { useRef, useState } from "react";
import Link from "next/link";

type AskSource = {
  id: string;
  summary: string;
  emotion: string;
  category: string;
  created_at: string;
};

type AskTurn = {
  id: string;
  question: string;
  answer: string | null;
  sources: AskSource[];
  loading: boolean;
  error: boolean;
};

const SUGGESTIONS = [
  "我上次和妈妈是因为什么不开心？",
  "我最近都在忙些什么？",
  "我提到过想吃什么？",
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

export function AskView() {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    const trimmed = question.trim();

    if (!trimmed || pending) {
      return;
    }

    const turnId = `${Date.now()}-${turns.length}`;
    setTurns((prev) => [
      ...prev,
      { id: turnId, question: trimmed, answer: null, sources: [], loading: true, error: false },
    ]);
    setInput("");
    setPending(true);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      if (!response.ok) {
        throw new Error(`Ask failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        answer?: string;
        sources?: AskSource[];
      };

      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                answer: data.answer ?? "我没找到相关的记录。",
                sources: data.sources ?? [],
                loading: false,
              }
            : turn,
        ),
      );
    } catch (askError) {
      console.error("Ask Your Life request failed.", askError);
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === turnId
            ? { ...turn, loading: false, error: true }
            : turn,
        ),
      );
    } finally {
      setPending(false);
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      });
    }
  }

  return (
    <main className="flex h-dvh flex-col bg-[#f7f4ef] text-neutral-950">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-[#f7f4ef]/95 px-4 py-3 backdrop-blur sm:px-6">
        <div>
          <h1 className="text-base font-semibold">问问过去</h1>
          <p className="text-xs text-neutral-500">
            用大白话问，我只根据你真实的记录回答
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 transition hover:bg-neutral-50"
          >
            回聊天
          </Link>
          <Link
            href="/archive"
            className="rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-700 ring-1 ring-neutral-200 transition hover:bg-neutral-50"
          >
            档案
          </Link>
        </div>
      </header>

      <section className="flex-1 overflow-y-auto px-3 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {turns.length === 0 ? (
            <div className="mt-16 text-center">
              <p className="text-xl font-semibold text-neutral-950">
                想知道自己以前说过什么？
              </p>
              <p className="mt-2 text-sm leading-6 text-neutral-500">
                问我，我只会照着你真实的记录答；查不到我会直说没找到。
              </p>
              <div className="mt-6 flex flex-col items-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => ask(suggestion)}
                    disabled={pending}
                    className="rounded-full bg-white px-4 py-2 text-sm text-neutral-700 ring-1 ring-neutral-200 transition hover:bg-neutral-50 disabled:opacity-40"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            turns.map((turn) => (
              <div key={turn.id} className="flex flex-col gap-3">
                <div className="self-end rounded-2xl bg-neutral-950 px-4 py-2 text-sm text-white">
                  {turn.question}
                </div>

                <div className="self-start max-w-[90%]">
                  {turn.loading ? (
                    <div className="rounded-2xl bg-white px-4 py-3 text-sm text-neutral-400 ring-1 ring-neutral-200">
                      想一下…
                    </div>
                  ) : turn.error ? (
                    <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 ring-1 ring-red-100">
                      刚才没查成，可能是网络或 key 的问题，等下再试一次。
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="whitespace-pre-wrap rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-neutral-900 ring-1 ring-neutral-200">
                        {turn.answer}
                      </div>

                      {turn.sources.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          <p className="pl-1 text-xs text-neutral-400">
                            依据这些记录（点开可回看）
                          </p>
                          {turn.sources.map((source) => (
                            <Link
                              key={source.id}
                              href={`/archive/${source.id}`}
                              className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-700 transition hover:border-neutral-300 hover:bg-neutral-50"
                            >
                              <div className="mb-1 flex items-center gap-2 text-[11px] text-neutral-400">
                                <span>{formatDate(source.created_at)}</span>
                                <span>·</span>
                                <span>{source.category}</span>
                                <span>·</span>
                                <span>{source.emotion}</span>
                              </div>
                              <div className="leading-5 text-neutral-800">
                                {source.summary}
                              </div>
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}

          <div ref={bottomRef} />
        </div>
      </section>

      <form
        className="shrink-0 border-t border-neutral-200 px-4 py-4 sm:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          ask(input);
        }}
      >
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={pending}
            placeholder="问问你自己的过去…"
            className="h-12 flex-1 rounded-full border border-neutral-200 bg-white px-5 text-sm outline-none focus:border-neutral-400 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="h-12 shrink-0 rounded-full bg-neutral-950 px-5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            问
          </button>
        </div>
      </form>
    </main>
  );
}
