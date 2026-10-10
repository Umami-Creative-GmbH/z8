import { NextResponse } from "next/server";
import { z } from "zod";
import { getAllowedAppRedirect } from "@/lib/auth/app-redirect";
import { resolvePublicRedirectOrigin } from "@/lib/domain/request-origin";
import { checkRateLimit, createRateLimitResponse, getClientIp } from "@/lib/rate-limit";
import { resolveStoreAppSignInOrigin } from "@/lib/store-app/sign-in-origin";

const bodySchema = z.object({
	email: z.email(),
	// An S256 PKCE challenge: base64url SHA-256, without padding.
	challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

/**
 * Store app sign-in start (#842): where the system browser signs in.
 *
 * Only the email's domain decides, so the answer never reveals whether an
 * account exists. The chosen origin's `/api/auth/app-login` signs in with that
 * domain's own methods and returns a one-time `mobile` code to the app.
 */
export async function POST(request: Request) {
	const rateLimitResult = await checkRateLimit(getClientIp(request), "auth");
	if (!rateLimitResult.allowed) {
		return createRateLimitResponse(rateLimitResult, request);
	}

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return NextResponse.json({ error: "Email and challenge are required" }, { status: 400 });
	}

	const mainOrigin = await resolvePublicRedirectOrigin(request);
	const signInOrigin = await resolveStoreAppSignInOrigin(parsed.data.email, mainOrigin);
	const authorizeUrl = new URL("/api/auth/app-login", signInOrigin);
	authorizeUrl.searchParams.set("app", "mobile");
	authorizeUrl.searchParams.set("redirect", getAllowedAppRedirect("mobile"));
	authorizeUrl.searchParams.set("challenge", parsed.data.challenge);

	return NextResponse.json(
		{ authorizeUrl: authorizeUrl.toString() },
		{ headers: { "Cache-Control": "no-store" } },
	);
}
