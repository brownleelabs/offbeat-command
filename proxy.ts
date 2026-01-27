import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error(
      "[proxy] ❌ Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Add them to Vercel environment variables."
    );
    return response;
  }

  // Log cookie info for debugging (only in production to avoid spam)
  const allCookies = request.cookies.getAll();
  const supabaseCookies = allCookies.filter((c) =>
    c.name.includes('supabase') || c.name.includes('sb-')
  );
  if (supabaseCookies.length === 0 && process.env.NODE_ENV === 'production') {
    console.warn('[proxy] ⚠️ No Supabase auth cookies found in request:', {
      pathname: request.nextUrl.pathname,
      totalCookies: allCookies.length,
      cookieNames: allCookies.map((c) => c.name),
    });
  }

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // FIX: Explicitly typed parameter to satisfy Vercel build
        setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    // If auth check fails, log detailed error info
    if (authError) {
      console.warn('[proxy] ⚠️ Auth check failed:', {
        message: authError.message,
        name: authError.name,
        status: authError.status,
        pathname: request.nextUrl.pathname,
        hasCookies: allCookies.length > 0,
        supabaseCookieCount: supabaseCookies.length,
      });
      // If not on login page and auth fails, redirect to login
      if (request.nextUrl.pathname !== "/login") {
        return NextResponse.redirect(new URL("/login", request.url));
      }
      return response;
    }

    // 1. If user is missing and NOT on the login page, kick them to login
    if (!user && request.nextUrl.pathname !== "/login") {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // 2. If user is logged in and ON the login page, kick them to dashboard
    if (user && request.nextUrl.pathname === "/login") {
      return NextResponse.redirect(new URL("/", request.url));
    }
  } catch (err) {
    console.error('[proxy] ❌ Unexpected error during auth check:', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      name: err instanceof Error ? err.name : typeof err,
      pathname: request.nextUrl.pathname,
      hasUrl: !!url,
      hasAnonKey: !!anonKey,
    });
    // On error, redirect to login for safety
    if (request.nextUrl.pathname !== "/login") {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|claim|schools).*)",
  ],
};
