import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";

import WechatAPI from "wechat-api";

import { getWechatApiConfig } from "@/src/config/env";
import { WechatApiError } from "@/src/wechat/errors";
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

  constructor(
    private readonly config: {
      appId: string;
      appSecret: string;
    },
  ) {
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

  private latestAccessToken() {
    return toPromise<WechatStoredAccessToken>((callback) =>
      this.sdk.getLatestToken(callback),
    ).then(
      (token) => token.accessToken,
    );
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
    return toPromise((callback) => this.sdk.getMenu(callback));
  }

  createMenu(menu: unknown) {
    return toPromise((callback) => this.sdk.createMenu(menu, callback));
  }

  deleteMenu() {
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

  listMaterials(input: {
    type: "image" | "voice" | "video" | "news";
    offset: number;
    count: number;
  }) {
    return toPromise((callback) =>
      this.sdk.getMaterials(input.type, input.offset, input.count, callback),
    );
  }

  async getMaterial(mediaId: string, maxInlineBytes = 512_000) {
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
    if (input.sceneStr) {
      return this.json("/cgi-bin/qrcode/create", {
        method: "POST",
        body: {
          expire_seconds: input.expireSeconds,
          action_name: input.actionName,
          action_info: { scene: { scene_str: input.sceneStr } },
        },
      });
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
    const response = await fetch(mediaUrl);
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
