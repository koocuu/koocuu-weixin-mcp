import {
  handleOAuthAuthorizeGet,
  handleOAuthAuthorizePost,
} from "@/src/auth/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleOAuthAuthorizeGet(request);
}

export function POST(request: Request) {
  return handleOAuthAuthorizePost(request);
}
