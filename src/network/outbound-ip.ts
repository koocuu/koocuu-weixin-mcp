import { isIP } from "node:net";

const outboundIpServices = [
  {
    name: "ipify",
    url: "https://api.ipify.org?format=json",
    parse: (text: string) => JSON.parse(text).ip as string | undefined,
  },
  {
    name: "checkip.amazonaws.com",
    url: "https://checkip.amazonaws.com",
    parse: (text: string) => text.trim(),
  },
  {
    name: "ifconfig.me",
    url: "https://ifconfig.me/ip",
    parse: (text: string) => text.trim(),
  },
];

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": "koocuu-weixin-mcp/1.0",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function getOutboundIp(timeoutMs = 5000) {
  const errors: Array<{ source: string; message: string }> = [];

  for (const service of outboundIpServices) {
    try {
      const response = await fetchWithTimeout(service.url, timeoutMs);
      const text = await response.text();

      if (!response.ok) {
        errors.push({
          source: service.name,
          message: `HTTP ${response.status}`,
        });
        continue;
      }

      const ip = service.parse(text);
      if (ip && isIP(ip)) {
        return {
          ip,
          source: service.name,
          checkedAt: new Date().toISOString(),
          note:
            "Add this IP to the WeChat Official Account API IP whitelist if WeChat API calls return 40164 invalid ip.",
        };
      }

      errors.push({
        source: service.name,
        message: "Response did not contain a valid public IP.",
      });
    } catch (error) {
      errors.push({
        source: service.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new Error(
    `Could not detect outbound IP. Tried: ${errors
      .map((error) => `${error.source}: ${error.message}`)
      .join("; ")}`,
  );
}
