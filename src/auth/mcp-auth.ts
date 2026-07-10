import { createHash, timingSafeEqual } from "node:crypto";

import { getMcpConfig } from "@/src/config/env";
import { getOAuthProtectedResourceMetadataUrl } from "@/src/auth/oauth";
import { requestSnapshot, writeOAuthDebugLog } from "@/src/debug/oauth-log";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function authorizeMcpRequest(request: Request) {
  const { bearerToken } = getMcpConfig();
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(/\s+/, 2);

  if (scheme !== "Bearer" || !token || !safeEqual(token, bearerToken)) {
    writeOAuthDebugLog("mcp_auth_rejected", {
      ...requestSnapshot(request),
      authScheme: scheme || undefined,
      tokenHash: token
        ? createHash("sha256").update(token).digest("hex").slice(0, 16)
        : undefined,
      expectedTokenHash: createHash("sha256")
        .update(bearerToken)
        .digest("hex")
        .slice(0, 16),
    });
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        message: "Use Authorization: Bearer <MCP_BEARER_TOKEN>.",
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer realm="koocuu-weixin-mcp", resource_metadata="${getOAuthProtectedResourceMetadataUrl()}"`,
        },
      },
    );
  }

  writeOAuthDebugLog("mcp_auth_accepted", {
    ...requestSnapshot(request),
    authScheme: scheme,
    tokenHash: createHash("sha256").update(token).digest("hex").slice(0, 16),
  });

  return undefined;
}
