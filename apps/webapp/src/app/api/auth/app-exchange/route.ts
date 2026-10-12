import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { consumeAppAuthCode, type SupportedApp } from "@/lib/auth/app-auth-code";
import { isStoreApp } from "@/lib/auth/app-redirect";
import { resolvePublicRequestOrigin } from "@/lib/domain/request-origin";
import { checkRateLimit, createRateLimitResponse, getClientIp } from "@/lib/rate-limit";

const bodySchema = z.object({
	code: z.string().trim().min(1),
	verifier: z.string().trim().min(1),
});

function resolveAppType(request: Request): SupportedApp | null {
	const appType = request.headers.get("x-z8-app-type")?.toLowerCase();

	return appType === "mobile" || appType === "desktop" ? appType : null;
}

function invalidCode() {
	return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
}

/**
 * The store app exchanges from inside its web view, so the response can set
 * the session cookie on the web view's own origin. A cross-site page cannot
 * send the custom app-type header without a CORS preflight, which this route
 * never grants; the Origin check refuses any other page as well.
 */
async function isSameOriginWebViewRequest(request: Request): Promise<boolean> {
	const origin = request.headers.get("origin");
	if (!origin) return false;
	try {
		return origin === (await resolvePublicRequestOrigin(request));
	} catch {
		return false;
	}
}

/** Mobile receives a session cookie, never the session token itself. */
async function handOffStoreAppSession(request: Request, sessionToken: string) {
	let cookies: string[];
	try {
		const { headers } = await auth.api.setStoreAppSessionCookie({
			body: { sessionToken },
			headers: request.headers,
			returnHeaders: true,
		});
		cookies = headers.getSetCookie();
	} catch {
		// The session was revoked or expired after the code was issued.
		return invalidCode();
	}

	const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
	for (const cookie of cookies) response.headers.append("set-cookie", cookie);
	return response;
}

export async function POST(request: Request) {
	const clientIp = getClientIp(request);
	const rateLimitResult = await checkRateLimit(clientIp, "auth");
	if (!rateLimitResult.allowed) {
		return createRateLimitResponse(rateLimitResult, request);
	}

	const app = resolveAppType(request);
	if (!app) {
		return NextResponse.json({ error: "Supported app type required" }, { status: 400 });
	}

	if (isStoreApp(app) && !(await isSameOriginWebViewRequest(request))) {
		return NextResponse.json({ error: "Same-origin request required" }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	const parsed = bodySchema.safeParse(body);
	if (!parsed.success) {
		return NextResponse.json({ error: "Code and verifier are required" }, { status: 400 });
	}

	const result = await consumeAppAuthCode({
		app,
		code: parsed.data.code,
		verifier: parsed.data.verifier,
	});
	if (result.status !== "success") {
		return invalidCode();
	}

	if (isStoreApp(app)) {
		return handOffStoreAppSession(request, result.sessionToken);
	}

	return NextResponse.json({ token: result.sessionToken });
}
