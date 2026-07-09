import { oauthAuthorizationServerMetadata } from "@/src/auth/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return oauthAuthorizationServerMetadata();
}
