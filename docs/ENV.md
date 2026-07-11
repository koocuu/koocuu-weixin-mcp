# 环境变量对照（唯一说明文档）

本地 `.env` = **人看的清单 / 本地开发**，不是自动同步到云端。  
云端以控制台为准：Vercel Project Env、GitHub `Production` secrets（部署进 SCF）。

## 以谁为准

| 用途 | 权威来源 |
| --- | --- |
| Claude / MCP / OAuth / 微信业务密钥 | **Vercel Production** |
| 中继鉴权、SCF 运行时 | **GitHub Production secrets → Deploy SCF 写入** |
| 本地跑 `pnpm dev` | **仓库根目录 `.env` / `.env.local`** |

改密钥时：先改 `.env`（备份），再复制到 Vercel + GitHub，再 Redeploy Vercel + 重跑 Deploy SCF。

## 该有什么（混合架构）

### A. Vercel Production（MCP 入口）

| 变量 | 要不要 | 说明 |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | 必须 | `https://weixin.koocuu.com`（不要留 vercel.app 旧值） |
| `MCP_BEARER_TOKEN` | 必须 | Claude 授权页粘贴的那个 |
| `WECHAT_APP_ID` | 必须 | |
| `WECHAT_APP_SECRET` | 必须 | 换 token 用；错了会 40125 |
| `WECHAT_TOKEN` | 必须 | 回调验签 |
| `WECHAT_MESSAGE_MODE` | 建议 | `plain` |
| `WECHAT_ENABLE_PUBLISH` | 建议 | `false` |
| `WECHAT_RELAY_URL` | 必须 | `https://1302249545-lgmt20iu8p.ap-guangzhou.tencentscf.com` |
| `WECHAT_RELAY_SECRET` | 必须 | **建议 = MCP_BEARER_TOKEN** |
| `UPSTASH_REDIS_REST_*` | 可选 | 不填也能用 |
| `WECHAT_RELAY_URL` 指向自己域名 | 禁止 | 会死循环 |

### B. SCF（经 GitHub Actions 注入）

| 变量 | 要不要 | 说明 |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | 建议 | `https://weixin.koocuu.com` |
| `MCP_BEARER_TOKEN` | 建议 | 与 Vercel 相同 |
| `WECHAT_RELAY_SECRET` | 必须 | **与 Vercel 的 WECHAT_RELAY_SECRET / bearer 相同** |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 建议同步 | 与 Vercel 相同（防再踩 40125） |
| `WECHAT_TOKEN` 等 | 建议 | 与 Vercel 相同 |
| `WECHAT_RELAY_URL` | **不要设** | |
| `UPSTASH_*` | 可选 | |

GitHub `Settings → Environments → Production` secrets 决定下次 SCF 部署写什么。

### C. 本地 `.env`

与 Vercel 对齐即可；可多一行注释掉的 `WECHAT_RELAY_URL` 供本地测混合。  
**不要**写两个 `PUBLIC_BASE_URL`（后者会覆盖前者）。

## 最小同步口诀

1. 微信三件套 + bearer：**Vercel = 本地 = GitHub/SCF**  
2. 中继：`WECHAT_RELAY_URL` **只在 Vercel**；`WECHAT_RELAY_SECRET` **Vercel = SCF**  
3. Redis：想稳两边都加；懒得加两边都空着
