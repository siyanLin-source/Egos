import type { SupabaseClient } from "@supabase/supabase-js";

import { containsCrisisSignal } from "@/lib/safety/crisis";
import type { Reminder } from "@/lib/types";

type RemindersSupabaseClient = Pick<SupabaseClient, "from">;

export const REMINDER_COLUMNS =
  "id,user_id,title,due_at,location,notes,status,source,source_conversation_id,created_at,completed_at";

const MAX_TITLE_LENGTH = 200;
const MAX_LOCATION_LENGTH = 100;
const MAX_NOTES_LENGTH = 500;

// 无时区偏移的 ISO 字符串会按服务器时区（Vercel=UTC）解析，
// 「明天下午三点」会静默存成晚 8 小时——必须带 Z 或 ±hh:mm。
const TIMEZONE_OFFSET_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/;

export type CreateReminderErrorCode =
  | "empty_title"
  | "title_too_long"
  | "crisis_content"
  | "unparseable_time"
  | "missing_offset"
  | "past_time"
  | "db_error";

export type CreateReminderInput = {
  title: string;
  dueAt: string;
  location?: string | null;
  notes?: string | null;
  source: "chat" | "manual";
  sourceConversationId?: string | null;
};

export type CreateReminderResult =
  | { ok: true; reminder: Reminder }
  | { ok: false; code: CreateReminderErrorCode; error: string };

// 创建提醒的统一入口：对话工具与手动添加共用。
// error 文案面向对话模型（TA 拿它向用户自然确认）；手动添加路径请按 code
// 映射成面向用户的文案（见 app/api/reminders/route.ts）。
export async function createReminder({
  supabase,
  userId,
  input,
}: {
  supabase: RemindersSupabaseClient;
  userId: string;
  input: CreateReminderInput;
}): Promise<CreateReminderResult> {
  const title = input.title?.replace(/\s+/g, " ").trim();
  const location =
    input.location?.replace(/\s+/g, " ").trim().slice(0, MAX_LOCATION_LENGTH) ||
    null;
  const notes = input.notes?.trim().slice(0, MAX_NOTES_LENGTH) || null;

  if (!title) {
    return {
      ok: false,
      code: "empty_title",
      error: "提醒内容是空的，先问清楚要提醒什么。",
    };
  }

  if (title.length > MAX_TITLE_LENGTH) {
    return {
      ok: false,
      code: "title_too_long",
      error: "提醒内容太长了，请压缩成一句话再存。",
    };
  }

  // 危机语句不固化成待办：提醒会在之后的每次注入面回流，
  // 这类内容应该留在对话里被接住，而不是变成反复出现的清单项。
  if (
    containsCrisisSignal(title) ||
    (location ? containsCrisisSignal(location) : false) ||
    (notes ? containsCrisisSignal(notes) : false)
  ) {
    return {
      ok: false,
      code: "crisis_content",
      error:
        "这条内容带着很重的情绪，不适合存成待办提醒。先回到对话里稳稳接住用户，不要再尝试创建。",
    };
  }

  if (!TIMEZONE_OFFSET_PATTERN.test(input.dueAt.trim())) {
    return {
      ok: false,
      code: "missing_offset",
      error:
        "due_at 缺少时区偏移（如 +08:00 或 Z），会被按错误时区解析。请带上偏移重新调用。",
    };
  }

  const dueAt = new Date(input.dueAt);

  if (Number.isNaN(dueAt.getTime())) {
    return {
      ok: false,
      code: "unparseable_time",
      error: `时间「${input.dueAt}」解析不了，需要向用户确认具体时间。`,
    };
  }

  if (dueAt.getTime() <= Date.now()) {
    return {
      ok: false,
      code: "past_time",
      error: "这个时间已经过去了，需要向用户确认一个未来的时间。",
    };
  }

  const { data, error } = await supabase
    .from("reminders")
    .insert({
      user_id: userId,
      title,
      due_at: dueAt.toISOString(),
      location,
      notes,
      source: input.source,
      source_conversation_id: input.sourceConversationId ?? null,
    })
    .select(REMINDER_COLUMNS)
    .single();

  if (error || !data) {
    console.error("Could not create reminder.", error);
    return {
      ok: false,
      code: "db_error",
      error: "保存提醒失败了，稍后再试一次。",
    };
  }

  return { ok: true, reminder: data as Reminder };
}

// 注入面（对话近况 / 开屏问候）不展示带危机信号的提醒文本——
// 入口校验之外的第二道保险（历史数据或绕过入口的写入）。
export function isReminderSafeForInjection(reminder: Reminder) {
  return (
    !containsCrisisSignal(reminder.title) &&
    (!reminder.location || !containsCrisisSignal(reminder.location))
  );
}

// 全部待办（due_at 升序），给待办抽屉用。
export async function getPendingReminders({
  supabase,
  userId,
}: {
  supabase: RemindersSupabaseClient;
  userId: string;
}): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from("reminders")
    .select(REMINDER_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("due_at", { ascending: true })
    .limit(100);

  if (error) {
    // reminders 表可能还没在 Supabase 应用迁移；这里静默降级，不影响主流程。
    console.error("Could not load pending reminders.", error);
    return [];
  }

  return (data ?? []) as Reminder[];
}

// 注入用：未来 windowHours 小时内到期的待办 + 已过期未完成的待办。
export async function getReminderContext({
  supabase,
  userId,
  windowHours = 24,
  limit = 3,
}: {
  supabase: RemindersSupabaseClient;
  userId: string;
  windowHours?: number;
  limit?: number;
}): Promise<{ upcoming: Reminder[]; overdue: Reminder[] }> {
  const pending = (await getPendingReminders({ supabase, userId })).filter(
    isReminderSafeForInjection,
  );
  const now = Date.now();
  const windowEnd = now + windowHours * 60 * 60 * 1000;

  const upcoming = pending
    .filter((reminder) => {
      const due = new Date(reminder.due_at).getTime();
      return due >= now && due <= windowEnd;
    })
    .slice(0, limit);

  const overdue = pending
    .filter((reminder) => new Date(reminder.due_at).getTime() < now)
    .slice(-limit);

  return { upcoming, overdue };
}

// 提醒在 prompt 里的展示格式：本地时间 + 标题（+ 地点）。
export function formatReminderLine(reminder: Reminder, timezone: string) {
  const due = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).format(new Date(reminder.due_at));
  const location = reminder.location ? `（${reminder.location}）` : "";

  return `- ${due} ${reminder.title}${location}`;
}
