import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createAppAuthCode, type SupportedApp } from "@/lib/auth/app-auth-code";
import {
	getAllowedAppRedirect,
	getValidatedAppRedirectUrl,
} from "@/lib/auth/app-redirect";
import {
	checkRateLimit,
	createRateLimitResponse,
	getClientIp,
} from "@/lib/rate-limit";

function resolveApp(searchParams: URLSearchParams): SupportedApp {
	return searchParams.get("app") === "desktop" ? "desktop" : "mobile";
}

function canUseRequestedApp(
	user: { canUseDesktop?: boolean | null; canUseMobile?: boolean | null },
	app: SupportedApp,
): boolean {
	return app === "desktop"
		? (user.canUseDesktop ?? true)
		: (user.canUseMobile ?? true);
}

export async function GET(request: NextRequest) {
	const clientIp = getClientIp(request);
	const rateLimitResult = await checkRateLimit(clientIp, "auth");
	if (!rateLimitResult.allowed) {
		return createRateLimitResponse(rateLimitResult, request);
	}

	const app = resolveApp(request.nextUrl.searchParams);
	const redirectUrl = request.nextUrl.searchParams.get("redirect");
	const codeChallenge = request.nextUrl.searchParams.get("challenge");

	if (!redirectUrl) {
		return NextResponse.json(
			{ error: "Missing redirect parameter" },
			{ status: 400 },
		);
	}

	const safeCallbackUrl = getValidatedAppRedirectUrl(redirectUrl, app);
	if (!safeCallbackUrl) {
		return NextResponse.json(
			{ error: `Invalid redirect URL. Must be ${getAllowedAppRedirect(app)}` },
			{ status: 400 },
		);
	}

	if (!codeChallenge) {
		return NextResponse.json(
			{ error: "Missing challenge parameter" },
			{ status: 400 },
		);
	}

	const session = await auth.api.getSession({ headers: request.headers });

	if (!session?.user) {
		const signInUrl = new URL("/sign-in", request.nextUrl.origin);
		signInUrl.searchParams.set("callbackUrl", request.nextUrl.toString());
		return NextResponse.redirect(signInUrl.toString());
	}

	if (!canUseRequestedApp(session.user, app)) {
		safeCallbackUrl.searchParams.set("error", "access_denied");
		return NextResponse.redirect(safeCallbackUrl.toString());
	}

	const authCode = await createAppAuthCode({
		app,
		codeChallenge,
		sessionToken: session.session.token,
		userId: session.user.id,
	});

	safeCallbackUrl.searchParams.set("code", authCode.code);
	return NextResponse.redirect(safeCallbackUrl.toString());
}
