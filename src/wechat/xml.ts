import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
});

export type WechatIncomingMessage = {
  ToUserName?: string;
  FromUserName?: string;
  CreateTime?: string;
  MsgType?: string;
  Content?: string;
  Event?: string;
  EventKey?: string;
  MsgId?: string;
};

function cdata(value: string | undefined) {
  return `<![CDATA[${value ?? ""}]]>`;
}

export function parseWechatXml(xml: string): WechatIncomingMessage {
  const parsed = parser.parse(xml);
  return parsed?.xml ?? {};
}

export function buildTextReply(input: {
  toUser: string;
  fromUser: string;
  content: string;
}) {
  return [
    "<xml>",
    `<ToUserName>${cdata(input.toUser)}</ToUserName>`,
    `<FromUserName>${cdata(input.fromUser)}</FromUserName>`,
    `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>`,
    "<MsgType><![CDATA[text]]></MsgType>",
    `<Content>${cdata(input.content)}</Content>`,
    "</xml>",
  ].join("");
}
