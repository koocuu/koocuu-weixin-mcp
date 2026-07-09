export default function Home() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Koocuu Weixin MCP</p>
        <h1>微信公众号运营工具服务</h1>
        <p className="lead">
          这个 Next.js 服务暴露远程 MCP endpoint，并提供微信公众号 callback。
          AI 可以生成排版后的公众号 HTML，上传素材，创建、修改、发布草稿，并查询发布状态。
          发布能力默认关闭，必须显式开启并确认执行。
        </p>
        <dl className="endpoints">
          <div>
            <dt>MCP endpoint</dt>
            <dd>/api/mcp</dd>
          </div>
          <div>
            <dt>WeChat callback</dt>
            <dd>/api/wechat/callback</dd>
          </div>
          <div>
            <dt>Health check</dt>
            <dd>/api/health</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
