import { type NextRequest, NextResponse } from "next/server";
import { resolvePublicRequestOrigin } from "@/lib/domain/request-origin";
import { setupBootstrap } from "@/lib/setup/bootstrap.server";
import {
	applySetupResponseHeaders,
	SETUP_COOKIE_NAME,
	setupCookieOptions,
} from "@/lib/setup/http";
import { ALL_LANGUAGES } from "@/tolgee/shared";

export const runtime = "nodejs";

// Next otherwise implements HEAD by invoking GET, consuming a one-time code.
export async function HEAD() {
	const response = new NextResponse(null, {
		status: 405,
		headers: { Allow: "GET" },
	});
	applySetupResponseHeaders(response);
	return response;
}

export async function GET(request: NextRequest) {
	let origin: string;
	try {
		// Validate before exchanging a one-time code. An invalid Host must never
		// consume authorization or redirect the credential-bearing request.
		origin = await resolvePublicRequestOrigin(request);
	} catch {
		const response = new NextResponse("Setup authorization unavailable", {
			status: 400,
		});
		applySetupResponseHeaders(response);
		return response;
	}
	const locale = request.nextUrl.searchParams.get("locale");
	const path =
		locale && ALL_LANGUAGES.includes(locale) ? `/${locale}/setup` : "/setup";
	const response = NextResponse.redirect(new URL(path, origin), 303);
	applySetupResponseHeaders(response);
	const cookieOptions = setupCookieOptions(
		process.env.NODE_ENV === "production" ||
			new URL(origin).protocol === "https:",
	);
	try {
		const codes = request.nextUrl.searchParams.getAll("code");
		const session =
			codes.length === 1 ? await setupBootstrap.exchange(codes[0]) : null;
		if (session) {
			response.cookies.set(SETUP_COOKIE_NAME, session.token, {
				...cookieOptions,
				maxAge: session.maxAge,
			});
			return response;
		}
	} catch {
		// A clean redirect never reflects credentials or exposes Redis/database errors.
	}
	response.cookies.set(SETUP_COOKIE_NAME, "", { ...cookieOptions, maxAge: 0 });
	return response;
}
