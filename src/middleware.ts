import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  // Tell Cloudflare Rocket Loader to skip all script tags
  const patched = html.replace(/<script(?!\s+data-cfasync)/g, '<script data-cfasync="false"');

  return new Response(patched, {
    status: response.status,
    headers: response.headers,
  });
});
