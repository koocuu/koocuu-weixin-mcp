import { handleWechatRelayPost } from "@/src/wechat/relay-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleWechatRelayPost(request);
}
