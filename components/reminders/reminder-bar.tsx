"use client";

import { useCallback, useEffect, useState } from "react";

import type { Reminder } from "@/lib/types";
import { cn } from "@/lib/utils";

function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatDueLabel(value: string) {
  const due = new Date(value);
  const now = new Date();

  if (isSameLocalDay(due, now)) {
    return `今天 ${formatTime(value)}`;
  }

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  if (isSameLocalDay(due, tomorrow)) {
    return `明天 ${formatTime(value)}`;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).format(due);
}

function isOverdue(reminder: Reminder) {
  return new Date(reminder.due_at).getTime() < Date.now();
}

// 聊天页顶部的待办条：存在「今天到期或已过期」的 pending 提醒时出现；
// 点击展开抽屉，列出全部 pending（due_at 升序），支持完成/顺延1小时/删除 + 手动添加。
// 已过期项必须可达，否则用户永远无法完成/删除它们，而问候还会反复提起。
export const REMINDERS_CHANGED_EVENT = "egos:reminders-changed";

export function ReminderBar() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formDueAt, setFormDueAt] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/reminders");

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as { reminders?: Reminder[] };
      setReminders(data.reminders ?? []);
    } catch {
      // 提醒是辅助功能，加载失败保持静默，不打扰聊天。
    }
  }, []);

  useEffect(() => {
    void refresh();

    // 对话里经 create_reminder 新建/回到窗口时列表可能已变化，跟着刷新。
    const handleChanged = () => void refresh();
    window.addEventListener(REMINDERS_CHANGED_EVENT, handleChanged);
    window.addEventListener("focus", handleChanged);

    return () => {
      window.removeEventListener(REMINDERS_CHANGED_EVENT, handleChanged);
      window.removeEventListener("focus", handleChanged);
    };
  }, [refresh]);

  // 「今天到期」含已过期未完成：过期项不显示的话就永远清不掉了。
  const dueReminders = reminders.filter(
    (reminder) =>
      isSameLocalDay(new Date(reminder.due_at), new Date()) ||
      isOverdue(reminder),
  );

  async function act(id: string, action: "done" | "snooze" | "delete") {
    if (isBusy) {
      return;
    }

    setIsBusy(true);

    try {
      const response =
        action === "delete"
          ? await fetch(`/api/reminders/${id}`, { method: "DELETE" })
          : await fetch(`/api/reminders/${id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action }),
            });

      if (response.ok) {
        await refresh();
      }
    } catch (error) {
      console.error("Reminder action failed.", error);
    } finally {
      setIsBusy(false);
    }
  }

  async function addManualReminder() {
    if (isBusy) {
      return;
    }

    setFormError(null);

    if (!formTitle.trim() || !formDueAt) {
      setFormError("先填上要提醒的事和时间。");
      return;
    }

    // datetime-local 的值是用户本地时间，转 ISO 存 UTC。
    const dueAt = new Date(formDueAt);

    if (Number.isNaN(dueAt.getTime())) {
      setFormError("这个时间读不懂，换一个试试。");
      return;
    }

    setIsBusy(true);

    try {
      const response = await fetch("/api/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: formTitle.trim(),
          due_at: dueAt.toISOString(),
          location: formLocation.trim() || null,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setFormError(data?.error ?? "没存上，再试一次。");
        return;
      }

      setFormTitle("");
      setFormDueAt("");
      setFormLocation("");
      await refresh();
    } catch (error) {
      console.error("Could not add reminder.", error);
      setFormError("没存上，再试一次。");
    } finally {
      setIsBusy(false);
    }
  }

  // 没有今天到期/已过期的 pending：完全不渲染（抽屉打开时例外，避免操作中途 UI 消失）。
  if (dueReminders.length === 0 && !isOpen) {
    return null;
  }

  const first = dueReminders[0];

  return (
    <div className="relative shrink-0 border-b border-neutral-200 bg-[#fffdf5]">
      <button
        type="button"
        onClick={() =>
          setIsOpen((value) => {
            // 打开抽屉时刷新一次，别让用户看陈旧列表。
            if (!value) {
              void refresh();
            }
            return !value;
          })
        }
        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left sm:px-6"
      >
        <span className="flex min-w-0 items-center gap-2 text-sm text-neutral-800">
          <span aria-hidden>⏰</span>
          {first ? (
            <span className="truncate">
              {isOverdue(first)
                ? `到期未完成 · ${formatDueLabel(first.due_at)}`
                : `今天 · ${formatTime(first.due_at)}`}{" "}
              {first.title}
              {first.location ? `（${first.location}）` : ""}
            </span>
          ) : (
            <span className="truncate">待办</span>
          )}
          {dueReminders.length > 1 ? (
            <span className="shrink-0 rounded-full bg-[#f0e0b0] px-2 py-0.5 text-xs text-[#755c00]">
              +{dueReminders.length - 1}
            </span>
          ) : null}
        </span>
        <span className="shrink-0 text-xs text-neutral-400">
          {isOpen ? "收起 ▴" : "全部 ▾"}
        </span>
      </button>

      {isOpen ? (
        <div className="absolute inset-x-0 top-full z-20 max-h-[60dvh] overflow-y-auto border-b border-neutral-200 bg-white px-4 pb-4 shadow-lg sm:px-6">
          {reminders.length > 0 ? (
            <ul className="divide-y divide-neutral-100">
              {reminders.map((reminder) => (
                <li
                  key={reminder.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-neutral-900">
                      {reminder.title}
                      {reminder.location ? (
                        <span className="text-neutral-500">
                          （{reminder.location}）
                        </span>
                      ) : null}
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-xs",
                        isOverdue(reminder)
                          ? "text-[#b4540a]"
                          : "text-neutral-400",
                      )}
                    >
                      {formatDueLabel(reminder.due_at)}
                      {isOverdue(reminder) ? " · 已过期" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => act(reminder.id, "done")}
                      className="rounded-full bg-[#e7efe7] px-2.5 py-1 text-xs font-medium text-[#256f5b] transition hover:bg-[#d6f7e9] disabled:opacity-40"
                    >
                      完成
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => act(reminder.id, "snooze")}
                      className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600 transition hover:bg-neutral-200 disabled:opacity-40"
                    >
                      顺延1小时
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => act(reminder.id, "delete")}
                      className="rounded-full px-2 py-1 text-xs text-neutral-400 transition hover:text-red-600 disabled:opacity-40"
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-3 text-sm text-neutral-500">现在没有待办了。</p>
          )}

          <div className="mt-2 border-t border-neutral-100 pt-3">
            <p className="mb-2 text-xs font-medium text-neutral-500">
              + 手动添加
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={formTitle}
                onChange={(event) => setFormTitle(event.target.value)}
                placeholder="要提醒的事"
                className="min-w-0 flex-1 rounded-md border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-[#256f5b]"
              />
              <input
                type="datetime-local"
                value={formDueAt}
                onChange={(event) => setFormDueAt(event.target.value)}
                className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-[#256f5b]"
              />
              <input
                type="text"
                value={formLocation}
                onChange={(event) => setFormLocation(event.target.value)}
                placeholder="地点（可选）"
                className="min-w-0 rounded-md border border-neutral-200 px-3 py-1.5 text-sm outline-none focus:border-[#256f5b] sm:w-36"
              />
              <button
                type="button"
                disabled={isBusy}
                onClick={addManualReminder}
                className="rounded-md bg-neutral-950 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-40"
              >
                添加
              </button>
            </div>
            {formError ? (
              <p className="mt-2 text-xs text-red-600">{formError}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
