import { proxyFetch } from "@/lib/ai/proxy-fetch";

// OpenAI text-embedding-3-small（1536 维）。
// 走和 Anthropic 同一套 proxyFetch，大陆环境也能直连 api.openai.com。
// 没配 OPENAI_API_KEY 或调用失败时返回 null —— 调用方必须能优雅降级
// （归档照常写入，只是没有向量；检索退回关键词/结构化方式）。

export const EMBEDDING_DIMENSIONS = 1536;

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const EMBEDDING_TIMEOUT_MS = Number(
  process.env.EMBEDDING_TIMEOUT_MS ?? 15_000,
);

export function embeddingsEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

type OpenAIEmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>;
};

async function requestEmbeddings(inputs: string[]): Promise<number[][] | null> {
  if (!embeddingsEnabled() || inputs.length === 0) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const baseUrl =
      process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const response = await proxyFetch(`${baseUrl}/embeddings`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: inputs,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI embeddings failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;
    const vectors = (data.data ?? [])
      .map((item) => item.embedding)
      .filter(
        (vector): vector is number[] =>
          Array.isArray(vector) && vector.length === EMBEDDING_DIMENSIONS,
      );

    if (vectors.length !== inputs.length) {
      throw new Error("OpenAI embeddings returned an unexpected count.");
    }

    return vectors;
  } catch (error) {
    console.error("Embedding request failed.", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// 单条文本 → 向量。失败返回 null。
export async function embedText(text: string): Promise<number[] | null> {
  const trimmed = text.trim();

  if (!trimmed) {
    return null;
  }

  const vectors = await requestEmbeddings([trimmed.slice(0, 8000)]);

  return vectors?.[0] ?? null;
}

// 批量文本 → 向量数组（顺序对应）。整批失败返回 null。
export async function embedTexts(
  texts: string[],
): Promise<(number[] | null)[] | null> {
  const cleaned = texts.map((text) => text.trim().slice(0, 8000));
  const nonEmpty = cleaned.filter(Boolean);

  if (nonEmpty.length === 0) {
    return null;
  }

  const vectors = await requestEmbeddings(nonEmpty);

  if (!vectors) {
    return null;
  }

  // 把结果对回原始位置（空字符串位置填 null）。
  let cursor = 0;
  return cleaned.map((text) => (text ? vectors[cursor++] ?? null : null));
}
