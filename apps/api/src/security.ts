import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';

const DEV_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function parseOrigins(raw: string | undefined): readonly string[] {
  return raw
    ?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0) ?? [];
}

const configuredOrigins = parseOrigins(process.env['API_CORS_ORIGINS']);
const corsOrigins =
  configuredOrigins.length > 0 || process.env['NODE_ENV'] === 'production'
    ? configuredOrigins
    : DEV_CORS_ORIGINS;

function isSameOrigin(origin: string, c: Context): boolean {
  return origin === new URL(c.req.url).origin;
}

function isAllowedOrigin(origin: string, c: Context): boolean {
  return isSameOrigin(origin, c) || corsOrigins.includes(origin);
}

export const securityHeadersMiddleware = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
  },
  referrerPolicy: 'no-referrer',
  xFrameOptions: 'DENY',
  xContentTypeOptions: 'nosniff',
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
});

export const corsMiddleware = cors({
  origin: (origin, c) => (isAllowedOrigin(origin, c) ? origin : null),
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
  credentials: true,
  maxAge: 600,
});

export const csrfMiddleware = csrf({
  origin: isAllowedOrigin,
  secFetchSite: ['same-origin', 'same-site', 'none'],
});
