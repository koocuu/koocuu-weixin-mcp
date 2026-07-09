# koocuu-weixin-mcp

Remote MCP server for managing a WeChat Official Account from AI clients such as Claude, Codex, and ChatGPT.

The project is an independent Next.js app intended for Vercel deployment at:

- MCP endpoint: `https://weixin.koocuu.com/api/mcp`
- WeChat callback: `https://weixin.koocuu.com/api/wechat/callback`
- Health check: `https://weixin.koocuu.com/api/health`

## What It Can Do

- Render WeChat-friendly article HTML from Markdown or HTML.
- Upload article images and permanent image materials.
- Create, update, read, list, and delete drafts.
- Read and replace custom menus.
- Create QR code tickets.
- Publish drafts through WeChat freepublish APIs when explicitly enabled.
- Check publish status and list/delete published articles.
- Handle the basic WeChat callback verification flow and optional plain text auto-reply.

The server is designed for a single owner account. It does not implement multi-user OAuth or account isolation.

## Safety Model

Publishing and deletion are high-risk operations.

- Risky tools default to `dryRun: true`.
- Risky tools require `confirm: true` and `dryRun: false` to execute.
- Publishing tools are additionally disabled unless `WECHAT_ENABLE_PUBLISH=true`.
- There are no mass-send tools in the default MCP surface.

For fully automated publishing, configure the deployment with `WECHAT_ENABLE_PUBLISH=true`, then make the scheduled AI task explicitly pass `confirm: true` and `dryRun: false` only after it has created and reviewed the draft payload.

## Environment Variables

Required:

```bash
MCP_BEARER_TOKEN=
WECHAT_APP_ID=
WECHAT_APP_SECRET=
WECHAT_TOKEN=
```

Recommended:

```bash
PUBLIC_BASE_URL=https://weixin.koocuu.com
MCP_ALLOWED_ORIGINS=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Optional:

```bash
WECHAT_MESSAGE_MODE=plain
WECHAT_ENCODING_AES_KEY=
WECHAT_AUTO_REPLY_TEXT=
WECHAT_ENABLE_PUBLISH=false
```

Use Upstash Redis on Vercel if you want access tokens to survive serverless cold starts. Without Redis, the server falls back to an in-memory token store.

## Suggested Automation Flow

1. Pick one topic from the topic library.
2. Generate the article outline, body, digest, and cover direction.
3. Upload the cover image as a permanent image material.
4. Upload inline images before placing them in article HTML.
5. Create a draft with `wechat_create_article_draft`.
6. Read the draft back with `wechat_get_draft` for a final sanity check.
7. Publish with `wechat_publish_draft` only when publishing is enabled and the automation intentionally passes `confirm: true` and `dryRun: false`.
8. Poll `wechat_get_publish_status` until WeChat reports success or failure.

## Local Development

```bash
pnpm install
pnpm dev
```

Verification:

```bash
pnpm typecheck
pnpm lint
pnpm test
```

