import { WechatApiError } from "@/src/wechat/errors";
import { getTokenStore } from "@/src/wechat/token-store";

const tokenEndpoint = "https://api.weixin.qq.com/cgi-bin/token";

type AccessTokenResponse = {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

export async function getWechatAccessToken(input: {
  appId: string;
  appSecret: string;
}) {
  const store = getTokenStore();
  const cacheKey = `koocuu-weixin-mcp:wechat:access-token:${input.appId}`;
  const cached = await store.get(cacheKey);

  if (cached) {
    return cached;
  }

  const url = new URL(tokenEndpoint);
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", input.appId);
  url.searchParams.set("secret", input.appSecret);

  const response = await fetch(url);
  const data = (await response.json()) as AccessTokenResponse;

  if (!response.ok || !data.access_token) {
    throw new WechatApiError(
      "Failed to fetch WeChat access_token.",
      data,
      response.status,
    );
  }

  if (data.errcode && data.errcode !== 0) {
    throw new WechatApiError(
      "WeChat rejected access_token request.",
      data,
      response.status,
    );
  }

  const ttl = Math.max(60, (data.expires_in ?? 7200) - 300);
  await store.set(cacheKey, data.access_token, ttl);

  return data.access_token;
}
