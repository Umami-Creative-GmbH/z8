import { type NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { createAppAuthCode } from "@/lib/auth/app-auth-code";

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
		return NextResponse.json({ error: "Missing redirect parameter" }, { status: 400 });
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
		// Check if user has desktop app access
		const canUseDesktop = session.user.canUseDesktop ?? true;
		if (!canUseDesktop) {
			// Redirect to desktop app with error
			const callbackUrl = new URL(redirectUrl);
			callbackUrl.searchParams.set("error", "access_denied");
			callbackUrl.searchParams.set(
				"error_description",
				"Your account does not have access to the desktop application. Please contact your administrator.",
			);
			return NextResponse.redirect(callbackUrl.toString());
		}

		const authCode = await createAppAuthCode({
			app: "desktop",
			sessionToken: session.session.token,
			userId: session.user.id,
		});

		// Redirect back to desktop app with a one-time code.
		const callbackUrl = new URL(redirectUrl);
		callbackUrl.searchParams.set("code", authCode.code);

		return NextResponse.redirect(callbackUrl.toString());
	}

	// User not logged in, continue through sign-in and then resume this auth route.
	const loginUrl = new URL("/sign-in", request.nextUrl.origin);
	loginUrl.searchParams.set("callbackUrl", request.nextUrl.toString());

	return NextResponse.redirect(loginUrl.toString());
}
