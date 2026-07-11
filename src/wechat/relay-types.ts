export type RelayHttpRequest = {
  op: "http";
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: string;
  bodyEncoding?: "utf8" | "base64";
};

export type RelayUploadRequest = {
  op: "upload";
  kind: "article_image" | "permanent";
  mediaUrl: string;
  filename?: string;
  type?: "image" | "thumb" | "voice" | "video";
  videoTitle?: string;
  videoIntroduction?: string;
};

export type RelayOutboundIpRequest = {
  op: "outbound_ip";
};

export type RelayRequest =
  | RelayHttpRequest
  | RelayUploadRequest
  | RelayOutboundIpRequest;
