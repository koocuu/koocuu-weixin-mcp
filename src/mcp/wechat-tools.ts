import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { renderWechatArticle } from "@/src/article/format";
import { isWechatPublishingEnabled } from "@/src/config/env";
import { toolHandler } from "@/src/mcp/result";
import { getOutboundIp } from "@/src/network/outbound-ip";
import {
  disabledRiskyActionResult,
  riskyDryRunResult,
  shouldExecuteRiskyAction,
} from "@/src/safety/confirm";
import { createWechatClient, type DraftArticle } from "@/src/wechat/client";

const articleFields = {
  title: z.string().min(1),
  author: z.string().optional(),
  digest: z.string().max(120).optional(),
  contentMarkdown: z.string().optional(),
  contentHtml: z.string().optional(),
  thumbMediaId: z.string().min(1),
  contentSourceUrl: z.string().url().optional(),
  style: z.enum(["clean", "editorial", "minimal"]).default("clean"),
  includeTitleInContent: z.boolean().default(false),
  needOpenComment: z.boolean().default(false),
  onlyFansCanComment: z.boolean().default(false),
};

type ArticleInput = {
  title: string;
  author?: string;
  digest?: string;
  contentMarkdown?: string;
  contentHtml?: string;
  thumbMediaId: string;
  contentSourceUrl?: string;
  style?: "clean" | "editorial" | "minimal";
  includeTitleInContent?: boolean;
  needOpenComment?: boolean;
  onlyFansCanComment?: boolean;
};

function toDraftArticle(input: ArticleInput): DraftArticle {
  if (!input.contentMarkdown && !input.contentHtml) {
    throw new Error("Provide contentMarkdown or contentHtml.");
  }

  const rendered = renderWechatArticle({
    title: input.title,
    markdown: input.contentMarkdown,
    html: input.contentHtml,
    style: input.style,
    includeTitleInContent: input.includeTitleInContent,
  });

  return {
    title: input.title,
    thumb_media_id: input.thumbMediaId,
    author: input.author,
    digest: input.digest,
    content: rendered.html,
    content_source_url: input.contentSourceUrl,
    need_open_comment: input.needOpenComment ? 1 : 0,
    only_fans_can_comment: input.onlyFansCanComment ? 1 : 0,
  };
}

