import { json } from "./http";
import { allowedMethodsForPath } from "./routes";
import type { Env, RequestContext } from "./types";

const allowedCorsRequestHeaders = new Set(["authorization", "content-type", "idempotency-key"]);

const baseSecurityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cache-control": "no-store"
};

const adminContentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'"
].join("; ");

export function handleOptions(request: Request, env: Env, url: URL): Response {
  const allowedMethods = allowedMethodsForPath(url.pathname);
  const requestedMethod = request.headers.get("access-control-request-method")?.trim().toUpperCase();
  const requestedHeaders = parseRequestedHeaders(request.headers.get("access-control-request-headers"));

  if (allowedMethods.length === 0 || !requestedMethod || !allowedMethods.includes(requestedMethod)) {
    return json({ error: "cors_route_not_allowed" }, 404);
  }

  if (!isAllowedCorsOrigin(request, env)) {
    return json({ error: "cors_origin_not_allowed" }, 403);
  }

  if (requestedHeaders.some((header) => !allowedCorsRequestHeaders.has(header))) {
    return json({ error: "cors_header_not_allowed" }, 403);
  }

  const response = new Response(null, { status: 204 });
  response.headers.set("access-control-allow-methods", [...allowedMethods, "OPTIONS"].join(", "));
  response.headers.set("access-control-allow-headers", [...allowedCorsRequestHeaders].join(", "));
  response.headers.set("access-control-max-age", "600");
  return response;
}

export function finalizeResponse(response: Response, request: Request, env: Env, context: RequestContext): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", context.requestId);
  applySecurityHeaders(headers);
  applyCorsHeaders(headers, request, env);

  if (headers.get("content-type")?.toLowerCase().includes("text/html")) {
    headers.set("content-security-policy", adminContentSecurityPolicy);
  }

  const finalized = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
  logRequest(context, finalized.status);
  return finalized;
}

function applySecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(baseSecurityHeaders)) {
    if (!headers.has(name)) {
      headers.set(name, value);
    }
  }
}

function applyCorsHeaders(headers: Headers, request: Request, env: Env): void {
  const allowedOrigin = allowedCorsOrigin(request, env);
  if (!allowedOrigin) {
    return;
  }

  headers.set("access-control-allow-origin", allowedOrigin);
  headers.set("vary", appendVary(headers.get("vary"), "Origin"));
}

function allowedCorsOrigin(request: Request, env: Env): string | null {
  const origin = normalizeOrigin(request.headers.get("origin"));
  if (!origin) {
    return null;
  }

  const requestOrigin = normalizeOrigin(new URL(request.url).origin);
  if (origin === requestOrigin) {
    return origin;
  }

  return configuredAllowedOrigins(env).has(origin) ? origin : null;
}

function isAllowedCorsOrigin(request: Request, env: Env): boolean {
  return !request.headers.has("origin") || allowedCorsOrigin(request, env) != null;
}

function configuredAllowedOrigins(env: Env): Set<string> {
  return new Set(
    (env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map(normalizeOrigin)
      .filter((origin): origin is string => origin != null)
  );
}

function normalizeOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    return url.origin;
  } catch {
    return null;
  }
}

function parseRequestedHeaders(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
}

function appendVary(currentValue: string | null, nextValue: string): string {
  const existing = (currentValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (existing.some((value) => value.toLowerCase() === nextValue.toLowerCase())) {
    return existing.join(", ");
  }

  return [...existing, nextValue].join(", ");
}

function logRequest(context: RequestContext, status: number): void {
  const event = {
    event: "http.request",
    requestId: context.requestId,
    method: context.method,
    route: context.route,
    status,
    latencyMs: Date.now() - context.startedAt,
    companyId: context.companyId ?? null,
    userId: context.userId ?? null,
    deviceId: context.deviceId ?? null,
    actorType: context.actorType ?? "anonymous"
  };

  const serialized = JSON.stringify(event);
  if (status >= 500) {
    console.error(serialized);
  } else {
    console.log(serialized);
  }
}
