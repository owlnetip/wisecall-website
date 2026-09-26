import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  resolveFirstTouchCookie,
  SIGNUP_ATTRIBUTION_COOKIE,
  SIGNUP_ATTRIBUTION_MAX_AGE_SECONDS,
} from "@/lib/signup-attribution";

// Routes that require a signed-in user. /setup is public: Facebook /try is a
// one-screen Call me flow that rings the website-drafted test agent.
const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/demo/new", "/billing"];

function isPathMatch(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function redirectToSignIn(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const redirectUrl = request.nextUrl.clone();
  const returnTo = `${pathname}${request.nextUrl.search}`;
  redirectUrl.pathname = "/";
  redirectUrl.search = "";
  const website = request.nextUrl.searchParams.get("website");
  if (website) redirectUrl.searchParams.set("website", website);
  const setup = request.nextUrl.searchParams.get("setup");
  if (setup) redirectUrl.searchParams.set("setup", setup);
  redirectUrl.searchParams.set("redirect", returnTo);
  return withFirstTouchAttribution(request, NextResponse.redirect(redirectUrl));
}

// First request that carries src/lp/utm_* wins. Later visits in the same
// browser do not replace the cookie, including when signup happens on another
// route than /setup.
function withFirstTouchAttribution(request: NextRequest, response: NextResponse) {
  const value = resolveFirstTouchCookie(
    request.cookies.get(SIGNUP_ATTRIBUTION_COOKIE)?.value,
    request.nextUrl.searchParams,
  );
  if (!value) return response;
  response.cookies.set(SIGNUP_ATTRIBUTION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SIGNUP_ATTRIBUTION_MAX_AGE_SECONDS,
  });
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = isPathMatch(pathname, PROTECTED_PREFIXES);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Preview/staging builds without Supabase env must still serve public pages.
  if (!supabaseUrl || !supabaseAnonKey) {
    if (isProtected) {
      return redirectToSignIn(request);
    }
    return withFirstTouchAttribution(request, NextResponse.next());
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: refreshes the session cookie. Do not run logic between this and the response.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtected && !user) {
    return redirectToSignIn(request);
  }

  return withFirstTouchAttribution(request, response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|owl-logo.png|favicon.png).*)"],
};
