import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";

import WechatAPI from "wechat-api";

import { getWechatApiConfig } from "@/src/config/env";
import { WechatApiError } from "@/src/wechat/errors";
import {
  isWechatRelayEnabled,
  relayHttp,
  relayUpload,
} from "@/src/wechat/relay-transport";
import { getTokenStore } from "@/src/wechat/token-store";

const apiBaseUrl = "https://api.weixin.qq.com";

type QueryValue = string | number | boolean | undefined;

type WechatStoredAccessToken = {
  accessToken: string;
  expireTime: number;
};

export type DraftArticle = {
  title: string;
  thumb_media_id: string;
  author?: string;
  digest?: string;
  content: string;
  content_source_url?: string;
  need_open_comment?: 0 | 1;
  only_fans_can_comment?: 0 | 1;
};

function assertWechatOk(data: unknown, status: number) {
  if (
    data &&
    typeof data === "object" &&
    "errcode" in data &&
    typeof data.errcode === "number" &&
    data.errcode !== 0
  ) {
    throw new WechatApiError("WeChat API returned an error.", data, status);
  }
}

function inferFilename(url: string) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() || "media";
  } catch {
    return "media";
  }
}

function extensionFromContentType(contentType: string) {
  if (contentType.includes("jpeg")) return ".jpg";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("mp4")) return ".mp4";
  if (contentType.includes("mpeg")) return ".mp3";
  return "";
}

function toPromise<T>(
  run: (callback: (err: Error | null, data: T, response?: unknown) => void) => void,
) {
  return new Promise<T>((resolve, reject) => {
    run((err, data) => {
      if (err) {
        reject(new WechatApiError(err.message, err));
        return;
      }
      resolve(data);
    });
  });
}

export class WechatClient {
  private readonly sdk: WechatAPI;
  private readonly tokenKey: string;
  private readonly useRelay: boolean;

  constructor(
    private readonly config: {
      appId: string;
      appSecret: string;
    },
  ) {
    this.useRelay = isWechatRelayEnabled();
    this.tokenKey = `koocuu-weixin-mcp:wechat-api:access-token:${config.appId}`;
    this.sdk = new WechatAPI(
      config.appId,
      config.appSecret,
      (callback) => {
        getTokenStore()
          .get(this.tokenKey)
          .then((value) => callback(null, value ? JSON.parse(value) : undefined))
          .catch((error) => callback(error, undefined));
      },
      (token, callback) => {
        const ttlSeconds = Math.max(
          60,
          Math.floor((token.expireTime - Date.now()) / 1000),
        );
        getTokenStore()
          .set(this.tokenKey, JSON.stringify(token), ttlSeconds)
          .then(() => callback(null))
          .catch((error) => callback(error));
      },
    );
  }

  private async fetchAccessTokenViaRelay(): Promise<WechatStoredAccessToken> {
    const result = await relayHttp({
      method: "GET",
      path: "/cgi-bin/token",
      query: {
        grant_type: "client_credential",
        appid: this.config.appId,
        secret: this.config.appSecret,
      },
    });
    const data = result.body ? JSON.parse(result.body) : {};
    if (result.status >= 400 || !data.access_token) {
      throw new WechatApiError(
        "Failed to fetch WeChat access_token via relay.",
        data,
        result.status,
      );
    }
    assertWechatOk(data, result.status);
    return {
      accessToken: String(data.access_token),
      expireTime:
        Date.now() + Math.max(60, Number(data.expires_in ?? 7200) - 120) * 1000,
    };
  }

  private async latestAccessToken() {
    if (!this.useRelay) {
      return toPromise<WechatStoredAccessToken>((callback) =>
        this.sdk.getLatestToken(callback),
      ).then((token) => token.accessToken);
    }

    const store = getTokenStore();
    const cached = await store.get(this.tokenKey);
    if (cached) {
      const parsed = JSON.parse(cached) as WechatStoredAccessToken;
      if (parsed.expireTime > Date.now() + 60_000) {
        return parsed.accessToken;
      }
    }

    const token = await this.fetchAccessTokenViaRelay();
    const ttlSeconds = Math.max(60, Math.floor((token.expireTime - Date.now()) / 1000));
    await store.set(this.tokenKey, JSON.stringify(token), ttlSeconds);
    return token.accessToken;
  }

  private async url(path: string, query?: Record<string, QueryValue>) {
    const accessToken = await this.latestAccessToken();
    const url = new URL(path, apiBaseUrl);
    url.searchParams.set("access_token", accessToken);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url;
  }

