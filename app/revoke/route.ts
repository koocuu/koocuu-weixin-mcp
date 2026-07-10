import { handleOAuthOptions, handleOAuthRevoke } from "@/src/auth/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleOAuthRevoke(request);
}

export function OPTIONS() {
  return handleOAuthOptions();
}
