import { handleOAuthOptions, handleOAuthToken } from "@/src/auth/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleOAuthToken(request);
}

export function OPTIONS() {
  return handleOAuthOptions();
}
