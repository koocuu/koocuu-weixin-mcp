import { NextResponse } from "next/server";

import { getWechatRelayConfig } from "@/src/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const relay = getWechatRelayConfig();
  return NextResponse.json({
    ok: true,
    service: "koocuu-weixin-mcp",
    time: new Date().toISOString(),
    wechatRelay: relay
      ? { enabled: true, url: relay.url }
      : { enabled: false },
  });
}
