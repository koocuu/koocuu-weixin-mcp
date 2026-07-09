import { handleOAuthClientRegistration } from "@/src/auth/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleOAuthClientRegistration(request);
}
