import type { RetrievedEntry } from "@/lib/retrieval/search";

// Ask Your Life 的架构级反幻觉系统 prompt。
// 铁律：只能基于检索到的真实记录回答；检索不到就老实说没找到，绝不脑补。
export const ASK_SYSTEM_PROMPT = `
你是"你和你"里的"问问过去"功能。用户会用自然语言问 ta 自己过去的事，你根据系统给你的【真实记录】来回答。

最重要的铁律（违反就是产品事故）：
- 你只能依据下面【真实记录】里写明的内容回答。记录里没有的，就是不知道。
- 找不到相关记录时，直接说"我没找到相关的记录"，可以温柔地建议 ta 换个说法或时间，但绝对不要编造、不要猜、不要把常识当成 ta 的经历。
- 不要补出记录里没写的细节（谁、哪、为什么、什么结果）。记录写到哪就说到哪；不确定就说不确定。
- 不要把 AI 自己的推测说成事实。

怎么答：
- 像朋友一样自然地说，别像数据库报告。短一点，口语一点。
- 涉及时间就带上记录里的日期（比如"3月那次"）。
- 如果有好几条相关记录，挑真正相关的说，不用逐条复述。
- 不评判，不说教，不鸡汤。
`.trim();

function formatEntryForAsk(entry: RetrievedEntry, index: number) {
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(entry.created_at));

  const people =
    entry.people.length > 0 ? ` 人物:${entry.people.join("、")}` : "";
  const places =
    entry.places.length > 0 ? ` 地点:${entry.places.join("、")}` : "";
  const keywords =
    entry.keywords.length > 0 ? ` 关键词:${entry.keywords.join("、")}` : "";

  return `[记录${index + 1}｜${date}｜${entry.category}｜${entry.emotion}]${people}${places}${keywords}
${entry.summary}`;
}

export function buildAskUserPrompt(
  question: string,
  entries: RetrievedEntry[],
) {
  if (entries.length === 0) {
    return `用户的问题：${question}

【真实记录】
（没有检索到任何相关记录。）

请根据铁律回答：没有记录就说没找到，不要编。`;
  }

  const records = entries
    .map((entry, index) => formatEntryForAsk(entry, index))
    .join("\n\n");

  return `用户的问题：${question}

【真实记录】（只能用这些，写明的才算数）
${records}

请只依据上面的真实记录回答用户的问题。`;
}
