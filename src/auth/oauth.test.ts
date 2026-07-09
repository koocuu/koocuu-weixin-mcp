import { createHash } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  handleOAuthAuthorizePost,
  handleOAuthClientRegistration,
  handleOAuthToken,
} from "@/src/auth/oauth";

const bearerToken = "test-bearer-token";
const claudeRedirectUri = "https://claude.ai/api/mcp/auth_callback";

beforeAll(() => {
  process.env.MCP_BEARER_TOKEN = bearerToken;
});

function authorizeRequest(fields: Record<string, string>) {
  const form = new FormData();
  form.set("secret", bearerToken);
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return new Request("https://example.com/authorize", {
    method: "POST",
    body: form,
  });
}

async function authorize(fields: Record<string, string>) {
  const response = await handleOAuthAuthorizePost(authorizeRequest(fields));
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location") ?? "");
  const code = location.searchParams.get("code");
  expect(code).toBeTruthy();
  return { location, code: code as string };
}

function tokenRequest(params: Record<string, string>) {
  return new Request("https://example.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

function base64url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("OAuth token exchange", () => {
  it("omits scope from the token response when the client did not request one", async () => {
    const { code } = await authorize({
      client_id: "client-without-scope",
      redirect_uri: claudeRedirectUri,
    });

    const response = await handleOAuthToken(
      tokenRequest({
        grant_type: "authorization_code",
        code,
        client_id: "client-without-scope",
        redirect_uri: claudeRedirectUri,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.access_token).toBe(bearerToken);
    expect(body.token_type).toBe("Bearer");
    expect(body).not.toHaveProperty("scope");
  });

  it("echoes exactly the scope the client requested", async () => {
    const { code } = await authorize({
      client_id: "client-with-scope",
      redirect_uri: claudeRedirectUri,
      scope: "claudeai",
    });

    const response = await handleOAuthToken(
      tokenRequest({
        grant_type: "authorization_code",
        code,
        client_id: "client-with-scope",
        redirect_uri: claudeRedirectUri,
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.scope).toBe("claudeai");
  });

  it("verifies the PKCE code verifier when a challenge was sent", async () => {
    const verifier = "test-code-verifier-test-code-verifier-1234";
    const challenge = base64url(createHash("sha256").update(verifier).digest());

    const { code } = await authorize({
      client_id: "client-with-pkce",
      redirect_uri: claudeRedirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    const failed = await handleOAuthToken(
      tokenRequest({
        grant_type: "authorization_code",
        code,
        client_id: "client-with-pkce",
        redirect_uri: claudeRedirectUri,
        code_verifier: "wrong-verifier",
      }),
    );
    expect(failed.status).toBe(400);

    const succeeded = await handleOAuthToken(
      tokenRequest({
        grant_type: "authorization_code",
        code,
        client_id: "client-with-pkce",
        redirect_uri: claudeRedirectUri,
        code_verifier: verifier,
      }),
    );
    expect(succeeded.status).toBe(200);
  });
});

describe("OAuth authorize fallback redirect", () => {
  it("accepts claude.com callbacks for unregistered clients", async () => {
    const { location } = await authorize({
      client_id: "unregistered-client",
      redirect_uri: "https://claude.com/api/mcp/auth_callback",
      state: "abc",
    });
    expect(location.origin).toBe("https://claude.com");
    expect(location.searchParams.get("state")).toBe("abc");
  });

  it("still rejects arbitrary redirect hosts for unregistered clients", async () => {
    const response = await handleOAuthAuthorizePost(
      authorizeRequest({
        client_id: "unregistered-client",
        redirect_uri: "https://evil.example.com/callback",
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("OAuth client registration", () => {
  it("does not grant a default scope the client never asked for", async () => {
    const response = await handleOAuthClientRegistration(
      new Request("https://example.com/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [claudeRedirectUri] }),
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.scope).toBeUndefined();
  });
});