  private async json<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      query?: Record<string, QueryValue>;
      body?: unknown;
    } = {},
  ): Promise<T> {
    if (this.useRelay) {
      const accessToken = await this.latestAccessToken();
      const result = await relayHttp({
        method: options.method ?? (options.body ? "POST" : "GET"),
        path,
        query: {
          access_token: accessToken,
          ...options.query,
        },
        headers: options.body ? { "Content-Type": "application/json" } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const data = result.body ? JSON.parse(result.body) : {};
      if (result.status >= 400) {
        throw new WechatApiError("WeChat HTTP request failed.", data, result.status);
      }
      assertWechatOk(data, result.status);
      return data as T;
    }

    const response = await fetch(await this.url(path, options.query), {
      method: options.method ?? (options.body ? "POST" : "GET"),
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new WechatApiError("WeChat HTTP request failed.", data, response.status);
    }

    assertWechatOk(data, response.status);
    return data as T;
  }

  getMenu() {
    if (this.useRelay) {
      return this.json("/cgi-bin/menu/get", { method: "GET" });
    }
    return toPromise((callback) => this.sdk.getMenu(callback));
  }

  createMenu(menu: unknown) {
    if (this.useRelay) {
      return this.json("/cgi-bin/menu/create", { method: "POST", body: menu });
    }
    return toPromise((callback) => this.sdk.createMenu(menu, callback));
  }

  deleteMenu() {
    if (this.useRelay) {
      return this.json("/cgi-bin/menu/delete", { method: "GET" });
    }
    return toPromise((callback) => this.sdk.removeMenu(callback));
  }

  addDraft(articles: DraftArticle[]) {
    return this.json<{ media_id: string }>("/cgi-bin/draft/add", {
      method: "POST",
      body: { articles },
    });
  }

  updateDraft(input: { mediaId: string; index: number; article: DraftArticle }) {
    return this.json("/cgi-bin/draft/update", {
      method: "POST",
      body: {
        media_id: input.mediaId,
        index: input.index,
        articles: input.article,
      },
    });
  }

  getDraft(mediaId: string) {
    return this.json("/cgi-bin/draft/get", {
      method: "POST",
      body: { media_id: mediaId },
    });
  }

  listDrafts(input: { offset: number; count: number; noContent?: 0 | 1 }) {
    return this.json("/cgi-bin/draft/batchget", {
      method: "POST",
      body: {
        offset: input.offset,
        count: input.count,
        no_content: input.noContent ?? 0,
      },
    });
  }

  deleteDraft(mediaId: string) {
    return this.json("/cgi-bin/draft/delete", {
      method: "POST",
      body: { media_id: mediaId },
    });
  }

  publishDraft(mediaId: string) {
    return this.json<{ publish_id: string }>("/cgi-bin/freepublish/submit", {
      method: "POST",
      body: { media_id: mediaId },
    });
  }

  getPublishStatus(publishId: string) {
    return this.json("/cgi-bin/freepublish/get", {
      method: "POST",
      body: { publish_id: publishId },
    });
  }

  listPublishedArticles(input: {
    offset: number;
    count: number;
    noContent?: 0 | 1;
  }) {
    return this.json("/cgi-bin/freepublish/batchget", {
      method: "POST",
      body: {
        offset: input.offset,
        count: input.count,
        no_content: input.noContent ?? 0,
      },
    });
  }

  deletePublishedArticle(input: { articleId: string; index?: number }) {
    return this.json("/cgi-bin/freepublish/delete", {
      method: "POST",
      body: {
        article_id: input.articleId,
        index: input.index,
      },
    });
  }

  listMaterials(input: {
    type: "image" | "voice" | "video" | "news";
    offset: number;
    count: number;
  }) {
    if (this.useRelay) {
      return this.json("/cgi-bin/material/batchget_material", {
        method: "POST",
        body: {
          type: input.type,
          offset: input.offset,
          count: input.count,
        },
      });
    }
    return toPromise((callback) =>
      this.sdk.getMaterials(input.type, input.offset, input.count, callback),
    );
  }

  async getMaterial(mediaId: string, maxInlineBytes = 512_000) {
    if (this.useRelay) {
      const accessToken = await this.latestAccessToken();
      const result = await relayHttp({
        method: "POST",
        path: "/cgi-bin/material/get_material",
        query: { access_token: accessToken },
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_id: mediaId }),
      });

      if (result.bodyEncoding === "utf8") {
        const data = result.body ? JSON.parse(result.body) : {};
        if (result.status >= 400) {
          throw new WechatApiError("WeChat HTTP request failed.", data, result.status);
        }
        assertWechatOk(data, result.status);
        return data;
      }

      const buffer = Buffer.from(result.body, "base64");
      return {
        media_id: mediaId,
        byte_length: buffer.byteLength,
        base64: buffer.byteLength <= maxInlineBytes ? buffer.toString("base64") : undefined,
        note:
          buffer.byteLength > maxInlineBytes
            ? "Binary material omitted because it is larger than maxInlineBytes."
            : undefined,
      };
    }

    const data = await toPromise<unknown>((callback) =>
      this.sdk.getMaterial(mediaId, callback),
    );

    if (!Buffer.isBuffer(data)) {
      return data;
    }

    return {
      media_id: mediaId,
      byte_length: data.byteLength,
      base64: data.byteLength <= maxInlineBytes ? data.toString("base64") : undefined,
      note:
        data.byteLength > maxInlineBytes
          ? "Binary material omitted because it is larger than maxInlineBytes."
          : undefined,
    };
  }

  async uploadArticleImageFromUrl(input: { imageUrl: string; filename?: string }) {
    if (this.useRelay) {
      const accessToken = await this.latestAccessToken();
      return relayUpload({
        kind: "article_image",
        mediaUrl: input.imageUrl,
        filename: input.filename,
        accessToken,
      });
    }
    return this.withDownloadedFile(input.imageUrl, input.filename, (filepath) =>
      toPromise((callback) => this.sdk.uploadImage(filepath, callback)),
    );
  }

  async uploadPermanentMaterialFromUrl(input: {
    mediaUrl: string;
    filename?: string;
    type: "image" | "thumb" | "voice" | "video";
    videoTitle?: string;
    videoIntroduction?: string;
  }) {
    if (this.useRelay) {
      const accessToken = await this.latestAccessToken();
      return relayUpload({
        kind: "permanent",
        mediaUrl: input.mediaUrl,
        filename: input.filename,
        type: input.type,
        videoTitle: input.videoTitle,
        videoIntroduction: input.videoIntroduction,
        accessToken,
      });
    }

    return this.withDownloadedFile(input.mediaUrl, input.filename, (filepath) => {
      if (input.type === "video") {
        return toPromise((callback) =>
          this.sdk.uploadVideoMaterial(
            filepath,
            {
              title: input.videoTitle ?? input.filename ?? "video",
              introduction: input.videoIntroduction ?? "",
            },
            callback,
          ),
        );
      }

      if (input.type === "thumb") {
        return toPromise((callback) => this.sdk.uploadThumbMaterial(filepath, callback));
      }

      if (input.type === "voice") {
        return toPromise((callback) => this.sdk.uploadVoiceMaterial(filepath, callback));
      }

      return toPromise((callback) => this.sdk.uploadImageMaterial(filepath, callback));
    });
  }

  async createQrCode(input: {
    expireSeconds?: number;
    actionName: "QR_SCENE" | "QR_STR_SCENE" | "QR_LIMIT_SCENE" | "QR_LIMIT_STR_SCENE";
    sceneId?: number;
    sceneStr?: string;
  }) {
    if (input.sceneStr || this.useRelay) {
      const sceneId = input.sceneId ?? 1;
      const actionInfo = input.sceneStr
        ? { scene: { scene_str: input.sceneStr } }
        : { scene: { scene_id: sceneId } };
      const data = await this.json<{ ticket?: string }>("/cgi-bin/qrcode/create", {
        method: "POST",
        body: {
          expire_seconds: input.expireSeconds,
          action_name: input.actionName,
          action_info: actionInfo,
        },
      });
      if (data && typeof data === "object" && typeof data.ticket === "string") {
        return {
          ...data,
          url: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(data.ticket)}`,
        };
      }
      return data;
    }

    const sceneId = input.sceneId ?? 1;
    const data =
      input.actionName === "QR_SCENE"
        ? await toPromise((callback) =>
            this.sdk.createTmpQRCode(sceneId, input.expireSeconds ?? 2592000, callback),
          )
        : await toPromise((callback) => this.sdk.createLimitQRCode(sceneId, callback));

    if (data && typeof data === "object" && "ticket" in data && typeof data.ticket === "string") {
      return {
        ...data,
        url: this.sdk.showQRCodeURL(data.ticket),
      };
    }

    return data;
  }

  private async withDownloadedFile<T>(
    mediaUrl: string,
    filename: string | undefined,
    upload: (filepath: string) => Promise<T>,
  ) {
    const filepath = await this.downloadToTempFile(mediaUrl, filename);
    try {
      return await upload(filepath);
    } finally {
      await unlink(filepath).catch(() => undefined);
    }
  }

  private async downloadToTempFile(mediaUrl: string, filename?: string) {
    const response = await fetch(mediaUrl, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; koocuu-weixin-mcp/1.0; +https://weixin.koocuu.com)",
        Accept: "image/*,application/octet-stream,*/*",
      },
    });
    if (!response.ok) {
      throw new WechatApiError("Failed to download media URL before upload.", {
        mediaUrl,
        status: response.status,
      });
    }

    const contentType = response.headers.get("content-type") ?? "";
    const sourceName = filename ?? inferFilename(mediaUrl);
    const extension = extname(sourceName) || extensionFromContentType(contentType);
    const dir = join(tmpdir(), "koocuu-weixin-mcp");
    const filepath = join(dir, `${randomUUID()}${extension}`);

    await mkdir(dir, { recursive: true });
    await writeFile(filepath, Buffer.from(await response.arrayBuffer()));
    return filepath;
  }
}

export function createWechatClient() {
  return new WechatClient(getWechatApiConfig());
}
