import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createAppAuthCode, type SupportedApp } from "@/lib/auth/app-auth-code";

function resolveApp(searchParams: URLSearchParams): SupportedApp {
	return searchParams.get("app") === "desktop" ? "desktop" : "mobile";
}

function getAllowedScheme(app: SupportedApp): string {
	return app === "desktop" ? "z8://" : "z8mobile://";
}

function getAllowedRedirect(app: SupportedApp): string {
	return app === "desktop" ? "z8://auth/callback" : "z8mobile://auth/callback";
}

function isAllowedRedirect(redirectUrl: string, app: SupportedApp): boolean {
	try {
		const requested = new URL(redirectUrl);
		const allowed = new URL(getAllowedRedirect(app));
		return (
			requested.protocol === allowed.protocol &&
			requested.hostname === allowed.hostname &&
			requested.pathname === allowed.pathname
		);
	} catch {
		return false;
	}
}

function canUseRequestedApp(
	user: { canUseDesktop?: boolean | null; canUseMobile?: boolean | null },
	app: SupportedApp,
): boolean {
	return app === "desktop" ? (user.canUseDesktop ?? true) : (user.canUseMobile ?? true);
}

export async function GET(request: NextRequest) {
	const app = resolveApp(request.nextUrl.searchParams);
	const redirectUrl = request.nextUrl.searchParams.get("redirect");
	const codeChallenge = request.nextUrl.searchParams.get("challenge");

	if (!redirectUrl) {
		return NextResponse.json({ error: "Missing redirect parameter" }, { status: 400 });
	}

	if (!isAllowedRedirect(redirectUrl, app)) {
		return NextResponse.json(
			{ error: `Invalid redirect URL. Must be ${getAllowedRedirect(app)}` },
			{ status: 400 },
		);
	}

	if (!codeChallenge) {
		return NextResponse.json({ error: "Missing challenge parameter" }, { status: 400 });
	}

	const session = await auth.api.getSession({ headers: request.headers });

	if (!session?.user) {
		const signInUrl = new URL("/sign-in", request.nextUrl.origin);
		signInUrl.searchParams.set("callbackUrl", request.nextUrl.toString());
		return NextResponse.redirect(signInUrl.toString());
	}

	const callbackUrl = new URL(redirectUrl);
	if (!canUseRequestedApp(session.user, app)) {
		callbackUrl.searchParams.set("error", "access_denied");
		return NextResponse.redirect(callbackUrl.toString());
	}

	const authCode = await createAppAuthCode({
		app,
		codeChallenge,
		sessionToken: session.session.token,
		userId: session.user.id,
	});

	callbackUrl.searchParams.set("code", authCode.code);
	return NextResponse.redirect(callbackUrl.toString());
}
