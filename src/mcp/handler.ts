import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { authorizeMcpRequest } from "@/src/auth/mcp-auth";
import { requestSnapshot, writeOAuthDebugLog } from "@/src/debug/oauth-log";
import { corsHeaders, withCors } from "@/src/http/cors";
import { createMcpServer } from "@/src/mcp/server";

function sanitizedUrl(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("key")) {
    url.searchParams.set("key", "REDACTED");
  }
  return url.toString();
}

export function handleMcpOptions(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export async function handleMcpRequest(request: Request) {
  try {
    const unauthorized = authorizeMcpRequest(request);
    writeOAuthDebugLog("mcp_request", {
      ...requestSnapshot(request),
      url: sanitizedUrl(request),
      hasAuthorization: Boolean(request.headers.get("authorization")),
      authorized: !unauthorized,
    });
    if (unauthorized) {
      writeOAuthDebugLog("mcp_response", {
        status: unauthorized.status,
        reason: "unauthorized",
      });
      return withCors(unauthorized, request);
    }

    const server = createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);
    const response = await transport.handleRequest(request);
    writeOAuthDebugLog("mcp_response", {
      status: response.status,
      contentType: response.headers.get("content-type") ?? undefined,
    });
    return withCors(response, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeOAuthDebugLog("mcp_response", {
      status: 500,
      reason: "exception",
      message,
    });
    return withCors(
      new Response(
        JSON.stringify({
          error: "mcp_request_failed",
          message,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      ),
      request,
    );
  }
}
