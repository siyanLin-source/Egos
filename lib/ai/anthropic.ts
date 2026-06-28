import { createAnthropic } from "@ai-sdk/anthropic";
import { fetch as undiciFetch, ProxyAgent } from "undici";

const proxyUrl =
  process.env.HTTPS_PROXY ??
  process.env.https_proxy ??
  process.env.HTTP_PROXY ??
  process.env.http_proxy;

const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

const anthropicFetch: typeof globalThis.fetch | undefined = proxyAgent
  ? async (input, init) => {
      let response: Awaited<ReturnType<typeof undiciFetch>>;

      try {
        response = await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
          ...(init as Parameters<typeof undiciFetch>[1]),
          dispatcher: proxyAgent,
        });
      } catch (error) {
        console.warn("Anthropic proxy failed; retrying without proxy.", error);
        response = await undiciFetch(
          input as Parameters<typeof undiciFetch>[0],
          init as Parameters<typeof undiciFetch>[1],
        );
      }

      return response as unknown as Response;
    }
  : undefined;

const anthropic = createAnthropic({
  // 必须显式指定 baseURL：ai@6 + @ai-sdk/anthropic@3 的默认值会丢掉 /v1，
  // 请求会打到 https://api.anthropic.com/messages → 404（回复失败）。
  baseURL: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
  fetch: anthropicFetch,
});

export function getAnthropicModel(modelName?: string) {
  return anthropic(
    modelName ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
  );
}

export function getAnthropicExtractionModel() {
  return getAnthropicModel(
    process.env.ANTHROPIC_EXTRACTION_MODEL ?? "claude-haiku-4-5-20251001",
  );
}
