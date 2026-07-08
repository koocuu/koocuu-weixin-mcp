import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { authorizeMcpRequest } from "@/src/auth/mcp-auth";
import { corsHeaders, withCors } from "@/src/http/cors";
import { createMcpServer } from "@/src/mcp/server";

export function handleMcpOptions(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export async function handleMcpRequest(request: Request) {
  try {
    const unauthorized = authorizeMcpRequest(request);
    if (unauthorized) {
      return withCors(unauthorized, request);
    }

    const server = createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return withCors(response, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
