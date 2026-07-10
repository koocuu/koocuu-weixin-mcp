import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { getMcpConfig, getPublicBaseUrl } from "@/src/config/env";
import {
  hashForLog,
  requestSnapshot,
  writeOAuthDebugLog,
} from "@/src/debug/oauth-log";
import { getTokenStore } from "@/src/wechat/token-store";

type OAuthClient = {
  client_id: string;
  client_id_issued_at: number;
  client_secret?: string;
  client_secret_expires_at?: number;
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
  codeChallengeMethod?: string;
  scope?: string;
  resource?: string;
  expiresAt?: number;
  nonce?: string;
};

type RefreshToken = {
  tokenType: "refresh";
  clientId: string;
  scope?: string;
  resource?: string;
  expiresAt?: number;
  nonce?: string;
};

const oauthScope = "mcp:tools";
const clientSecretTtlSeconds = 86400 * 30;
const refreshTokenTtlSeconds = 86400 * 30;

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      ...init?.headers,
    },
  });
}

export function handleOAuthOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
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

function createRefreshToken(data: Omit<RefreshToken, "expiresAt" | "nonce" | "tokenType">) {
  const payload = base64urlJson({
    ...data,
    tokenType: "refresh",
    expiresAt: Math.floor(Date.now() / 1000) + refreshTokenTtlSeconds,
    nonce: randomUUID(),
  });
  return `${payload}.${signCodePayload(payload)}`;
}

function readRefreshToken(token: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, signCodePayload(payload))) {
    return undefined;
  }

  const data = decodeBase64urlJson<RefreshToken>(payload);
  if (
    data.tokenType !== "refresh" ||
    !data.expiresAt ||
    data.expiresAt <= Math.floor(Date.now() / 1000)
  ) {
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

function mcpResource() {
  return `${baseUrl()}/api/mcp`;
}

export function oauthAuthorizationServerMetadata() {
  const issuer = baseUrl();
  writeOAuthDebugLog("authorization_server_metadata", {
    issuer,
  });
  return jsonResponse({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    revocation_endpoint: `${issuer}/revoke`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
    revocation_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
      "none",
    ],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [oauthScope],
    service_documentation: `${issuer}/api/health`,
  });
}

export function oauthProtectedResourceMetadata() {
  const issuer = baseUrl();
  writeOAuthDebugLog("protected_resource_metadata", {
    resource: `${issuer}/api/mcp`,
    authorizationServer: issuer,
  });
  return jsonResponse({
    resource: mcpResource(),
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

  writeOAuthDebugLog("register_request", {
    ...requestSnapshot(request),
    redirectUris: metadata.redirect_uris,
    tokenEndpointAuthMethod: metadata.token_endpoint_auth_method,
    grantTypes: metadata.grant_types,
    responseTypes: metadata.response_types,
    scope: metadata.scope,
    clientName: metadata.client_name,
  });

  if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length === 0) {
    writeOAuthDebugLog("register_response", {
      status: 400,
      reason: "missing_redirect_uris",
    });
    return jsonResponse(
      {
        error: "invalid_client_metadata",
        error_description: "redirect_uris is required.",
      },
      { status: 400 },
    );
  }

  const authMethod = metadata.token_endpoint_auth_method ?? "none";
  const isPublicClient = authMethod === "none";
  const issuedAt = Math.floor(Date.now() / 1000);
  const client: OAuthClient = {
    client_id: `koocuu_${randomUUID()}`,
    client_id_issued_at: issuedAt,
    client_secret: isPublicClient ? undefined : base64url(randomBytes(32)),
    client_secret_expires_at: isPublicClient ? undefined : issuedAt + clientSecretTtlSeconds,
    redirect_uris: metadata.redirect_uris,
    token_endpoint_auth_method: authMethod,
    grant_types: metadata.grant_types ?? ["authorization_code"],
    response_types: metadata.response_types ?? ["code"],
    client_name: metadata.client_name,
    scope: metadata.scope,
  };

  await saveClient(client);

  writeOAuthDebugLog("register_response", {
    status: 201,
    clientIdHash: hashForLog(client.client_id),
    hasClientSecret: Boolean(client.client_secret),
    tokenEndpointAuthMethod: client.token_endpoint_auth_method,
  });

  return jsonResponse(client, { status: 201 });
}

function authorizationError(message: string, status = 400) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
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
  writeOAuthDebugLog("authorize_get", {
    ...requestSnapshot(request),
    clientIdHash: hashForLog(url.searchParams.get("client_id")),
    redirectUri: url.searchParams.get("redirect_uri") ?? undefined,
    responseType: url.searchParams.get("response_type") ?? undefined,
    scope: url.searchParams.get("scope") ?? undefined,
    resource: url.searchParams.get("resource") ?? undefined,
    hasState: url.searchParams.has("state"),
    hasCodeChallenge: url.searchParams.has("code_challenge"),
    codeChallengeMethod: url.searchParams.get("code_challenge_method") ?? undefined,
  });
  return renderAuthorizeForm(url.searchParams);
}

