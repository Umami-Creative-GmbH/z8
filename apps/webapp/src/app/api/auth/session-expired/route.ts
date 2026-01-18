import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { DEFAULT_LANGUAGE } from "@/tolgee/shared";

/**
 * Session Expired Handler
 *
 * This route handles the case where a session cookie exists but the session
 * is invalid (expired, revoked, or corrupted). It properly clears all auth
 * cookies and redirects to sign-in.
 *
 * Security considerations:
 * - Clears all better-auth cookies to prevent stale session loops
 * - Uses secure cookie deletion with proper attributes
 * - Preserves the callback URL for post-login redirect
 * - Respects locale from the request
 */
export async function GET(request: NextRequest) {
	const cookieStore = await cookies();
	const { searchParams } = request.nextUrl;

	// Get locale from query param or detect from path/headers
	const locale = searchParams.get("locale") || DEFAULT_LANGUAGE;
	const callbackUrl = searchParams.get("callbackUrl");

	// List of all better-auth cookies to clear
	const authCookies = [
		"better-auth.session_token",
		"better-auth.session_data",
		"better-auth.session_token.sig",
	];

	// Clear all auth cookies
	for (const cookieName of authCookies) {
		cookieStore.delete({
			name: cookieName,
			path: "/",
		});
	}

	// Build sign-in URL with locale
	const signInUrl = new URL(`/${locale}/sign-in`, request.url);

	// Preserve callback URL for post-login redirect
	if (callbackUrl) {
		signInUrl.searchParams.set("callbackUrl", callbackUrl);
	}

	return NextResponse.redirect(signInUrl);
}
