import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "koocuu-weixin-mcp",
    time: new Date().toISOString(),
  });
}
