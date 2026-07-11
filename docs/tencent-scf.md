# Tencent SCF deployment

Production runs as an SCF WebServer image function in `ap-guangzhou`.
Personal TCR images are only available in mainland regions, so Hong Kong SCF
cannot pull them. Public traffic still enters through Cloudflare Worker at
`weixin.koocuu.com` (no ICP needed). The function uses a fixed public egress IP
for WeChat API allowlisting and should store OAuth/token state in Upstash Redis.

## Current production pointers

- Region: `ap-guangzhou`
- Function: `koocuu-weixin-mcp` (namespace `default`)
- Function URL: `https://1302249545-lgmt20iu8p.ap-guangzhou.tencentscf.com`
- Fixed egress IP: `129.204.3.249`
- Public entry: `https://weixin.koocuu.com` → Worker `koocuu-weixin-mcp-proxy`
- TCR image: `ccr.ccs.tencentyun.com/koocuu/koocuu-weixin-mcp`

## One-time Tencent Cloud setup

1. Open TCR Personal Edition and create namespace `koocuu` plus repository `koocuu-weixin-mcp`.
2. Authorize `SCF_QcsRole` with `QcloudAccessForSCFRoleInPullImage`.
3. Create a CAM sub-user for GitHub Actions with SCF + TCR access.
4. Create TCR login credentials for GitHub Actions.

## GitHub configuration

Create a `Production` environment and add the repository/environment variable:

- `TCR_NAMESPACE=koocuu`

Add these environment secrets:

- `TENCENTCLOUD_SECRET_ID`
- `TENCENTCLOUD_SECRET_KEY`
- `TCR_USERNAME`
- `TCR_PASSWORD`
- `MCP_BEARER_TOKEN`
- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `WECHAT_TOKEN`
- `UPSTASH_REDIS_REST_URL` (recommended; currently empty in prod)
- `UPSTASH_REDIS_REST_TOKEN`
- `CLOUDFLARE_API_TOKEN` (must be the account that owns `koocuu.com`)
- `CLOUDFLARE_ACCOUNT_ID`

Run the `Deploy Tencent SCF` workflow manually. It builds and pushes an amd64
image, creates or updates the function, enables fixed public egress, and creates
a public Function URL.

Important: CustomImage HTTP functions must pass `Code.ImageConfig` only. Do **not**
set `CodeSource=Image` (Tencent rejects it as `InvalidParameterValue.CodeSource`).

## Hybrid architecture (Vercel MCP + SCF WeChat egress)

Claude / Cursor connect to Vercel (`koocuu-weixin.vercel.app`). Vercel sets:

- `WECHAT_RELAY_URL=https://weixin.koocuu.com` (or the SCF Function URL)
- `WECHAT_RELAY_SECRET` (defaults to `MCP_BEARER_TOKEN` if omitted)
- `PUBLIC_BASE_URL=https://koocuu-weixin.vercel.app`

SCF must **not** set `WECHAT_RELAY_URL` (direct WeChat egress). SCF receives
`WECHAT_RELAY_SECRET` so `/api/wechat-relay` can authenticate Vercel.

Do not point `weixin` at the SCF hostname with Cloudflare Full SSL; that causes
525 because the SCF cert is `*.tencentscf.com`. Keep the Worker for callback + relay.

## Final checks

1. Add the SCF fixed EIP (`129.204.3.249`) to the WeChat API IP allowlist.
2. Deploy SCF with `/api/wechat-relay`, then set Vercel `WECHAT_RELAY_*` and redeploy.
3. Claude connector URL: `https://koocuu-weixin.vercel.app/api/mcp`.
4. `wechat_get_outbound_ip` should return the SCF fixed EIP.
5. Verify WeChat callback `https://weixin.koocuu.com/api/wechat/callback`.
6. Keep `WECHAT_ENABLE_PUBLISH=false` until draft/publish tools are dry-run tested.
