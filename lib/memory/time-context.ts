// 当前本地时间与时区：问候的口吻（清晨/深夜）和提醒的时间解析都靠它。
// 服务器永远用自己的时钟 + 用户时区来算，不信任客户端传来的时间字符串。

export const DEFAULT_TIMEZONE = "Asia/Shanghai";

export function isValidTimezone(timezone: string | null | undefined): timezone is string {
  if (!timezone) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(timezone: string | null | undefined) {
  return isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
}

type LocalTimeParts = {
  dateText: string;
  timeText: string;
  weekdayText: string;
  hour: number;
  offsetText: string;
};

// 数字偏移（如 UTC+08:00）：给模型解析「明天下午三点」用，
// 只给 IANA 名的话模型得自己记住每个时区的偏移，容易错。
function getUtcOffsetText(timezone: string, now: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    }).formatToParts(now);
    const name = parts.find((part) => part.type === "timeZoneName")?.value;

    // "GMT+08:00" → "UTC+08:00"；纯 "GMT"（UTC 本身）→ "UTC+00:00"
    if (name?.startsWith("GMT")) {
      return `UTC${name.slice(3) || "+00:00"}`;
    }

    return name ?? "";
  } catch {
    return "";
  }
}

function getLocalTimeParts(timezone: string, now = new Date()): LocalTimeParts {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(now);

  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year") ?? "";
  const month = byType.get("month") ?? "";
  const day = byType.get("day") ?? "";
  const hour = byType.get("hour") ?? "00";
  const minute = byType.get("minute") ?? "00";
  const weekday = byType.get("weekday") ?? "";

  return {
    dateText: `${year}-${month}-${day}`,
    timeText: `${hour}:${minute}`,
    weekdayText: weekday,
    hour: Number(hour),
    offsetText: getUtcOffsetText(timezone, now),
  };
}

// 「清晨/深夜」这类口吻线索，给问候生成用。
export function getTimeOfDayLabel(hour: number) {
  if (hour >= 5 && hour < 9) return "清晨";
  if (hour >= 9 && hour < 12) return "上午";
  if (hour >= 12 && hour < 14) return "中午";
  if (hour >= 14 && hour < 18) return "下午";
  if (hour >= 18 && hour < 23) return "晚上";
  return "深夜";
}

export type TimeContext = {
  timezone: string;
  // 「现在是 2026-07-12 09:30（Asia/Shanghai），今天星期六，清晨」
  line: string;
  hour: number;
  timeOfDay: string;
};

export function getTimeContext(
  timezone: string | null | undefined,
  now = new Date(),
): TimeContext {
  const resolved = resolveTimezone(timezone);
  const parts = getLocalTimeParts(resolved, now);
  const timeOfDay = getTimeOfDayLabel(parts.hour);

  const zoneLabel = parts.offsetText
    ? `${resolved}，${parts.offsetText}`
    : resolved;

  return {
    timezone: resolved,
    line: `现在是 ${parts.dateText} ${parts.timeText}（${zoneLabel}），今天${parts.weekdayText}，${timeOfDay}`,
    hour: parts.hour,
    timeOfDay,
  };
}
