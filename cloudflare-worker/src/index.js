const worker = {
  async fetch(request, env) {
    if (!env.SCF_ORIGIN) {
      return new Response("SCF_ORIGIN is not configured.", { status: 503 });
    }

    const incomingUrl = new URL(request.url);
    const originUrl = new URL(env.SCF_ORIGIN);
    originUrl.pathname = incomingUrl.pathname;
    originUrl.search = incomingUrl.search;

    const headers = new Headers(request.headers);
    headers.set("x-forwarded-host", incomingUrl.host);
    headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));

    const upstreamRequest = new Request(originUrl, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });

    return fetch(upstreamRequest);
  },
};

export default worker;
