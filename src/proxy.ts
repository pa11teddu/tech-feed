import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isMockMode } from "@/lib/env";

/**
 * Next 16 renamed middleware.ts to proxy.ts (same behavior). This refreshes the
 * Supabase session cookie on every request and gates every route except /login.
 */
export async function proxy(request: NextRequest) {
  if (isMockMode()) return NextResponse.next();

  const path = request.nextUrl.pathname;
  const isLogin = path === "/login";
  const isApi = path.startsWith("/api/");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const deny = () =>
    isApi
      ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));

  if (!url || !key) return isLogin ? NextResponse.next() : deny();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const signedIn = Boolean(data.user);

  const withCookies = (res: NextResponse) => {
    for (const cookie of response.cookies.getAll()) res.cookies.set(cookie);
    return res;
  };

  if (!signedIn && !isLogin) return withCookies(deny());
  if (signedIn && isLogin) return withCookies(NextResponse.redirect(new URL("/", request.url)));
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|offline.html|icons/|robots.txt).*)",
  ],
};
