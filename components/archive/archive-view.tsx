"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CATEGORIES, EMOTIONS } from "@/lib/archive/prompts";
import type { Entry, EntryCategory, EntryEmotion } from "@/lib/types";
import { cn } from "@/lib/utils";

type EmotionFilter = EntryEmotion | "全部";
type CategoryFilter = EntryCategory | "全部";

function getLocalDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function buildHeatmap(entries: Entry[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const counts = new Map<string, number>();

  for (const entry of entries) {
    const key = getLocalDateKey(entry.created_at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Array.from({ length: 56 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (55 - index));
    const key = getLocalDateKey(date);

    return { key, count: counts.get(key) ?? 0 };
  });
}

function heatmapColor(count: number) {
  if (count >= 4) return "bg-[#256f5b]";
  if (count === 3) return "bg-[#4b9a78]";
  if (count === 2) return "bg-[#8fc3a2]";
  if (count === 1) return "bg-[#cfe4d5]";
  return "bg-neutral-200";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ArchiveView({ entries }: { entries: Entry[] }) {
  const [emotionFilter, setEmotionFilter] = useState<EmotionFilter>("全部");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("全部");

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      const emotionMatches =
        emotionFilter === "全部"
          ? entry.emotion !== "低落"
          : entry.emotion === emotionFilter;
      const categoryMatches =
        categoryFilter === "全部" || entry.category === categoryFilter;

      return emotionMatches && categoryMatches;
    });
  }, [categoryFilter, emotionFilter, entries]);

  const heatmapDays = useMemo(() => buildHeatmap(entries), [entries]);

  return (
    <main className="min-h-dvh bg-[#f7f4ef] text-neutral-950">
      <header className="border-b border-neutral-200 bg-[#f7f4ef]/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">档案</h1>
            <p className="mt-1 text-xs text-neutral-500">
              聊天长出来的事件记录
            </p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/">回到聊天</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["全部", ...EMOTIONS] as EmotionFilter[]).map((emotion) => (
              <button
                key={emotion}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition",
                  emotionFilter === emotion
                    ? "border-neutral-950 bg-neutral-950 text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300",
                )}
                type="button"
                onClick={() => setEmotionFilter(emotion)}
              >
                {emotion}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(["全部", ...CATEGORIES] as CategoryFilter[]).map((category) => (
              <button
                key={category}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition",
                  categoryFilter === category
                    ? "border-[#256f5b] bg-[#256f5b] text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300",
                )}
                type="button"
                onClick={() => setCategoryFilter(category)}
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium">过去 8 周活跃度</p>
            <p className="text-xs text-neutral-500">{entries.length} 条 Entry</p>
          </div>
          <div className="grid grid-flow-col grid-rows-7 justify-start gap-1">
            {heatmapDays.map((day) => (
              <div
                key={day.key}
                title={`${day.key}: ${day.count} 条`}
                className={cn("size-4 rounded-[3px]", heatmapColor(day.count))}
              />
            ))}
          </div>
        </div>

        {filteredEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 bg-white px-4 py-12 text-center">
            <p className="text-sm text-neutral-500">这里暂时还没有符合筛选的记录。</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredEntries.map((entry) => {
              const calmAndLight =
                entry.emotion === "平静" && entry.emotion_intensity < 0.3;

              return (
                <Link
                  key={entry.id}
                  href={`/archive/${entry.id}`}
                  className="flex min-h-44 flex-col justify-between rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md"
                >
                  <div>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#e7efe7] px-2.5 py-1 text-xs font-medium text-[#256f5b]">
                        {entry.category}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-medium",
                          calmAndLight
                            ? "bg-neutral-100 text-neutral-400"
                            : "bg-[#fff0bf] text-[#755c00]",
                        )}
                      >
                        {entry.emotion}
                      </span>
                    </div>
                    <p className="text-[15px] leading-6 text-neutral-950">
                      {entry.summary}
                    </p>
                  </div>

                  <div className="mt-4 space-y-3">
                    {entry.people.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {entry.people.map((person) => (
                          <span
                            key={person}
                            className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600"
                          >
                            {person}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-xs text-neutral-400">
                      {formatDate(entry.created_at)}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
