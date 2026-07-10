# Tencent SCF deployment

Production runs as an SCF WebServer image function in `ap-hongkong`. The image listens on port `9000`, uses a fixed public egress IP for WeChat API allowlisting, and stores OAuth/token state in Upstash Redis.

## One-time Tencent Cloud setup

1. Open TCR Personal Edition in `ap-hongkong` and create a private namespace and repository named `koocuu-weixin-mcp`.
2. Authorize SCF to pull TCR images with `QcloudAccessForSCFRoleInPullImage`.
3. Create a CAM sub-user for GitHub Actions with access limited to the Hong Kong TCR repository and the `koocuu-weixin-mcp` SCF function.
4. Create TCR login credentials for GitHub Actions.

## GitHub configuration

Create a `production` environment and add the following repository variable:

- `TCR_NAMESPACE`

Add these environment secrets:

- `TENCENTCLOUD_SECRET_ID`
- `TENCENTCLOUD_SECRET_KEY`
- `TCR_USERNAME`
- `TCR_PASSWORD`
- `MCP_BEARER_TOKEN`
- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`
- `WECHAT_TOKEN`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Run the `Deploy Tencent SCF` workflow manually. It builds and pushes an amd64 image, creates or updates the function, enables fixed public egress, and creates a public Function URL.

## Cloudflare edge

After the SCF workflow succeeds, copy the Function URL from its job summary and verify `/api/health` on that URL. Then remove the old Tunnel public-hostname route and run `Deploy Cloudflare Worker`, passing the Function URL as `scf_origin`. The Worker binds `weixin.koocuu.com` as its custom domain and forwards all paths to SCF.

## Final checks

1. Read the fixed EIP from the SCF function network configuration and add it to the WeChat API IP allowlist.
2. Verify `https://weixin.koocuu.com/api/health`.
3. Verify the WeChat callback URL and token without changing the existing callback URL.
4. Delete and recreate the Claude connector using `https://weixin.koocuu.com/api/mcp`.
5. Keep `WECHAT_ENABLE_PUBLISH=false` until draft and publish tools have been tested with dry-run and confirmation.
