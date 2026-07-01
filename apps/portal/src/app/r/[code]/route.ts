import { NextResponse, type NextRequest } from "next/server";

// Clean partner referral link: /r/CODE → /signup?ref=CODE. Lets partners share
// app.wisecall.io/r/their-code instead of a query string.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const url = new URL("/signup", _req.nextUrl.origin);
  if (code) url.searchParams.set("ref", code);
  return NextResponse.redirect(url);
}
