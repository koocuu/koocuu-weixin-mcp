import { createHash, timingSafeEqual } from "node:crypto";

export function createWechatSignature(
  token: string,
  timestamp: string,
  nonce: string,
) {
  return createHash("sha1")
    .update([token, timestamp, nonce].sort().join(""))
    .digest("hex");
}

export function verifyWechatSignature(input: {
  token: string;
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
}) {
  const { token, timestamp, nonce, signature } = input;

  if (!timestamp || !nonce || !signature) {
    return false;
  }

  const expected = createWechatSignature(token, timestamp, nonce);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}