export async function handleOAuthAuthorizePost(request: Request) {
  const form = await request.formData();
  const secret = String(form.get("secret") ?? "");
  const { bearerToken } = getMcpConfig();
  const clientId = String(form.get("client_id") ?? "");
  let redirectUri = String(form.get("redirect_uri") ?? "");
  const state = form.get("state");
  const codeChallenge = form.get("code_challenge");
  const codeChallengeMethod = String(form.get("code_challenge_method") ?? "S256");
  const resource = form.get("resource");
  const scope = form.get("scope");

  writeOAuthDebugLog("authorize_post_request", {
    ...requestSnapshot(request),
    clientIdHash: hashForLog(clientId),
    redirectUri,
    responseType: String(form.get("response_type") ?? ""),
    scope: scope ? String(scope) : undefined,
    resource: resource ? String(resource) : undefined,
    hasState: Boolean(state),
    hasCodeChallenge: Boolean(codeChallenge),
    codeChallengeMethod,
    secretMatches: safeEqual(secret, bearerToken),
  });

  if (!safeEqual(secret, bearerToken)) {
    writeOAuthDebugLog("authorize_post_response", {
      status: 403,
      reason: "invalid_owner_token",
      clientIdHash: hashForLog(clientId),
      redirectUri,
    });
    return authorizationError("Invalid MCP bearer token.", 403);
  }

  const client = await getClient(clientId);
  if (!client && !isAllowedFallbackRedirectUri(redirectUri)) {
    writeOAuthDebugLog("authorize_post_response", {
      status: 400,
      reason: "unknown_client",
      clientIdHash: hashForLog(clientId),
      redirectUri,
    });
    return authorizationError("Unknown OAuth client.", 400);
  }

  if (!redirectUri && client?.redirect_uris.length === 1) {
    redirectUri = client.redirect_uris[0];
  }

  if (client && !client.redirect_uris.includes(redirectUri)) {
    writeOAuthDebugLog("authorize_post_response", {
      status: 400,
      reason: "unregistered_redirect_uri",
      clientIdHash: hashForLog(clientId),
      redirectUri,
      registeredRedirectUris: client.redirect_uris,
    });
    return authorizationError("Unregistered redirect_uri.", 400);
  }

  // Only carry the scope the client actually asked for. Granting an
  // unrequested scope makes strict clients (e.g. the MCP Python SDK behind
  // claude.ai) reject the token as "unauthorized scopes" after exchange.
  if (codeChallenge && !["S256", "plain"].includes(codeChallengeMethod)) {
    writeOAuthDebugLog("authorize_post_response", {
      status: 400,
      reason: "unsupported_code_challenge_method",
      clientIdHash: hashForLog(clientId),
      codeChallengeMethod,
    });
    return authorizationError("Unsupported code_challenge_method.", 400);
  }

  const code = createAuthorizationCode({
    clientId,
    redirectUri,
    codeChallenge: codeChallenge ? String(codeChallenge) : undefined,
    codeChallengeMethod: codeChallenge ? codeChallengeMethod : undefined,
    resource: resource ? String(resource) : undefined,
    scope: scope ? String(scope) : undefined,
  });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  // RFC 9207: authorization response must include iss matching AS metadata.
  redirect.searchParams.set("iss", baseUrl());
  if (state) {
    redirect.searchParams.set("state", String(state));
  }

  writeOAuthDebugLog("authorize_post_response", {
    status: 302,
    clientIdHash: hashForLog(clientId),
    redirectUri,
    codeHash: hashForLog(code),
    iss: baseUrl(),
  });

  return Response.redirect(redirect, 302);
}