export function registerWechatTools(server: McpServer) {
  server.registerTool(
    "wechat_get_outbound_ip",
    {
      title: "Get outbound IP",
      description:
        "Detect the public outbound IP used by this MCP server. Use it for the WeChat Official Account API IP whitelist.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    toolHandler(() => getOutboundIp()),
  );

  server.registerTool(
    "wechat_create_article_draft",
    {
      title: "Create article draft",
      description:
        "Create a WeChat Official Account draft from Markdown or HTML. It never publishes or mass-sends.",
      inputSchema: {
        ...articleFields,
        dryRun: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    toolHandler(async (input: ArticleInput & { dryRun?: boolean }) => {
      const article = toDraftArticle(input);
      if (input.dryRun) {
        return {
          dryRun: true,
          message: "No draft was created.",
          article,
        };
      }

      const result = await createWechatClient().addDraft([article]);
      return {
        ...result,
        message:
          "Draft created. Review and publish manually in the WeChat Official Account backend.",
      };
    }),
  );

  server.registerTool(
    "wechat_update_draft_article",
    {
      title: "Update draft article",
      description:
        "Update an existing article inside a WeChat draft. This overwrites draft content and requires confirm: true.",
      inputSchema: {
        ...articleFields,
        mediaId: z.string().min(1),
        index: z.number().int().min(0).default(0),
        confirm: z.boolean().default(false),
        dryRun: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    toolHandler(
      async (
        input: ArticleInput & {
          mediaId: string;
          index?: number;
          confirm?: boolean;
          dryRun?: boolean;
        },
      ) => {
        const payload = {
          mediaId: input.mediaId,
          index: input.index ?? 0,
          article: toDraftArticle(input),
        };

        if (!shouldExecuteRiskyAction(input)) {
          return riskyDryRunResult("wechat_update_draft_article", payload);
        }

        return createWechatClient().updateDraft(payload);
      },
    ),
  );

  server.registerTool(
    "wechat_get_draft",
    {
      title: "Get draft",
      description: "Read a WeChat draft by media_id.",
      inputSchema: {
        mediaId: z.string().min(1),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    toolHandler((input: { mediaId: string }) =>
      createWechatClient().getDraft(input.mediaId),
    ),
  );

  server.registerTool(
    "wechat_list_drafts",
    {
      title: "List drafts",
      description: "List WeChat drafts. Use noContent=true for lighter responses.",
      inputSchema: {
        offset: z.number().int().min(0).default(0),
        count: z.number().int().min(1).max(20).default(20),
        noContent: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    toolHandler((input: { offset?: number; count?: number; noContent?: boolean }) =>
      createWechatClient().listDrafts({
        offset: input.offset ?? 0,
        count: input.count ?? 20,
        noContent: input.noContent === false ? 0 : 1,
      }),
    ),
  );

  server.registerTool(
    "wechat_delete_draft",
    {
      title: "Delete draft",
      description:
        "Delete a WeChat draft. Risky operation, dry-run by default, requires confirm: true.",
      inputSchema: {
        mediaId: z.string().min(1),
        confirm: z.boolean().default(false),
        dryRun: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    toolHandler((input: { mediaId: string; confirm?: boolean; dryRun?: boolean }) => {
      if (!shouldExecuteRiskyAction(input)) {
        return riskyDryRunResult("wechat_delete_draft", { mediaId: input.mediaId });
      }
      return createWechatClient().deleteDraft(input.mediaId);
    }),
  );

  server.registerTool(
    "wechat_publish_draft",
    {
      title: "Publish draft",
      description:
        "Publish a WeChat draft by media_id. High-risk operation, disabled unless WECHAT_ENABLE_PUBLISH=true, dry-run by default, and requires confirm: true.",
      inputSchema: {
        mediaId: z.string().min(1),
        confirm: z.boolean().default(false),
        dryRun: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    toolHandler((input: { mediaId: string; confirm?: boolean; dryRun?: boolean }) => {
      const payload = { mediaId: input.mediaId };
      if (!isWechatPublishingEnabled()) {
        return disabledRiskyActionResult("wechat_publish_draft", payload);
      }
      if (!shouldExecuteRiskyAction(input)) {
        return riskyDryRunResult("wechat_publish_draft", payload);
      }
      return createWechatClient().publishDraft(input.mediaId);
    }),
  );

  server.registerTool(
    "wechat_get_publish_status",
    {
      title: "Get publish status",
      description:
        "Get the status of a WeChat freepublish operation by publish_id.",
      inputSchema: {
        publishId: z.string().min(1),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    toolHandler((input: { publishId: string }) =>
      createWechatClient().getPublishStatus(input.publishId),
    ),
  );

  server.registerTool(
    "wechat_list_published_articles",
    {
      title: "List published articles",
      description:
        "List successfully published WeChat articles. Use noContent=true for lighter responses.",
      inputSchema: {
        offset: z.number().int().min(0).default(0),
        count: z.number().int().min(1).max(20).default(20),
        noContent: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    toolHandler((input: { offset?: number; count?: number; noContent?: boolean }) =>
      createWechatClient().listPublishedArticles({
        offset: input.offset ?? 0,
        count: input.count ?? 20,
        noContent: input.noContent === false ? 0 : 1,
      }),
    ),
  );

  server.registerTool(
    "wechat_delete_published_article",
    {
      title: "Delete published article",
      description:
        "Delete a published WeChat article by article_id. High-risk operation, disabled unless WECHAT_ENABLE_PUBLISH=true, dry-run by default, and requires confirm: true.",
      inputSchema: {
        articleId: z.string().min(1),
        index: z.number().int().min(0).optional(),
        confirm: z.boolean().default(false),
        dryRun: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    toolHandler(
      (input: {
        articleId: string;
        index?: number;
        confirm?: boolean;
        dryRun?: boolean;
      }) => {
        const payload = { articleId: input.articleId, index: input.index };
        if (!isWechatPublishingEnabled()) {
          return disabledRiskyActionResult(
            "wechat_delete_published_article",
            payload,
          );
        }
        if (!shouldExecuteRiskyAction(input)) {
          return riskyDryRunResult("wechat_delete_published_article", payload);
        }
        return createWechatClient().deletePublishedArticle(payload);
      },
    ),
  );

  server.registerTool(
    "wechat_upload_inline_image_from_url",
    {
      title: "Upload inline article image",
      description:
        "Download an image URL and upload it to WeChat for use inside article HTML. Uses the wechat-api SDK uploadImage method.",
      inputSchema: {
        imageUrl: z.string().url(),
        filename: z.string().optional(),
        dryRun: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    toolHandler((input: { imageUrl: string; filename?: string; dryRun?: boolean }) => {
      if (input.dryRun) {
        return {
          dryRun: true,
          message: "No image was uploaded.",
          imageUrl: input.imageUrl,
        };
      }
      return createWechatClient().uploadArticleImageFromUrl(input);
    }),
  );

  server.registerTool(
    "wechat_upload_permanent_image_from_url",
    {
      title: "Upload permanent image",
      description:
        "Download an image URL and upload it as a permanent WeChat material. Use the returned media_id as draft thumbMediaId.",
      inputSchema: {
        mediaUrl: z.string().url(),
        filename: z.string().optional(),
        dryRun: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    toolHandler((input: { mediaUrl: string; filename?: string; dryRun?: boolean }) => {
      if (input.dryRun) {
        return {
          dryRun: true,
          message: "No material was uploaded.",
          mediaUrl: input.mediaUrl,
          type: "image",
        };
      }
      return createWechatClient().uploadPermanentMaterialFromUrl({
        ...input,
        type: "image",
      });
    }),
  );

  server.registerTool(
    "wechat_list_materials",
    {
      title: "List materials",
      description: "List permanent WeChat materials through the wechat-api SDK.",
      inputSchema: {
        type: z.enum(["image", "voice", "video", "news"]).default("image"),
        offset: z.number().int().min(0).default(0),
        count: z.number().int().min(1).max(20).default(20),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    toolHandler(
      (input: {
        type?: "image" | "voice" | "video" | "news";
        offset?: number;
        count?: number;
      }) =>
        createWechatClient().listMaterials({
          type: input.type ?? "image",
          offset: input.offset ?? 0,
          count: input.count ?? 20,
        }),
    ),
  );

  server.registerTool(
    "wechat_get_material",
    {
      title: "Get material",
      description:
        "Get permanent material through the wechat-api SDK. Small binary materials may be returned as base64.",
      inputSchema: {
        mediaId: z.string().min(1),
        maxInlineBytes: z.number().int().min(0).max(2_000_000).default(512_000),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    toolHandler((input: { mediaId: string; maxInlineBytes?: number }) =>
      createWechatClient().getMaterial(input.mediaId, input.maxInlineBytes),
    ),
  );

  server.registerTool(
    "wechat_get_menu",
    {
      title: "Get menu",
      description: "Read the current custom menu through the wechat-api SDK.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    toolHandler(() => createWechatClient().getMenu()),
  );

  server.registerTool(
    "wechat_create_menu",
    {
      title: "Create menu",
      description:
        "Replace the current custom menu. Risky operation, dry-run by default, requires confirm: true.",
      inputSchema: {
        menu: z.object({
          button: z.array(z.unknown()).min(1).max(3),
        }),
        confirm: z.boolean().default(false),
        dryRun: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    toolHandler((input: { menu: unknown; confirm?: boolean; dryRun?: boolean }) => {
      if (!shouldExecuteRiskyAction(input)) {
        return riskyDryRunResult("wechat_create_menu", input.menu);
      }
      return createWechatClient().createMenu(input.menu);
    }),
  );

  server.registerTool(
    "wechat_delete_menu",
    {
      title: "Delete menu",
      description:
        "Delete the current custom menu. Risky operation, dry-run by default, requires confirm: true.",
      inputSchema: {
        confirm: z.boolean().default(false),
        dryRun: z.boolean().default(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    toolHandler((input: { confirm?: boolean; dryRun?: boolean }) => {
      if (!shouldExecuteRiskyAction(input)) {
        return riskyDryRunResult("wechat_delete_menu", {});
      }
      return createWechatClient().deleteMenu();
    }),
  );

  server.registerTool(
    "wechat_create_qrcode",
    {
      title: "Create QR code",
      description:
        "Create a WeChat QR code ticket. Numeric temporary/permanent QR codes use the wechat-api SDK; string scene QR codes use the official endpoint directly.",
      inputSchema: {
        actionName: z
          .enum(["QR_SCENE", "QR_STR_SCENE", "QR_LIMIT_SCENE", "QR_LIMIT_STR_SCENE"])
          .default("QR_STR_SCENE"),
        expireSeconds: z.number().int().min(60).max(2_592_000).optional(),
        sceneId: z.number().int().positive().optional(),
        sceneStr: z.string().max(64).optional(),
        dryRun: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    toolHandler(
      (input: {
        actionName?: "QR_SCENE" | "QR_STR_SCENE" | "QR_LIMIT_SCENE" | "QR_LIMIT_STR_SCENE";
        expireSeconds?: number;
        sceneId?: number;
        sceneStr?: string;
        dryRun?: boolean;
      }) => {
        if (!input.sceneId && !input.sceneStr) {
          throw new Error("Provide sceneId or sceneStr.");
        }

        const payload = {
          actionName: input.actionName ?? (input.sceneStr ? "QR_STR_SCENE" : "QR_SCENE"),
          expireSeconds: input.expireSeconds,
          sceneId: input.sceneId,
          sceneStr: input.sceneStr,
        };

        if (input.dryRun) {
          return {
            dryRun: true,
            message: "No QR code was created.",
            payload,
          };
        }

        return createWechatClient().createQrCode(payload);
      },
    ),
  );
}
