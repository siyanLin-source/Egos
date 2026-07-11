import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText } from "ai";

import { getAnthropicModel } from "@/lib/ai/anthropic";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import {
  containsGreetingNegativeMarker,
  getGreetingProfileFacts,
} from "@/lib/memory/injection";
import type { TimeContext } from "@/lib/memory/time-context";
import {
  formatReminderLine,
  getReminderContext,
} from "@/lib/reminders/reminders";
import { getBasicProfile } from "@/lib/profile/basic-profile";
import { containsCrisisSignal } from "@/lib/safety/crisis";
import type { Entry, ProfileFact, Reminder } from "@/lib/types";

type GreetingSupabaseClient = Pick<SupabaseClient, "from">;

const GREETING_TIMEOUT_MS = 15_000;
const GREETING_MAX_CHARS = 80;

// 问候只允许引用中性/积极情绪的近事；负面情绪（低落/烦躁/焦虑）一律不进。
const GREETING_SAFE_EMOTIONS = ["开心", "平静", "感动"];
const GREETING_RECENT_DAYS = 14;

// 系统腔/档案腔：问候里出现任何一个就整条作废，走兜底。
const GREETING_BANNED_PHRASES = [
  "根据记录",
  "根据我的记忆",
  "数据显示",
  "档案",
  "记录显示",
  "系统",
  "作为你的",
  "我是一个",
  "很高兴认识你",
];

export type GreetingMaterial = {
  facts: ProfileFact[];
  recentEntry: Entry | null;
  nickname: string | null;
  upcomingReminders: Reminder[];
  overdueReminders: Reminder[];
};

