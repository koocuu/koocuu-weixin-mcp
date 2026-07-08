import { getWechatCallbackConfig } from "@/src/config/env";
import { verifyWechatSignature } from "@/src/wechat/signature";
import { buildTextReply, parseWechatXml } from "@/src/wechat/xml";

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function isVerified(request: Request, token: string) {
  const url = new URL(request.url);
  return verifyWechatSignature({
    token,
    timestamp: url.searchParams.get("timestamp"),
    nonce: url.searchParams.get("nonce"),
    signature: url.searchParams.get("signature"),
  });
}

export async function handleWechatCallbackGet(request: Request) {
  const config = getWechatCallbackConfig();
  const url = new URL(request.url);

  if (!isVerified(request, config.token)) {
    return textResponse("invalid signature", 403);
  }

  return textResponse(url.searchParams.get("echostr") ?? "");
}

export async function handleWechatCallbackPost(request: Request) {
  const config = getWechatCallbackConfig();

  if (!isVerified(request, config.token)) {
    return textResponse("invalid signature", 403);
  }

  if (config.messageMode !== "plain") {
    return textResponse(
      "Encrypted WeChat messages are not implemented yet. Set WECHAT_MESSAGE_MODE=plain for v1.",
      501,
    );
  }

  const incoming = parseWechatXml(await request.text());

  if (
    config.autoReplyText &&
    incoming.FromUserName &&
    incoming.ToUserName &&
    incoming.MsgType === "text"
  ) {
    return new Response(
      buildTextReply({
        toUser: incoming.FromUserName,
        fromUser: incoming.ToUserName,
        content: config.autoReplyText,
      }),
      {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
        },
      },
    );
  }

  return textResponse("success");
}
