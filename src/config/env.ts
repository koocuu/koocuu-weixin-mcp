import { z } from "zod";

const messageModeSchema = z.enum(["plain", "compatible", "secure"]);

function optionalString(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function requiredString(name: string) {
  const value = optionalString(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function splitCsv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getMcpConfig() {
  return {
    bearerToken: requiredString("MCP_BEARER_TOKEN"),
    allowedOrigins: splitCsv(optionalString("MCP_ALLOWED_ORIGINS")),
  };
}

export function getWechatApiConfig() {
  return {
    appId: requiredString("WECHAT_APP_ID"),
    appSecret: requiredString("WECHAT_APP_SECRET"),
  };
}

export function getWechatCallbackConfig() {
  return {
    token: requiredString("WECHAT_TOKEN"),
    messageMode: messageModeSchema.parse(
      optionalString("WECHAT_MESSAGE_MODE") ?? "plain",
    ),
    encodingAesKey: optionalString("WECHAT_ENCODING_AES_KEY"),
    autoReplyText: optionalString("WECHAT_AUTO_REPLY_TEXT"),
  };
}

export function getRedisConfig() {
  const url = optionalString("UPSTASH_REDIS_REST_URL");
  const token = optionalString("UPSTASH_REDIS_REST_TOKEN");

  if (!url || !token) {
    return undefined;
  }

  return { url, token };
}

export function getPublicBaseUrl() {
  return optionalString("PUBLIC_BASE_URL") ?? "https://weixin.koocuu.com";
}

export function isWechatPublishingEnabled() {
  return optionalString("WECHAT_ENABLE_PUBLISH") === "true";
}