// 取材规则（数据层过滤，双保险的第一道）：
// a. 仅「稳定 + 中性/积极」的 profile facts；
// b. 可选补充近 14 天内情绪为中性/积极的 1 条 entry 摘要；
// c. 绝对排除 is_crisis=true 与近 14 天负面情绪的 entries；
// d. 未来 24h 的待办可自然提及，过期未完成的用不带责备口吻轻问。
export async function getGreetingMaterial({
  supabase,
  userId,
}: {
  supabase: GreetingSupabaseClient;
  userId: string;
}): Promise<GreetingMaterial> {
  const since = new Date(
    Date.now() - GREETING_RECENT_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // 称呼按 fact_key 定点查询：它是用户明确填写的设置，
  // 不应该和 L1 画像的条数/字符预算竞争，被挤掉了用户会以为「填了没用」。
  const [
    facts,
    basicProfile,
    reminderContext,
    { data: entryData, error: entryError },
  ] = await Promise.all([
    getGreetingProfileFacts({ supabase, userId }),
    getBasicProfile({ supabase, userId }),
    getReminderContext({ supabase, userId, windowHours: 24, limit: 3 }),
    supabase
      .from("entries")
      .select(
        "id,user_id,summary,emotion,emotion_intensity,category,people,places,keywords,message_ids,is_crisis,created_at,updated_at",
      )
      .eq("user_id", userId)
      .eq("is_crisis", false)
      .in("emotion", GREETING_SAFE_EMOTIONS)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (entryError) {
    console.error("Could not load recent entries for greeting.", entryError);
  }

  // 情绪列合格还不够：摘要文字本身也不能带负面/敏感痕迹（第二道保险）。
  // 另外排除「平静 + 强度 ≤0.3」的条目：提取失败的兜底归档会把用户原话
  // 硬编码成这个签名入库，情绪列并不可信——宁缺勿错。
  const recentEntry =
    ((entryData ?? []) as Entry[]).find(
      (entry) =>
        entry.summary.trim() &&
        !(entry.emotion === "平静" && entry.emotion_intensity <= 0.3) &&
        !containsGreetingNegativeMarker(entry.summary) &&
        !containsCrisisSignal(entry.summary),
    ) ?? null;

  // 提醒文本是自由输入：问候是冷启动语境，除危机词（上游已滤）外，
  // 健康/负面敏感词也不进问候素材（对话内注入不受此限制）。
  const isGreetingSafeReminder = (reminder: Reminder) =>
    !containsGreetingNegativeMarker(
      `${reminder.title} ${reminder.location ?? ""}`,
    );

  return {
    facts,
    recentEntry,
    nickname: basicProfile.nickname,
    upcomingReminders: reminderContext.upcoming.filter(isGreetingSafeReminder),
    overdueReminders: reminderContext.overdue.filter(isGreetingSafeReminder),
  };
}

// 新用户 / 无素材 / 生成失败时的通用暖问候：不硬编任何个人信息。
export function fallbackGreeting(timeContext: TimeContext) {
  const optionsByTimeOfDay: Record<string, string[]> = {
    清晨: ["早呀。今天醒得还算舒服吗？", "早。新的一天，先跟你打个招呼。"],
    上午: ["上午好呀。今天过得还顺吗？", "嗨，上午好。想到你了，来打个招呼。"],
    中午: ["中午好呀，吃饭了没？", "到饭点儿了，记得好好吃一顿。"],
    下午: ["下午好。忙到哪儿了？", "嗨，下午了。累了的话歇一会儿再说。"],
    晚上: ["晚上好呀。今天过得怎么样？", "嗨，晚上好。想聊点什么都行。"],
    深夜: [
      "这么晚还醒着呀。我在呢，想聊就聊。",
      "夜深了。不着急睡的话，我陪你待一会儿。",
    ],
  };

  const options =
    optionsByTimeOfDay[timeContext.timeOfDay] ?? optionsByTimeOfDay["晚上"];

  return options[new Date().getMinutes() % options.length];
}

function buildGreetingPrompt(
  material: GreetingMaterial,
  timeContext: TimeContext,
) {
  const factLines = material.facts
    .map((fact) => `- ${fact.text.trim()}`)
    .join("\n");
  const entryLine = material.recentEntry
    ? `- ta 最近的一件小事：${material.recentEntry.summary.trim()}`
    : "";
  const upcomingLines =
    material.upcomingReminders.length > 0
      ? `ta 接下来 24 小时内的待办（可以自然带一句，像“下午还要去取电脑呢”）：\n${material.upcomingReminders
          .map((reminder) => formatReminderLine(reminder, timeContext.timezone))
          .join("\n")}`
      : "";
  const overdueLines =
    material.overdueReminders.length > 0
      ? `有到点了还没完成的事（要提的话，用不带责备的口吻轻轻问一句，像“那个 XX 后来去成了吗”，绝不催）：\n${material.overdueReminders
          .map((reminder) => formatReminderLine(reminder, timeContext.timezone))
          .join("\n")}`
      : "";
  const nicknameLine = material.nickname
    ? `你平时叫 ta「${material.nickname}」，打招呼时可以用这个称呼。`
    : "";
  const materialBlock = [factLines, entryLine, upcomingLines, overdueLines]
    .filter(Boolean)
    .join("\n");

  return `${timeContext.line}。
${nicknameLine}

你要给 ta 发这段对话的第一条消息——像老朋友随手发来的一句微信，先开口打招呼。

可以取材的真实素材（挑一个自然的用，别硬塞、别全用）：
${materialBlock}

要求：
- 一到两句话，轻而具体，总共不超过 40 个字。
- 至多一个轻问题，或者干脆不问。
- 按当前时间调整口吻：清晨轻快别吵，深夜放轻放软。
- 不提伤心事、不提负面近况、不聊健康敏感话题。
- 别自我介绍，别说"我记得/根据记录"，你们本来就认识。
- 只输出这条消息本身，不要引号、不要解释。`;
}

function sanitizeGreetingText(raw: string) {
  const text = raw
    .trim()
    // 引号剥除必须覆盖中文弯引号（“”‘’），模型最常用这种包裹。
    .replace(/^["'“”‘’「『]+/, "")
    .replace(/["'“”‘’」』]+$/, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();

  if (!text || text.length > GREETING_MAX_CHARS) {
    return null;
  }

  if (containsCrisisSignal(text) || containsGreetingNegativeMarker(text)) {
    return null;
  }

  if (GREETING_BANNED_PHRASES.some((phrase) => text.includes(phrase))) {
    return null;
  }

  // 「至多一个轻问题」：两个问号以上说明模型开始盘问了，作废走兜底。
  const questionCount = (text.match(/[?？]/g) ?? []).length;

  if (questionCount > 1) {
    return null;
  }

  return text;
}

// 生成开屏问候文本。素材为空直接走通用暖问候；AI 失败/超时/输出越界也走兜底。
// 永远返回一条可用的问候，不抛错。
export async function generateGreetingText({
  material,
  timeContext,
}: {
  material: GreetingMaterial;
  timeContext: TimeContext;
}) {
  const hasMaterial =
    material.facts.length > 0 ||
    material.recentEntry !== null ||
    material.upcomingReminders.length > 0 ||
    material.overdueReminders.length > 0;

  if (!hasMaterial) {
    return fallbackGreeting(timeContext);
  }

  try {
    const { text } = await generateText({
      model: getAnthropicModel(),
      system: SYSTEM_PROMPT,
      prompt: buildGreetingPrompt(material, timeContext),
      maxOutputTokens: 200,
      abortSignal: AbortSignal.timeout(GREETING_TIMEOUT_MS),
    });

    return sanitizeGreetingText(text) ?? fallbackGreeting(timeContext);
  } catch (error) {
    console.error("Greeting generation failed; using fallback.", error);
    return fallbackGreeting(timeContext);
  }
}
