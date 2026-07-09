import { timingSafeEqual } from "node:crypto";

import { getMcpConfig } from "@/src/config/env";
import { getOAuthProtectedResourceMetadataUrl } from "@/src/auth/oauth";

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

  return undefined;
}
