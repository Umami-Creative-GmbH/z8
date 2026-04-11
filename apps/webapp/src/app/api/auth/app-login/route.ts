import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

type SupportedApp = "desktop" | "mobile";

function resolveApp(searchParams: URLSearchParams): SupportedApp {
	return searchParams.get("app") === "desktop" ? "desktop" : "mobile";
}

function getAllowedScheme(app: SupportedApp): string {
	return app === "desktop" ? "z8://" : "z8mobile://";
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

	if (!redirectUrl) {
		return NextResponse.json({ error: "Missing redirect parameter" }, { status: 400 });
	}

	const allowedScheme = getAllowedScheme(app);
	if (!redirectUrl.startsWith(allowedScheme)) {
		return NextResponse.json(
			{ error: `Invalid redirect URL. Must use ${allowedScheme} protocol` },
			{ status: 400 },
		);
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

	callbackUrl.searchParams.set("token", session.session.token);
	return NextResponse.redirect(callbackUrl.toString());
}
