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

    const upstreamResponse = await fetch(
      new Request(originUrl, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      }),
    );

    const responseHeaders = new Headers(upstreamResponse.headers);
    // SCF Function URL injects Content-Disposition: attachment on responses,
    // which makes browsers download OAuth HTML instead of rendering it.
    responseHeaders.delete("content-disposition");

    // RFC 9207: Claude requires `iss` on the authorization redirect.
    if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
      const location = responseHeaders.get("location");
      if (location) {
        try {
          const redirectUrl = new URL(location);
          if (!redirectUrl.searchParams.has("iss")) {
            redirectUrl.searchParams.set("iss", incomingUrl.origin);
            responseHeaders.set("location", redirectUrl.toString());
          }
        } catch {
          // Keep upstream Location if it is not a valid absolute URL.
        }
      }
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};

export default worker;
