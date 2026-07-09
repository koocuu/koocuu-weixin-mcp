# Cloudflare Tunnel Local Deployment

This mode runs the MCP server on your Windows computer and exposes it through
Cloudflare Tunnel at `https://weixin.koocuu.com`.

Use this when Vercel outbound IP drift breaks the WeChat Official Account API IP
whitelist.

## Why This Works

Inbound traffic:

```text
Claude / WeChat callback -> weixin.koocuu.com -> Cloudflare Tunnel -> localhost:3000
```

Outbound WeChat API traffic:

```text
localhost Next.js app -> your office/home network public IP -> api.weixin.qq.com
```

Add the public outbound IP reported by `wechat_get_outbound_ip` to the WeChat API
IP whitelist.

## 1. Prepare Local Env

Copy the example file:

```powershell
Copy-Item .env.local.example .env.local
```

Fill the same values you used on Vercel:

```text
MCP_BEARER_TOKEN
WECHAT_APP_ID
WECHAT_APP_SECRET
WECHAT_TOKEN
PUBLIC_BASE_URL=https://weixin.koocuu.com
```

## 2. Start The Local MCP Server

For the first run:

```powershell
.\scripts\start-local.ps1 -Mode start -Port 3000
```

For development:

```powershell
.\scripts\start-local.ps1 -Mode dev -Port 3000
```

Local health check:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

## 3. Create A Cloudflare Tunnel

Install `cloudflared`:

```powershell
winget install --id Cloudflare.cloudflared
```

Log in:

```powershell
cloudflared tunnel login
```

Create the tunnel:

```powershell
cloudflared tunnel create koocuu-weixin-mcp
```

Route the hostname:

```powershell
cloudflared tunnel route dns koocuu-weixin-mcp weixin.koocuu.com
```

Create a config file at:

```text
%USERPROFILE%\.cloudflared\koocuu-weixin-mcp.yml
```

Example:

```yaml
tunnel: <TUNNEL_UUID>
credentials-file: C:\Users\<YOU>\.cloudflared\<TUNNEL_UUID>.json

ingress:
  - hostname: weixin.koocuu.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

Run the tunnel:

```powershell
cloudflared tunnel --config "$env:USERPROFILE\.cloudflared\koocuu-weixin-mcp.yml" run koocuu-weixin-mcp
```

## 4. Verify Public URLs

```powershell
Invoke-RestMethod https://weixin.koocuu.com/api/health
```

Expected MCP URL:

```text
https://weixin.koocuu.com/api/mcp
```

Expected WeChat callback URL:

```text
https://weixin.koocuu.com/api/wechat/callback
```

## 5. WeChat API IP Whitelist

After connecting through Claude/Codex, call:

```text
wechat_get_outbound_ip
```

Put the returned `ip` in:

```text
WeChat Developer Platform -> Official Account -> Interface Management -> API IP whitelist
```

If WeChat returns `40164 invalid ip`, call `wechat_get_outbound_ip` again and
update the whitelist.

## 6. Optional Windows Autostart

Install the local MCP scheduled task:

```powershell
.\scripts\install-autostart.ps1 -Port 3000
```

Remove it:

```powershell
.\scripts\uninstall-autostart.ps1
```

Cloudflare Tunnel can be started manually with the `cloudflared tunnel run`
command above. For a more durable setup, create a Cloudflare-managed tunnel in
the Cloudflare dashboard and install its Windows service token.

## Operational Notes

- Keep the computer awake during scheduled publishing windows.
- If the office/home public IP changes, update the WeChat API IP whitelist.
- If code changes, run `.\scripts\start-local.ps1 -Mode start -Port 3000` once
  to rebuild before relying on the autostart task.
- Keep Vercel as a preview deployment only. Production traffic for this domain
  should point to the Tunnel while using this mode.
