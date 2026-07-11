import { createHash, timingSafeEqual } from "node:crypto";

import { getWechatRelaySecret } from "@/src/config/env";
import { getOutboundIp } from "@/src/network/outbound-ip";
import { WechatApiError } from "@/src/wechat/errors";
import type {
  RelayHttpRequest,
  RelayRequest,
  RelayUploadRequest,
} from "@/src/wechat/relay-types";

const wechatApiBase = "https://api.weixin.qq.com";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function authorizeRelayRequest(request: Request) {
  const expected = getWechatRelaySecret();
  if (!expected) {
    return new Response(
      JSON.stringify({
        error: "misconfigured",
        message: "WECHAT_RELAY_SECRET or MCP_BEARER_TOKEN must be set on the relay.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(/\s+/, 2);
  if (scheme !== "Bearer" || !token || !safeEqual(token, expected)) {
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        message: "Use Authorization: Bearer <WECHAT_RELAY_SECRET>.",
        tokenHash: token
          ? createHash("sha256").update(token).digest("hex").slice(0, 16)
          : undefined,
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  return undefined;
}

function assertSafeWechatPath(path: string) {
  if (!path.startsWith("/") || path.includes("://") || path.includes("..")) {
    throw new WechatApiError("Relay path must be a WeChat API absolute path.", { path });
  }
}

async function handleHttp(input: RelayHttpRequest) {
  assertSafeWechatPath(input.path);
  const url = new URL(input.path, wechatApiBase);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const body =
    input.body === undefined
      ? undefined
      : input.bodyEncoding === "base64"
        ? Buffer.from(input.body, "base64")
        : input.body;

  const response = await fetch(url, {
    method: input.method ?? (body ? "POST" : "GET"),
    headers: input.headers,
    body,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await response.arrayBuffer());
  const isJsonLike =
    contentType.includes("json") ||
    contentType.includes("text") ||
    (buffer.length > 0 && buffer[0] === 0x7b);

  return Response.json({
    status: response.status,
    headers: {
      "content-type": contentType,
    },
    body: isJsonLike ? buffer.toString("utf8") : buffer.toString("base64"),
    bodyEncoding: isJsonLike ? "utf8" : "base64",
  });
}

async function handleUpload(input: RelayUploadRequest) {
  // Lazy import avoids a cycle with WechatClient → relay-transport.
  const { createWechatClient } = await import("@/src/wechat/client");
  const client = createWechatClient();
  if (input.kind === "article_image") {
    const data = await client.uploadArticleImageFromUrl({
      imageUrl: input.mediaUrl,
      filename: input.filename,
    });
    return Response.json({ status: 200, data });
  }

  const data = await client.uploadPermanentMaterialFromUrl({
    mediaUrl: input.mediaUrl,
    filename: input.filename,
    type: input.type ?? "image",
    videoTitle: input.videoTitle,
    videoIntroduction: input.videoIntroduction,
  });
  return Response.json({ status: 200, data });
}

export async function handleWechatRelayPost(request: Request) {
  const unauthorized = authorizeRelayRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  let payload: RelayRequest;
  try {
    payload = (await request.json()) as RelayRequest;
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Body must be JSON." },
      { status: 400 },
    );
  }

  try {
    if (payload.op === "http") {
      return await handleHttp(payload);
    }
    if (payload.op === "upload") {
      return await handleUpload(payload);
    }
    if (payload.op === "outbound_ip") {
      const data = await getOutboundIp();
      return Response.json({ status: 200, data });
    }
    return Response.json(
      { error: "unsupported_op", message: "Unknown relay op." },
      { status: 400 },
    );
  } catch (error) {
    if (error instanceof WechatApiError) {
      return Response.json(
        {
          error: "wechat_api_error",
          message: error.message,
          details: error.details,
        },
        { status: error.status ?? 502 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: "relay_failed", message }, { status: 502 });
  }
}
