import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { renderWechatArticle } from "@/src/article/format";
import { getPublicBaseUrl } from "@/src/config/env";
import { jsonToolResult } from "@/src/mcp/result";
import { registerWechatTools } from "@/src/mcp/wechat-tools";

export function createMcpServer() {
  const server = new McpServer({
    name: "koocuu-weixin-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "wechat_render_article_html",
    {
      title: "Render WeChat article HTML",
      description:
        "Convert Markdown or HTML into WeChat-friendly inline-styled article HTML. This does not call WeChat APIs.",
      inputSchema: z.object({
        title: z.string().min(1),
        markdown: z.string().optional(),
        html: z.string().optional(),
        style: z.enum(["clean", "editorial", "minimal"]).default("clean"),
        includeTitleInContent: z.boolean().default(false),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (input) => jsonToolResult(renderWechatArticle(input)),
  );

  server.registerPrompt(
    "wechat_article_workflow",
    {
      title: "WeChat article draft workflow",
      description:
        "Guide an AI client through writing, formatting, image upload, and WeChat draft creation.",
      argsSchema: {
        topic: z.string().min(1),
        audience: z.string().optional(),
      },
    },
    ({ topic, audience }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `请围绕“${topic}”写一篇微信公众号文章。`,
              audience ? `目标读者：${audience}。` : undefined,
              "流程：先生成大纲和正文；调用 wechat_render_article_html 排版；如需图片，先上传正文图或封面图；最后只创建草稿，不要发布或群发。",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerResource(
    "service_endpoints",
    "koocuu://weixin-mcp/endpoints",
    {
      title: "Service endpoints",
      description: "Public URLs for the MCP server and WeChat callback.",
      mimeType: "application/json",
    },
    async (uri) => {
      const baseUrl = getPublicBaseUrl();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                baseUrl,
                mcp: `${baseUrl}/api/mcp`,
                wechatCallback: `${baseUrl}/api/wechat/callback`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  registerWechatTools(server);
  return server;
}
