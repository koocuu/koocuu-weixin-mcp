import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

type OAuthDebugFields = Record<string, unknown>;

function logPath() {
  const directory = process.env.TENCENTCLOUD_RUNENV === "SCF"
    ? "/tmp/koocuu-weixin-mcp"
    : path.join(process.cwd(), "logs");
  return path.join(directory, "oauth-debug.log");
}

export function hashForLog(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function requestSnapshot(request: Request) {
  return {
    method: request.method,
    url: request.url,
    userAgent: request.headers.get("user-agent") ?? undefined,
    origin: request.headers.get("origin") ?? undefined,
    referer: request.headers.get("referer") ?? undefined,
    contentType: request.headers.get("content-type") ?? undefined,
    accept: request.headers.get("accept") ?? undefined,
  };
}

export function writeOAuthDebugLog(event: string, fields: OAuthDebugFields = {}) {
  const row = {
    time: new Date().toISOString(),
    event,
    ...fields,
  };

  void mkdir(path.dirname(logPath()), { recursive: true })
    .then(() => appendFile(logPath(), `${JSON.stringify(row)}\n`, "utf8"))
    .catch(() => {
      // Debug logging must never affect the OAuth flow.
    });
}
