import { fetch as undiciFetch, ProxyAgent } from "undici";

const proxyUrl =
  process.env.HTTPS_PROXY ??
  process.env.https_proxy ??
  process.env.HTTP_PROXY ??
  process.env.http_proxy;

const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

type ProxyFetchInit = Parameters<typeof undiciFetch>[1];

// Node 原生 fetch（undici）默认不读取 HTTP(S)_PROXY 环境变量。
// 归档要直接调用 api.anthropic.com，在大陆必须显式走代理，否则直连超时失败。
// 这和聊天路由用的 lib/ai/anthropic.ts 是同一套代理逻辑——之前归档没走，所以一直失败。
export async function proxyFetch(
  input: string,
  init?: ProxyFetchInit,
): Promise<Response> {
  const response = await undiciFetch(
    input,
    proxyAgent ? { ...init, dispatcher: proxyAgent } : init,
  );

  return response as unknown as Response;
}
