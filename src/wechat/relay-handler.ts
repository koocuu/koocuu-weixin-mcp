import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

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

function inferFilename(url: string) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() || "media.bin";
  } catch {
    return "media.bin";
  }
}

function extensionFromContentType(contentType: string) {
  if (contentType.includes("jpeg")) return ".jpg";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("mp4")) return ".mp4";
  if (contentType.includes("mpeg")) return ".mp3";
  return "";
}

async function downloadMedia(mediaUrl: string, filename?: string) {
  const response = await fetch(mediaUrl, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; koocuu-weixin-mcp-relay/1.0; +https://weixin.koocuu.com)",
      Accept: "image/*,application/octet-stream,*/*",
    },
  });
  if (!response.ok) {
    throw new WechatApiError("Failed to download media URL on relay.", {
      mediaUrl,
      status: response.status,
    }, response.status);
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const sourceName = filename ?? inferFilename(mediaUrl);
  const extension = extname(sourceName) || extensionFromContentType(contentType) || ".bin";
  const safeName = `${sourceName.replace(/[^a-zA-Z0-9._-]/g, "_") || "media"}${
    extname(sourceName) ? "" : extension
  }`;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new WechatApiError("Downloaded media was empty.", { mediaUrl });
  }
  if (buffer.byteLength > 2 * 1024 * 1024) {
    throw new WechatApiError("Downloaded media exceeds 2MB relay limit.", {
      mediaUrl,
      byteLength: buffer.byteLength,
    });
  }

  return { buffer, contentType, filename: safeName };
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

async function postWechatMultipart(input: {
  path: string;
  accessToken: string;
  query?: Record<string, string>;
  filename: string;
  contentType: string;
  buffer: Buffer;
  extraFields?: Record<string, string>;
}) {
  const url = new URL(input.path, wechatApiBase);
  url.searchParams.set("access_token", input.accessToken);
  for (const [key, value] of Object.entries(input.query ?? {})) {
    url.searchParams.set(key, value);
  }

  // Write to disk then rebuild File for better multipart filename compatibility.
  const dir = join(tmpdir(), "koocuu-weixin-mcp-relay");
  const filepath = join(dir, `${randomUUID()}-${input.filename}`);
  await mkdir(dir, { recursive: true });
  await writeFile(filepath, input.buffer);

  try {
    const bytes = await readFile(filepath);
    const form = new FormData();
    form.append(
      "media",
      new Blob([new Uint8Array(bytes)], { type: input.contentType }),
      input.filename,
    );
    for (const [key, value] of Object.entries(input.extraFields ?? {})) {
      form.append(key, value);
    }

    const response = await fetch(url, { method: "POST", body: form });
    const text = await response.text();
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new WechatApiError("WeChat upload returned non-JSON.", { text }, response.status);
    }

    if (
      data &&
      typeof data === "object" &&
      "errcode" in data &&
      typeof (data as { errcode: unknown }).errcode === "number" &&
      (data as { errcode: number }).errcode !== 0
    ) {
      const err = data as { errcode: number; errmsg?: string };
      throw new WechatApiError(
        err.errmsg ?? `WeChat upload failed with errcode ${err.errcode}`,
        data,
        response.status,
      );
    }

    if (!response.ok) {
      throw new WechatApiError("WeChat upload HTTP failed.", data, response.status);
    }

    return data;
  } finally {
    await unlink(filepath).catch(() => undefined);
  }
}

async function handleUpload(input: RelayUploadRequest) {
  if (!input.accessToken) {
    throw new WechatApiError(
      "upload requires accessToken from the MCP entry (Vercel). Do not rely on SCF AppSecret.",
      { hint: "Pass accessToken obtained via relay /cgi-bin/token." },
      400,
    );
  }

  const media = await downloadMedia(input.mediaUrl, input.filename);

  if (input.kind === "article_image") {
    const data = await postWechatMultipart({
      path: "/cgi-bin/media/uploadimg",
      accessToken: input.accessToken,
      filename: media.filename,
      contentType: media.contentType,
      buffer: media.buffer,
    });
    return Response.json({ status: 200, data });
  }

  const type = input.type ?? "image";
  const extraFields =
    type === "video"
      ? {
          description: JSON.stringify({
            title: input.videoTitle ?? input.filename ?? "video",
            introduction: input.videoIntroduction ?? "",
          }),
        }
      : undefined;

  const data = await postWechatMultipart({
    path: "/cgi-bin/material/add_material",
    accessToken: input.accessToken,
    query: { type },
    filename: media.filename,
    contentType: media.contentType,
    buffer: media.buffer,
    extraFields,
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
        { status: error.status && error.status >= 400 ? error.status : 502 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: "relay_failed", message }, { status: 502 });
  }
}
