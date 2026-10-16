import { NextResponse, type NextRequest } from 'next/server';

const PORTAL_PUBLIC = ['/portal/login', '/portal/accept', '/portal/forgot', '/portal/reset'];
const PUBLIC = ['/login', '/register', '/forgot-password', '/reset-password', '/accept-invite'];

/** Redirects anonymous visitors to the login page. Authorization itself is enforced by the API. */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  // Client portal: its own session cookie and sign-in pages. Switched off unless CLIENT_PORTAL_ENABLED=true.
  if (pathname === '/portal' || pathname.startsWith('/portal/')) {
    if (process.env.CLIENT_PORTAL_ENABLED !== 'true') return NextResponse.redirect(new URL('/', req.url));
    if (PORTAL_PUBLIC.some((p) => pathname.startsWith(p)) || req.cookies.get('vcms_psid')) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = '/portal/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  if (!req.cookies.get('vcms_sid')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/((?!api|_next|favicon.svg|.*\\.(?:png|jpg|svg|ico)$).*)'] };
