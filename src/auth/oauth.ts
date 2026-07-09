import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { getMcpConfig, getPublicBaseUrl } from "@/src/config/env";
import { getTokenStore } from "@/src/wechat/token-store";

type OAuthClient = {
  client_id: string;
  client_id_issued_at: number;
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  scope?: string;
};

type AuthorizationCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  scope?: string;
  resource?: string;
  expiresAt?: number;
  nonce?: string;
};

const oauthScope = "mcp:tools";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

function baseUrl() {
  return getPublicBaseUrl().replace(/\/$/, "");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function base64url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlJson(value: unknown) {
  return base64url(Buffer.from(JSON.stringify(value)));
}

function decodeBase64urlJson<T>(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function codeSigningSecret() {
  const { bearerToken } = getMcpConfig();
  return createHash("sha256").update(bearerToken).digest();
}

function signCodePayload(payload: string) {
  return base64url(createHmac("sha256", codeSigningSecret()).update(payload).digest());
}

function createAuthorizationCode(data: AuthorizationCode) {
  const payload = base64urlJson({
    ...data,
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    nonce: randomUUID(),
  });
  return `${payload}.${signCodePayload(payload)}`;
}

function readAuthorizationCode(code: string) {
  const [payload, signature] = code.split(".");
  if (!payload || !signature || !safeEqual(signature, signCodePayload(payload))) {
    return undefined;
  }

  const data = decodeBase64urlJson<AuthorizationCode>(payload);
  if (!data.expiresAt || data.expiresAt <= Math.floor(Date.now() / 1000)) {
    return undefined;
  }

  return data;
}

function pkceChallenge(codeVerifier: string) {
  return base64url(createHash("sha256").update(codeVerifier).digest());
}

function clientKey(clientId: string) {
  return `koocuu-weixin-mcp:oauth:client:${clientId}`;
}

async function getClient(clientId: string) {
  const value = await getTokenStore().get(clientKey(clientId));
  return value ? (JSON.parse(value) as OAuthClient) : undefined;
}

async function saveClient(client: OAuthClient) {
  await getTokenStore().set(clientKey(client.client_id), JSON.stringify(client), 86400 * 30);
}

export function getOAuthProtectedResourceMetadataUrl() {
  return `${baseUrl()}/.well-known/oauth-protected-resource/api/mcp`;
}

export function oauthAuthorizationServerMetadata() {
  const issuer = baseUrl();
  return jsonResponse({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [oauthScope],
    service_documentation: `${issuer}/api/health`,
  });
}

export function oauthProtectedResourceMetadata() {
  const issuer = baseUrl();
  return jsonResponse({
    resource: `${issuer}/api/mcp`,
    authorization_servers: [issuer],
    scopes_supported: [oauthScope],
    bearer_methods_supported: ["header"],
    resource_name: "Koocuu Weixin MCP",
  });
}

export async function handleOAuthClientRegistration(request: Request) {
  const metadata = (await request.json().catch(() => ({}))) as {
    redirect_uris?: string[];
    token_endpoint_auth_method?: string;
    grant_types?: string[];
    response_types?: string[];
    client_name?: string;
    scope?: string;
  };

  if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length === 0) {
    return jsonResponse(
      {
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required.",
      },
      { status: 400 },
    );
  }

  const client: OAuthClient = {
    client_id: `koocuu_${randomUUID()}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: metadata.redirect_uris,
    token_endpoint_auth_method: metadata.token_endpoint_auth_method ?? "none",
    grant_types: metadata.grant_types ?? ["authorization_code"],
    response_types: metadata.response_types ?? ["code"],
    client_name: metadata.client_name,
    scope: metadata.scope,
  };

  await saveClient(client);

  return jsonResponse(client, { status: 201 });
}

function authorizationError(message: string, status = 400) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function renderAuthorizeForm(params: URLSearchParams) {
  const hidden = Array.from(params.entries())
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`,
    )
    .join("\n");

  return new Response(
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorize Koocuu Weixin MCP</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f6f7f9; color: #111827; }
      main { max-width: 520px; margin: 12vh auto; background: white; padding: 32px; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08); }
      h1 { margin: 0 0 12px; font-size: 24px; }
      p { color: #4b5563; line-height: 1.6; }
      label { display: block; margin: 24px 0 8px; font-weight: 600; }
      input[type="password"] { width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 16px; }
      button { margin-top: 20px; width: 100%; padding: 12px 16px; border: 0; border-radius: 8px; background: #0f766e; color: white; font-weight: 700; font-size: 16px; cursor: pointer; }
      .hint { font-size: 13px; color: #6b7280; }
    </style>
  </head>
  <body>
    <main>
      <h1>Authorize Koocuu Weixin MCP</h1>
      <p>Claude is asking to connect to your WeChat MCP server. Enter your <code>MCP_BEARER_TOKEN</code> to approve this connector.</p>
      <form method="post" action="/authorize">
        ${hidden}
        <label for="secret">MCP bearer token</label>
        <input id="secret" name="secret" type="password" autocomplete="one-time-code" spellcheck="false" required autofocus />
        <button type="submit">Authorize Claude</button>
      </form>
      <p class="hint">Paste the MCP bearer token, not your WeChat AppSecret or a site password.</p>
    </main>
  </body>
</html>`,
    {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const fallbackRedirectHosts = new Set(["claude.ai", "claude.com"]);

function isAllowedFallbackRedirectUri(redirectUri: string) {
  try {
    const url = new URL(redirectUri);
    return url.protocol === "https:" && fallbackRedirectHosts.has(url.hostname);
  } catch {
    return false;
  }
}

export async function handleOAuthAuthorizeGet(request: Request) {
  const url = new URL(request.url);
  return renderAuthorizeForm(url.searchParams);
}

export async function handleOAuthAuthorizePost(request: Request) {
  const form = await request.formData();
  const secret = String(form.get("secret") ?? "");
  const { bearerToken } = getMcpConfig();

  if (!safeEqual(secret, bearerToken)) {
    return authorizationError("Invalid MCP bearer token.", 403);
  }

  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const state = form.get("state");
  const codeChallenge = form.get("code_challenge");
  const resource = form.get("resource");
  const scope = form.get("scope");

  const client = await getClient(clientId);
  if (!client && !isAllowedFallbackRedirectUri(redirectUri)) {
    return authorizationError("Unknown OAuth client.", 400);
  }

  if (client && !client.redirect_uris.includes(redirectUri)) {
    return authorizationError("Unregistered redirect_uri.", 400);
  }

  // Only carry the scope the client actually asked for. Granting an
  // unrequested scope makes strict clients (e.g. the MCP Python SDK behind
  // claude.ai) reject the token as "unauthorized scopes" after exchange.
  const code = createAuthorizationCode({
    clientId,
    redirectUri,
    codeChallenge: codeChallenge ? String(codeChallenge) : undefined,
    resource: resource ? String(resource) : undefined,
    scope: scope ? String(scope) : undefined,
  });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) {
    redirect.searchParams.set("state", String(state));
  }

  return Response.redirect(redirect, 302);
}

export async function handleOAuthToken(request: Request) {
  const body = await request.text();
  const params = new URLSearchParams(body);
  const grantType = params.get("grant_type");

  if (grantType !== "authorization_code") {
    return jsonResponse(
      {
        error: "unsupported_grant_type",
        error_description: "Only authorization_code is supported.",
      },
      { status: 400 },
    );
  }

  const code = params.get("code");
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const codeVerifier = params.get("code_verifier");

  if (!code || !clientId || !redirectUri) {
    return jsonResponse(
      {
        error: "invalid_request",
        error_description: "code, client_id, and redirect_uri are required.",
      },
      { status: 400 },
    );
  }

  const codeData = readAuthorizationCode(code);

  if (!codeData || codeData.clientId !== clientId || codeData.redirectUri !== redirectUri) {
    return jsonResponse(
      {
        error: "invalid_grant",
        error_description: "Invalid authorization code.",
      },
      { status: 400 },
    );
  }

  if (codeData.codeChallenge && pkceChallenge(codeVerifier ?? "") !== codeData.codeChallenge) {
    return jsonResponse(
      {
        error: "invalid_grant",
        error_description: "Invalid PKCE code verifier.",
      },
      { status: 400 },
    );
  }

  const { bearerToken } = getMcpConfig();
  return jsonResponse(
    {
      access_token: bearerToken,
      token_type: "Bearer",
      expires_in: 31536000,
      // Per RFC 6749 the scope field is omitted when it matches the request;
      // echoing a scope the client never requested breaks strict clients.
      ...(codeData.scope ? { scope: codeData.scope } : {}),
    },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}
