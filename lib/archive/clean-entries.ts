import type { Entry } from "@/lib/types";

// 急性痛苦原话：只按"卡片文字(summary)"判断。温和措辞的难过事正常显示，
// 只有 summary 里直接出现这些词才隐藏（吵架的温和记忆会留下）。
const ACUTE_MARKERS = [
  "想死",
  "不想活",
  "活不下去",
  "自杀",
  "自尽",
  "轻生",
  "了结自己",
  "结束生命",
  "去死",
  "自残",
  "自伤",
  "割腕",
  "跳楼",
  "绝望",
];

// 没有记忆价值的流水账/废话，显示时直接藏掉。
const FILLER_PATTERNS: RegExp[] = [
  /^在?网上.{0,5}看看/,
  /随便看看/,
  /挪车|找车位|车位紧张/,
  /询问\s*AI|确认名字是/,
];

function normalize(value: string) {
  return (value ?? "").replace(/[\s，,。.!！?？、；;：:（）()"'']/g, "");
}

export function isAcuteSummary(summary: string) {
  const normalized = normalize(summary);
  return ACUTE_MARKERS.some((marker) => normalized.includes(marker));
}

export function isFillerSummary(summary: string) {
  return FILLER_PATTERNS.some((pattern) => pattern.test(summary));
}

function charJaccard(a: string, b: string) {
  const setA = new Set(normalize(a));
  const setB = new Set(normalize(b));
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const char of setA) {
    if (setB.has(char)) {
      intersection += 1;
    }
  }
  return intersection / (setA.size + setB.size - intersection);
}

function sameDay(a: string, b: string) {
  return a.slice(0, 10) === b.slice(0, 10);
}

function sharesKeyword(a: Entry, b: Entry) {
  if (a.keywords.length === 0 || b.keywords.length === 0) {
    return false;
  }
  const setA = new Set(a.keywords.map((value) => value.trim()).filter(Boolean));
  return b.keywords.some((value) => setA.has(value.trim()));
}

// 是否共享一个 4 字以上的独特短语（如"辣炒海鲜"、"今天吃了小番茄"）。
// 这是判定"同一件事但措辞不同"最可靠的信号——纯字符相似度抓不到。
function sharesDistinctivePhrase(a: string, b: string, minLen = 4) {
  const normalizedA = normalize(a);
  const normalizedB = normalize(b);
  for (let index = 0; index + minLen <= normalizedA.length; index += 1) {
    if (normalizedB.includes(normalizedA.slice(index, index + minLen))) {
      return true;
    }
  }
  return false;
}

// 同一天、同分类，且（文字相似 / 共享关键词 / 共享独特短语）= 同一件事，只留最早那条。
function isDuplicate(a: Entry, b: Entry) {
  if (a.category !== b.category || !sameDay(a.created_at, b.created_at)) {
    return false;
  }
  return (
    charJaccard(a.summary, b.summary) >= 0.4 ||
    sharesKeyword(a, b) ||
    sharesDistinctivePhrase(a.summary, b.summary)
  );
}

// 显示时清洗：去急性原话卡 + 去废话 + 近似重复合并（留最早一条）。
export function cleanEntries(entries: Entry[]): Entry[] {
  const visible = entries.filter(
    (entry) => !isAcuteSummary(entry.summary) && !isFillerSummary(entry.summary),
  );

  const byOldest = [...visible].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

  const kept: Entry[] = [];
  for (const entry of byOldest) {
    if (!kept.some((existing) => isDuplicate(existing, entry))) {
      kept.push(entry);
    }
  }

  return kept.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
