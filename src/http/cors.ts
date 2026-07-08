import { getMcpConfig } from "@/src/config/env";

const allowedHeaders = [
  "Authorization",
  "Content-Type",
  "MCP-Protocol-Version",
  "Mcp-Session-Id",
  "Last-Event-ID",
].join(", ");

export function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const headers = new Headers();
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", allowedHeaders);
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");

  if (!origin) {
    return headers;
  }

  try {
    const { allowedOrigins } = getMcpConfig();
    if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
    }
  } catch {
    // The MCP route reports missing/invalid auth config.
  }

  return headers;
}

export function withCors(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(request)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
