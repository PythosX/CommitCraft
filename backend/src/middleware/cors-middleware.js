/** CORS preflight handling with a strict origin allowlist. */

import { corsHeaders } from '../utils/response.js';

export function corsPreflight(request, config) {
  const origin = request.headers.get('origin') || '';
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin, config.allowedOrigins),
      'access-control-max-age': '600',
    },
  });
}

export function isAllowedOrigin(request, config) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return config.allowedOrigins.includes(origin);
}
