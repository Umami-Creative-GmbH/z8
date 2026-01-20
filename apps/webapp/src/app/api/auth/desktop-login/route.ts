import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * GET /api/auth/desktop-login
 * Initiates OAuth login for desktop app, redirects to callback with token
 *
 * Query params:
 * - redirect: The desktop app callback URL (e.g., z8://auth/callback)
 */
export async function GET(request: NextRequest) {
	const searchParams = request.nextUrl.searchParams;
	const redirectUrl = searchParams.get("redirect");

	if (!redirectUrl) {
		return NextResponse.json(
			{ error: "Missing redirect parameter" },
			{ status: 400 },
		);
	}

	// Validate the redirect URL is a valid z8:// protocol
	if (!redirectUrl.startsWith("z8://")) {
		return NextResponse.json(
			{ error: "Invalid redirect URL. Must be z8:// protocol" },
			{ status: 400 },
		);
	}

	// Check if user is already authenticated
	const session = await auth.api.getSession({ headers: await headers() });

	if (session?.user) {
		// User is already logged in, generate a token and redirect
		// For security, we create a short-lived session token for the desktop app
		const token = session.session.token;

		// Redirect back to desktop app with token
		const callbackUrl = new URL(redirectUrl);
		callbackUrl.searchParams.set("token", token);

		return NextResponse.redirect(callbackUrl.toString());
	}

	// User not logged in, show login page with desktop redirect
	const loginUrl = new URL("/sign-in", request.nextUrl.origin);
	loginUrl.searchParams.set("desktop_redirect", redirectUrl);

	return NextResponse.redirect(loginUrl.toString());
}
