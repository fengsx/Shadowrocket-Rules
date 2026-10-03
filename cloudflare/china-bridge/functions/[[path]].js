export async function onRequest(context) {
  const publicUrl = new URL(context.request.url);
  publicUrl.protocol = "https:";
  publicUrl.host = context.env.PUBLIC_HOST;

  const headers = new Headers(context.request.headers);
  headers.set("X-Forwarded-Host", context.env.PUBLIC_HOST);
  headers.set("X-Forwarded-Proto", "https");

  const upstreamRequest = new Request(publicUrl, {
    method: context.request.method,
    headers,
    body: ["GET", "HEAD"].includes(context.request.method) ? undefined : context.request.body,
    redirect: "manual",
  });

  return context.env.SUB.fetch(upstreamRequest);
}
