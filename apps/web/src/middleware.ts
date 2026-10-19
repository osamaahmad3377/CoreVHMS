import { NextResponse, type NextRequest } from 'next/server';

const PORTAL_PUBLIC = ['/portal/login', '/portal/accept', '/portal/forgot', '/portal/reset'];
const PUBLIC = ['/login', '/register', '/forgot-password', '/reset-password', '/accept-invite'];
/** Sign-in pages at the super admin address (no self-registration or invitations there). */
const PLATFORM_PUBLIC = ['/login', '/forgot-password', '/reset-password'];

// Multi-clinic hosting (baked in at build time; must match the API's BASE_DOMAIN and PLATFORM_SUBDOMAIN).
const BASE_DOMAIN = process.env.BASE_DOMAIN ?? '';
const PLATFORM_SUBDOMAIN = process.env.PLATFORM_SUBDOMAIN || 'admin';

type Area = 'single' | 'platform' | 'root' | 'clinic';

function areaFor(req: NextRequest): Area {
  if (!BASE_DOMAIN) return 'single';
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
  if (host === `${PLATFORM_SUBDOMAIN}.${BASE_DOMAIN}`) return 'platform';
  if (host.endsWith(`.${BASE_DOMAIN}`) && host !== `www.${BASE_DOMAIN}`) return 'clinic';
  return 'root';
}

function goTo(req: NextRequest, pathname: string, search = '') {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  return NextResponse.redirect(url);
}

const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(base + '/');

/** Redirects anonymous visitors to the login page. Authorization itself is enforced by the API. */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const area = areaFor(req);

  // Bare domain: there is no clinic here, only "find your clinic".
  if (area === 'root') return pathname === '/find-clinic' ? NextResponse.next() : goTo(req, '/find-clinic');

  if (area === 'platform') {
    if (PLATFORM_PUBLIC.some((p) => under(pathname, p))) return NextResponse.next();
    if (!under(pathname, '/platform')) return goTo(req, '/platform');
    if (!req.cookies.get('vcms_sid')) return goTo(req, '/login', `?next=${encodeURIComponent(pathname + search)}`);
    return NextResponse.next();
  }

  if (under(pathname, '/platform') || under(pathname, '/find-clinic')) return goTo(req, '/dashboard');
  // Clinics are added by the super admin, never by self-registration.
  if (area === 'clinic' && under(pathname, '/register')) return goTo(req, '/login');

  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  // Client portal: its own session cookie and sign-in pages. Switched off unless CLIENT_PORTAL_ENABLED=true.
  if (pathname === '/portal' || pathname.startsWith('/portal/')) {
    if (process.env.CLIENT_PORTAL_ENABLED !== 'true') return NextResponse.redirect(new URL('/', req.url));
    if (PORTAL_PUBLIC.some((p) => pathname.startsWith(p)) || req.cookies.get('vcms_psid')) return NextResponse.next();
    return goTo(req, '/portal/login');
  }
  if (!req.cookies.get('vcms_sid')) return goTo(req, '/login', pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`);
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|_next|favicon.svg|.*\\.(?:png|jpg|svg|ico)$).*)'] };
