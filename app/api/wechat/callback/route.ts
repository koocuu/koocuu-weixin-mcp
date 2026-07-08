import {
  handleWechatCallbackGet,
  handleWechatCallbackPost,
} from "@/src/wechat/callback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleWechatCallbackGet(request);
}

export function POST(request: Request) {
  return handleWechatCallbackPost(request);
}
