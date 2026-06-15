import type { UIMessage } from "ai";

export const CRISIS_KEYWORDS = [
  "想死",
  "不想活",
  "不想活了",
  "自杀",
  "自尽",
  "轻生",
  "伤害自己",
  "伤害我自己",
  "弄死自己",
  "杀了自己",
  "活不下去",
  "撑不下去",
  "撑不住了",
  "不想存在",
  "结束生命",
  "跳楼",
  "割腕",
  "吃药死",
  "一了百了",
  "离开这个世界",
  "不想醒来",
  "再也不醒",
];

export function containsCrisisSignal(text: string) {
  const normalizedText = text.toLowerCase().replace(/\s+/g, "");

  return CRISIS_KEYWORDS.some((keyword) =>
    normalizedText.includes(keyword.toLowerCase().replace(/\s+/g, "")),
  );
}

export function getUiMessageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

export function hasCrisisSignalInMessages(messages: UIMessage[]) {
  return messages.some((message) => containsCrisisSignal(getUiMessageText(message)));
}
