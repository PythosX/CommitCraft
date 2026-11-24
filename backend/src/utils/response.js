/** JSON response + CORS helpers shared by every route. */

export const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function corsHeaders(origin, allowedOrigins) {
  const allowed = origin && allowedOrigins.includes(origin);
  const headers = {
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-csrf-token',
    'access-control-max-age': '600',
    'access-control-expose-headers': 'x-request-id',
    vary: 'Origin',
  };
  if (allowed) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-credentials'] = 'true';
  }
  return headers;
}

export function json(data, { status = 200, headers = {}, origin, allowedOrigins = [] } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...BASE_HEADERS,
      ...corsHeaders(origin, allowedOrigins),
      ...headers,
    },
  });
}

export function fail(status, code, message, { details, headers, origin, allowedOrigins } = {}) {
  return json({ error: { code, message, ...(details ? { details } : {}) } }, {
    status,
    headers,
    origin,
    allowedOrigins,
  });
}

export function noContent({ headers = {}, origin, allowedOrigins = [] } = {}) {
  return new Response(null, {
    status: 204,
    headers: { 'cache-control': 'no-store', ...corsHeaders(origin, allowedOrigins), ...headers },
  });
}

export function redirect(location, { headers = {}, status = 302 } = {}) {
  return new Response(null, {
    status,
    headers: { location, 'cache-control': 'no-store', ...headers },
  });
}

export function appendSetCookie(headers, cookie) {
  if (!cookie) return headers;
  const existing = headers.get?.('set-cookie');
  if (!existing) {
    headers.set('set-cookie', cookie);
    return headers;
  }
  headers.append('set-cookie', cookie);
  return headers;
}
