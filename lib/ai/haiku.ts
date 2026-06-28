import { proxyFetch } from "@/lib/ai/proxy-fetch";

const AI_TIMEOUT_MS = Number(process.env.ARCHIVE_AI_TIMEOUT_MS ?? 20_000);

type AnthropicTextResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

// 复用的 Haiku 文本补全（走代理）。失败返回 null，调用方自行兜底。
export async function completeWithHaiku(
  prompt: string,
  { maxTokens = 400, temperature = 0.3 }: { maxTokens?: number; temperature?: number } = {},
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await proxyFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      },
      body: JSON.stringify({
        model:
          process.env.ANTHROPIC_EXTRACTION_MODEL ?? "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed: ${response.status}`);
    }

    const data = (await response.json()) as AnthropicTextResponse;
    const text = (data.content ?? [])
      .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
      .join("")
      .trim();

    return text || null;
  } catch (error) {
    console.error("Haiku completion failed.", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