async function readTokenParams(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    return params;
  }

  return new URLSearchParams(await request.text());
}

function readBasicClientCredentials(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, value] = authorization.split(/\s+/, 2);
  if (scheme !== "Basic" || !value) {
    return {};
  }

  const decoded = Buffer.from(value, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return {};
  }

  return {
    clientId: decoded.slice(0, separator),
    clientSecret: decoded.slice(separator + 1),
  };
}

async function validateClientCredentials(
  clientId: string,
  clientSecret: string | undefined,
) {
  const client = await getClient(clientId);
  if (!client) {
    return undefined;
  }

  if (!client.client_secret) {
    return client;
  }

  if (!clientSecret || !safeEqual(clientSecret, client.client_secret)) {
    throw new Error("Invalid client_secret.");
  }

  if (
    client.client_secret_expires_at &&
    client.client_secret_expires_at <= Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Client secret has expired.");
  }

  return client;
}

export async function handleOAuthToken(request: Request) {
  const params = await readTokenParams(request);
  const grantType = params.get("grant_type");
  const basicCredentials = readBasicClientCredentials(request);
  const bodyClientId = params.get("client_id") ?? undefined;
  const clientId = bodyClientId ?? basicCredentials.clientId;
  const clientSecret = params.get("client_secret") ?? basicCredentials.clientSecret;
  const redirectUri = params.get("redirect_uri");
  const code = params.get("code");
  const codeVerifier = params.get("code_verifier");
  const refreshToken = params.get("refresh_token");
  const resource = params.get("resource");

  writeOAuthDebugLog("token_request", {
    ...requestSnapshot(request),
    grantType,
    clientIdHash: hashForLog(clientId),
    bodyClientIdHash: hashForLog(bodyClientId),
    basicClientIdHash: hashForLog(basicCredentials.clientId),
    hasClientSecret: Boolean(clientSecret),
    redirectUri: redirectUri ?? undefined,
    hasCode: Boolean(code),
    codeHash: hashForLog(code),
    hasCodeVerifier: Boolean(codeVerifier),
    hasRefreshToken: Boolean(refreshToken),
    refreshTokenHash: hashForLog(refreshToken),
    resource: resource ?? undefined,
  });

  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    writeOAuthDebugLog("token_response", {
      status: 400,
      reason: "unsupported_grant_type",
      grantType,
      clientIdHash: hashForLog(clientId),
    });
    return jsonResponse(
      {
        error: "unsupported_grant_type",
        error_description: "Only authorization_code and refresh_token are supported.",
      },
      { status: 400 },
    );
  }

  if (!clientId || (grantType === "authorization_code" && !code)) {
    writeOAuthDebugLog("token_response", {
      status: 400,
      reason: "missing_code_or_client_id",
      clientIdHash: hashForLog(clientId),
      hasCode: Boolean(code),
    });
    return jsonResponse(
      {
        error: "invalid_request",
        error_description: "client_id and the requested grant credential are required.",
      },
      { status: 400 },
    );
  }

  if (
    bodyClientId &&
    basicCredentials.clientId &&
    bodyClientId !== basicCredentials.clientId
  ) {
    writeOAuthDebugLog("token_response", {
      status: 400,
      reason: "conflicting_client_credentials",
      bodyClientIdHash: hashForLog(bodyClientId),
      basicClientIdHash: hashForLog(basicCredentials.clientId),
    });
    return jsonResponse(
      {
        error: "invalid_client",
        error_description: "Conflicting client credentials.",
      },
      { status: 400 },
    );
  }

  try {
    await validateClientCredentials(clientId, clientSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid client.";
    writeOAuthDebugLog("token_response", {
      status: 400,
      reason: "invalid_client",
      message,
      clientIdHash: hashForLog(clientId),
    });
    return jsonResponse(
      {
        error: "invalid_client",
        error_description: message,
      },
      { status: 400 },
    );
  }

  if (grantType === "refresh_token") {
    if (!refreshToken) {
      writeOAuthDebugLog("token_response", {
        status: 400,
        reason: "missing_refresh_token",
        clientIdHash: hashForLog(clientId),
      });
      return jsonResponse(
        {
          error: "invalid_request",
          error_description: "refresh_token is required.",
        },
        { status: 400 },
      );
    }

    const refreshData = readRefreshToken(refreshToken);
    if (!refreshData || refreshData.clientId !== clientId) {
      writeOAuthDebugLog("token_response", {
        status: 400,
        reason: "invalid_refresh_token",
        clientIdHash: hashForLog(clientId),
        refreshTokenHash: hashForLog(refreshToken),
        refreshClientIdHash: hashForLog(refreshData?.clientId),
      });
      return jsonResponse(
        {
          error: "invalid_grant",
          error_description: "Invalid refresh token.",
        },
        { status: 400 },
      );
    }

    if (refreshData.resource && resource && refreshData.resource !== resource) {
      writeOAuthDebugLog("token_response", {
        status: 400,
        reason: "refresh_resource_mismatch",
        clientIdHash: hashForLog(clientId),
        resource: resource ?? undefined,
        refreshResource: refreshData.resource,
      });
      return jsonResponse(
        {
          error: "invalid_target",
          error_description: "Token resource does not match refresh token resource.",
        },
        { status: 400 },
      );
    }

    const { bearerToken } = getMcpConfig();
    const tokenResource = refreshData.resource ?? resource ?? mcpResource();
    const tokenScope = refreshData.scope;
    const nextRefreshToken = createRefreshToken({
      clientId,
      scope: tokenScope,
      resource: tokenResource,
    });
    writeOAuthDebugLog("token_response", {
      status: 200,
      grantType,
      clientIdHash: hashForLog(clientId),
      accessTokenHash: hashForLog(bearerToken),
      refreshTokenHash: hashForLog(nextRefreshToken),
      scope: tokenScope,
      resource: tokenResource,
    });
    return jsonResponse({
      access_token: bearerToken,
      token_type: "Bearer",
      expires_in: 3600,
      ...(tokenScope ? { scope: tokenScope } : {}),
      refresh_token: nextRefreshToken,
    });
  }

  if (!code) {
    writeOAuthDebugLog("token_response", {
      status: 400,
      reason: "missing_authorization_code_after_refresh_branch",
      clientIdHash: hashForLog(clientId),
    });
    return jsonResponse(
      {
        error: "invalid_request",
        error_description: "code is required.",
      },
      { status: 400 },
    );
  }

  const codeData = readAuthorizationCode(code);

  if (
    !codeData ||
    codeData.clientId !== clientId ||
    (redirectUri && codeData.redirectUri !== redirectUri)
  ) {
    writeOAuthDebugLog("token_response", {
      status: 400,
      reason: "invalid_authorization_code",
      clientIdHash: hashForLog(clientId),
      codeHash: hashForLog(code),
      redirectUri: redirectUri ?? undefined,
      codeClientIdHash: hashForLog(codeData?.clientId),
      codeRedirectUri: codeData?.redirectUri,
    });
    return jsonResponse(
      {
        error: "invalid_grant",
        error_description: "Invalid authorization code.",
      },
      { status: 400 },
    );
  }

  if (codeData.resource && resource && codeData.resource !== resource) {
    writeOAuthDebugLog("token_response", {
      status: 400,
      reason: "resource_mismatch",
      clientIdHash: hashForLog(clientId),
      resource: resource ?? undefined,
      codeResource: codeData.resource,
    });
    return jsonResponse(
      {
        error: "invalid_target",
        error_description: "Token resource does not match authorization resource.",
      },
      { status: 400 },
    );
  }

  if (codeData.codeChallenge) {
    const expected =
      codeData.codeChallengeMethod === "plain"
        ? (codeVerifier ?? "")
        : pkceChallenge(codeVerifier ?? "");

    if (expected !== codeData.codeChallenge) {
      writeOAuthDebugLog("token_response", {
        status: 400,
        reason: "pkce_mismatch",
        clientIdHash: hashForLog(clientId),
        codeHash: hashForLog(code),
        hasCodeVerifier: Boolean(codeVerifier),
        codeChallengeMethod: codeData.codeChallengeMethod,
      });
      return jsonResponse(
        {
          error: "invalid_grant",
          error_description: "Invalid PKCE code verifier.",
        },
        { status: 400 },
      );
    }
  }

  if (codeData.codeChallenge && !codeVerifier) {
    writeOAuthDebugLog("token_response", {
      status: 400,
      reason: "missing_code_verifier",
      clientIdHash: hashForLog(clientId),
      codeHash: hashForLog(code),
    });
    return jsonResponse(
      {
        error: "invalid_grant",
        error_description: "Invalid PKCE code verifier.",
      },
      { status: 400 },
    );
  }

  const { bearerToken } = getMcpConfig();
  const tokenResource = codeData.resource ?? resource ?? mcpResource();
  const tokenScope = codeData.scope;
  const nextRefreshToken = createRefreshToken({
    clientId,
    scope: tokenScope,
    resource: tokenResource,
  });
  writeOAuthDebugLog("token_response", {
    status: 200,
    grantType,
    clientIdHash: hashForLog(clientId),
    accessTokenHash: hashForLog(bearerToken),
    refreshTokenHash: hashForLog(nextRefreshToken),
    scope: tokenScope,
    resource: tokenResource,
  });
  return jsonResponse({
    access_token: bearerToken,
    token_type: "Bearer",
    expires_in: 3600,
    ...(tokenScope ? { scope: tokenScope } : {}),
    refresh_token: nextRefreshToken,
  });
}

