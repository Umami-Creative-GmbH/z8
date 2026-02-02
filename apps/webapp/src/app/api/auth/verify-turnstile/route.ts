import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { getDomainConfig } from "@/lib/domain";
import { checkRateLimit, createRateLimitResponse, getClientIp } from "@/lib/rate-limit";
import { DOMAIN_HEADERS } from "@/proxy";

interface TurnstileVerifyRequest {
	token: string;
}

export async function POST(request: Request) {
	try {
		// Rate limiting - use the same endpoint as auth
		const clientIp = getClientIp(request);
		const rateLimitResult = await checkRateLimit(clientIp, "auth");

		if (!rateLimitResult.allowed) {
			return createRateLimitResponse(rateLimitResult, request);
		}

		const body = (await request.json()) as TurnstileVerifyRequest;
		const { token } = body;

		if (!token) {
			return NextResponse.json({ success: false, error: "Token is required" }, { status: 400 });
		}

		// Determine organization context from domain header (set by middleware)
		// Don't trust client-supplied organizationId - derive it from the request context
		const headersList = await headers();
		const customDomain = headersList.get(DOMAIN_HEADERS.DOMAIN);

		let organizationId: string | undefined;
		let isEnterprise = false;

		if (customDomain) {
			const domainConfig = await getDomainConfig(customDomain);
			if (domainConfig) {
				organizationId = domainConfig.organizationId;
				isEnterprise = true;
			}
		}

		const result = await verifyTurnstileToken(token, organizationId, isEnterprise);

		if (result.success) {
			return NextResponse.json({ success: true });
		}

		return NextResponse.json({ success: false, error: result.error }, { status: 400 });
	} catch (error) {
		console.error("Turnstile verification error:", error);
		return NextResponse.json(
			{ success: false, error: "Internal server error" },
			{ status: 500 },
		);
	}
}
