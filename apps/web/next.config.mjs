import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const isProd = process.env.NODE_ENV === 'production';

// Strict policy in production builds. Next.js inlines small bootstrap scripts, hence 'unsafe-inline' for scripts;
// everything is served from this origin (the API is proxied), and the app can never be framed.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (NEXT_OUTPUT=standalone).
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../'),
  // The client portal pages are kept but unreachable unless this matches the API's CLIENT_PORTAL_ENABLED.
  env: {
    CLIENT_PORTAL_ENABLED: process.env.CLIENT_PORTAL_ENABLED ?? 'false',
    // Multi-clinic hosting: must match the API. Clinics at <slug>.BASE_DOMAIN, super admin at PLATFORM_SUBDOMAIN.BASE_DOMAIN.
    BASE_DOMAIN: process.env.BASE_DOMAIN ?? '',
    PLATFORM_SUBDOMAIN: process.env.PLATFORM_SUBDOMAIN || 'admin',
    // Read on the server only (lib/host-server.ts) to render the clinic's branding; baked in like the rewrites.
    API_URL,
  },
  poweredByHeader: false,
  async rewrites() {
    // The browser only talks to this origin; session cookies stay first-party.
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
          ...(isProd
            ? [
                { key: 'Content-Security-Policy', value: CSP },
                { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
