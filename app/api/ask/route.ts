import { generateText } from "ai";
import { NextResponse } from "next/server";

import { getAnthropicModel } from "@/lib/ai/anthropic";
import { ASK_SYSTEM_PROMPT, buildAskUserPrompt } from "@/lib/ai/ask-prompt";
import { searchEntries, type RetrievedEntry } from "@/lib/retrieval/search";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

// 语义相似度低于这个值的命中视为"其实没那么相关"，宁可说没找到也不硬答。
const MIN_SIMILARITY = 0.25;
const NO_MATCH_ANSWER = "我没找到相关的记录。要不换个说法，或者告诉我大概是什么时候？";

function toSource(entry: RetrievedEntry) {
  return {
    id: entry.id,
    summary: entry.summary,
    emotion: entry.emotion,
    category: entry.category,
    created_at: entry.created_at,
    similarity: entry.similarity,
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
  } | null;
  const question =
    typeof body?.question === "string" ? body.question.trim() : "";

  if (!question) {
    return NextResponse.json(
      { error: "Question cannot be empty." },
      { status: 400 },
    );
  }

  const { entries, mode } = await searchEntries({
    supabase,
    userId: claims.sub,
    query: question,
    matchCount: 8,
  });

  // 只把真正相关的记录喂给模型：向量模式按相似度阈值过滤；
  // 关键词命中算相关；纯"最近记录"兜底（mode=none）不算命中，老实说没找到。
  const relevant =
    mode === "vector"
      ? entries.filter(
          (entry) =>
            entry.similarity === null || entry.similarity >= MIN_SIMILARITY,
        )
      : mode === "keyword"
        ? entries
        : [];

  if (relevant.length === 0) {
    return NextResponse.json({
      answer: NO_MATCH_ANSWER,
      sources: [],
      mode,
    });
  }

  try {
    const { text } = await generateText({
      model: getAnthropicModel(),
      system: ASK_SYSTEM_PROMPT,
      prompt: buildAskUserPrompt(question, relevant),
      temperature: 0.3,
    });

    return NextResponse.json({
      answer: text.trim() || NO_MATCH_ANSWER,
      sources: relevant.map(toSource),
      mode,
    });
  } catch (error) {
    console.error("Ask Your Life generation failed.", error);
    return NextResponse.json(
      { error: "Could not answer right now." },
      { status: 500 },
    );
  }
}
