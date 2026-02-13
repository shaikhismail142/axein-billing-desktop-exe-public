import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// Keep headers no-store to avoid caching activation status
const NO_STORE_HEADERS = {
  "cache-control": "no-store",
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const keygenMode = process.env.AXEIN_INCLUDE_KEYGEN_UI === "1";

  // Allow static and public assets without checks
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/assets/") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".map") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".svg")
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // In customer billing runtime, staff keygen UI must stay inaccessible.
  if (!keygenMode && pathname.startsWith("/staff/keygen")) {
    const url = req.nextUrl.clone();
    url.pathname = "/activate";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // In staff keygen runtime, force all page navigation into keygen screen.
  if (keygenMode && !pathname.startsWith("/staff/keygen")) {
    const url = req.nextUrl.clone();
    url.pathname = "/staff/keygen";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Allow activation routes and license APIs themselves
  if (
    pathname.startsWith("/activate") ||
    pathname.startsWith("/register-business") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/staff/keygen")
  ) {
    return NextResponse.next();
  }

  // Probe license status only
  const licURL = req.nextUrl.clone();
  licURL.pathname = "/api/license/status";
  licURL.search = "";

  try {
    const licRes = await fetch(licURL, {
      cache: "no-store",
      headers: NO_STORE_HEADERS as any,
    });

    if (!licRes.ok) return NextResponse.next();
    const j = (await licRes.json().catch(() => ({}))) as any;

    const activated = Boolean(j?.isLicensed || j?.trialActive);
    if (!activated) {
      const url = req.nextUrl.clone();
      url.pathname = "/activate";
      url.search = "";
      return NextResponse.redirect(url);
    }

    // For activated business pages, require user login session.
    const authURL = req.nextUrl.clone();
    authURL.pathname = "/api/auth/session";
    authURL.search = "";
    const authRes = await fetch(authURL, {
      cache: "no-store",
      headers: {
        ...NO_STORE_HEADERS,
        cookie: req.headers.get("cookie") || "",
      } as any,
    });
    if (authRes.ok) {
      const auth = (await authRes.json().catch(() => ({}))) as any;
      if (auth?.authenticated) {
        return NextResponse.next();
      }

      const loginURL = req.nextUrl.clone();
      loginURL.pathname = "/login";
      loginURL.search = "";
      return NextResponse.redirect(loginURL);
    }

    return NextResponse.next();
  } catch {
    // Fail open if status endpoint fails (prevents hard lockouts)
    return NextResponse.next();
  }
}

// Run middleware on all app paths (adjust as you need)
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
