import { getWechatRelayConfig } from "@/src/config/env";
import { WechatApiError } from "@/src/wechat/errors";
import type {
  RelayHttpRequest,
  RelayOutboundIpRequest,
  RelayUploadRequest,
} from "@/src/wechat/relay-types";

type RelayHttpResult = {
  status: number;
  headers?: Record<string, string>;
  body: string;
  bodyEncoding: "utf8" | "base64";
};

function assertHeaderSafeSecret(secret: string) {
  for (let i = 0; i < secret.length; i += 1) {
    if (secret.charCodeAt(i) > 255) {
      throw new WechatApiError(
        "WECHAT_RELAY_SECRET (or MCP_BEARER_TOKEN) contains a non-ASCII " +
          `character at position ${i}. The env var was probably set to a ` +
          "description instead of the real token — re-paste the actual secret.",
        {},
      );
    }
  }
}

async function callRelay<T>(payload: unknown): Promise<T> {
  const relay = getWechatRelayConfig();
  if (!relay) {
    throw new WechatApiError("WECHAT_RELAY_URL is not configured.", {});
  }
  assertHeaderSafeSecret(relay.secret);

  const response = await fetch(`${relay.url}/api/wechat-relay`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${relay.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new WechatApiError("Relay returned non-JSON.", { text }, response.status);
  }

  if (!response.ok) {
    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const details = record.details;
    const detailMsg =
      details && typeof details === "object" && details && "errmsg" in details
        ? String((details as { errmsg: unknown }).errmsg)
        : undefined;
    const code =
      details && typeof details === "object" && details && "code" in details
        ? String((details as { code: unknown }).code)
        : details && typeof details === "object" && details && "errcode" in details
          ? String((details as { errcode: unknown }).errcode)
          : undefined;
    const base =
      typeof record.message === "string" ? record.message : "WeChat relay request failed.";
    throw new WechatApiError(
      [base, code ? `code=${code}` : undefined, detailMsg].filter(Boolean).join(" | "),
      data,
      response.status,
    );
  }

  return data as T;
}

export function isWechatRelayEnabled() {
  return Boolean(getWechatRelayConfig());
}

export async function relayHttp(input: Omit<RelayHttpRequest, "op">) {
  return callRelay<RelayHttpResult>({ op: "http", ...input });
}

export async function relayUpload(input: Omit<RelayUploadRequest, "op">) {
  const result = await callRelay<{ status: number; data: unknown }>({
    op: "upload",
    ...input,
  });
  return result.data;
}

export async function relayOutboundIp() {
  const result = await callRelay<{ status: number; data: unknown }>({
    op: "outbound_ip",
  } satisfies RelayOutboundIpRequest);
  return result.data;
}
