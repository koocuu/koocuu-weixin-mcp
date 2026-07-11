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

async function callRelay<T>(payload: unknown): Promise<T> {
  const relay = getWechatRelayConfig();
  if (!relay) {
    throw new WechatApiError("WECHAT_RELAY_URL is not configured.", {});
  }

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
    throw new WechatApiError(
      typeof data === "object" && data && "message" in data
        ? String((data as { message: unknown }).message)
        : "WeChat relay request failed.",
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
