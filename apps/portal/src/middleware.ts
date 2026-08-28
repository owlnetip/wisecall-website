import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Routes that require a signed-in user. /setup is public: Facebook /try runs
// SetupWizard before an account, then rings them on the test agent.
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
  return NextResponse.redirect(redirectUrl);
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
    return NextResponse.next();
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

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|owl-logo.png|favicon.png).*)"],
};