export async function handleOAuthRevoke(request: Request) {
  const params = await readTokenParams(request);
  const basicCredentials = readBasicClientCredentials(request);
  const bodyClientId = params.get("client_id") ?? undefined;
  const clientId = bodyClientId ?? basicCredentials.clientId;
  const clientSecret = params.get("client_secret") ?? basicCredentials.clientSecret;
  const token = params.get("token");
  const tokenTypeHint = params.get("token_type_hint");

  writeOAuthDebugLog("revoke_request", {
    ...requestSnapshot(request),
    clientIdHash: hashForLog(clientId),
    bodyClientIdHash: hashForLog(bodyClientId),
    basicClientIdHash: hashForLog(basicCredentials.clientId),
    hasClientSecret: Boolean(clientSecret),
    tokenHash: hashForLog(token),
    tokenTypeHint: tokenTypeHint ?? undefined,
  });

  if (bodyClientId && basicCredentials.clientId && bodyClientId !== basicCredentials.clientId) {
    writeOAuthDebugLog("revoke_response", {
      status: 400,
      reason: "conflicting_client_credentials",
      bodyClientIdHash: hashForLog(bodyClientId),
      basicClientIdHash: hashForLog(basicCredentials.clientId),
    });
    return jsonResponse(
      {
        error: "invalid_client",
        error_description: "Conflicting client credentials.",
      },
      { status: 400 },
    );
  }

  if (clientId) {
    try {
      await validateClientCredentials(clientId, clientSecret);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid client.";
      writeOAuthDebugLog("revoke_response", {
        status: 400,
        reason: "invalid_client",
        message,
        clientIdHash: hashForLog(clientId),
      });
      return jsonResponse(
        {
          error: "invalid_client",
          error_description: message,
        },
        { status: 400 },
      );
    }
  }

  writeOAuthDebugLog("revoke_response", {
    status: 200,
    clientIdHash: hashForLog(clientId),
    tokenHash: hashForLog(token),
  });

  return new Response(null, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
  });
}
