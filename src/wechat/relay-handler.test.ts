import { afterEach, describe, expect, it } from "vitest";

import { authorizeRelayRequest } from "@/src/wechat/relay-handler";

describe("authorizeRelayRequest", () => {
  afterEach(() => {
    delete process.env.WECHAT_RELAY_SECRET;
    delete process.env.MCP_BEARER_TOKEN;
  });

  it("rejects missing bearer", () => {
    process.env.MCP_BEARER_TOKEN = "relay-secret";
    const response = authorizeRelayRequest(
      new Request("https://example.com/api/wechat-relay", { method: "POST" }),
    );
    expect(response?.status).toBe(401);
  });

  it("accepts matching WECHAT_RELAY_SECRET", () => {
    process.env.WECHAT_RELAY_SECRET = "relay-secret";
    const response = authorizeRelayRequest(
      new Request("https://example.com/api/wechat-relay", {
        method: "POST",
        headers: { Authorization: "Bearer relay-secret" },
      }),
    );
    expect(response).toBeUndefined();
  });
});
