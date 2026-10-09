import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createAppAuthCode, type SupportedApp } from "@/lib/auth/app-auth-code";
import {
	createAppSignInRedirect,
	createDesktopCallbackResponse,
} from "@/lib/auth/app-browser-sign-in";
import {
	getAllowedAppRedirect,
	getValidatedAppRedirectUrl,
} from "@/lib/auth/app-redirect";
import { createLogger } from "@/lib/logger";
import {
	checkRateLimit,
	createRateLimitResponse,
	getClientIp,
} from "@/lib/rate-limit";

const logger = createLogger("AppLogin");

/** Keep credentials, SQL parameters, arbitrary error messages and causes out of diagnostics. */
function getSafeFailureDetails(error: unknown) {
	const message = error instanceof Error ? error.message : "";
	const storageFailure =
		/^App sign-in code storage failed(?: \(SQLSTATE ([0-9A-Z]{5})\))?$/.exec(
			message,
		);
	return {
		failure: storageFailure
			? "auth_code_storage"
			: message === "Organization session invalidation failed"
				? "organization_session_invalidation"
				: "unknown",
		sqlState: storageFailure?.[1],
	};
}

function resolveApp(searchParams: URLSearchParams): SupportedApp {
	return searchParams.get("app") === "desktop" ? "desktop" : "mobile";
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

	let stage = "session_lookup";
	try {
		const session = await auth.api.getSession({ headers: request.headers });

		if (!session?.user) {
			stage = "sign_in_redirect";
			return await createAppSignInRedirect(request);
		}

		stage = "auth_code_creation";
		const authCode = await createAppAuthCode({
			app,
			codeChallenge,
			sessionToken: session.session.token,
			userId: session.user.id,
		});

		stage = "callback_redirect";
		safeCallbackUrl.searchParams.set("code", authCode.code);
		return app === "desktop"
			? createDesktopCallbackResponse(request, safeCallbackUrl)
			: NextResponse.redirect(safeCallbackUrl.toString());
	} catch (error) {
		logger.error(
			{ app, stage, ...getSafeFailureDetails(error) },
			"App sign-in failed",
		);
		throw error;
	}
}
