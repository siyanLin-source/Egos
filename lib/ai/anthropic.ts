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
      const response = await undiciFetch(
        input as Parameters<typeof undiciFetch>[0],
        {
          ...(init as Parameters<typeof undiciFetch>[1]),
          dispatcher: proxyAgent,
        },
      );

      return response as unknown as Response;
    }
  : undefined;

const anthropic = createAnthropic({
  fetch: anthropicFetch,
});

export function getAnthropicModel() {
  return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5");
}
