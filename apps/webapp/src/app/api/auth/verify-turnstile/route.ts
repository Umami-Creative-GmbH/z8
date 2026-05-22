import { NextResponse } from "next/server";
import {
	classifyDomainHost,
	getDomainConfig,
	getPlatformOrganizationLabel,
	resolvePlatformOrganization,
} from "@/lib/domain";
import { getCustomDomainFromHeaders } from "@/lib/domain/request-domain";
import { checkRateLimit, createRateLimitResponse, getClientIp } from "@/lib/rate-limit";
import { verifyTurnstileToken } from "@/lib/turnstile";

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

		// Determine organization context from the trusted Host header.
		// Don't trust client-supplied organizationId - derive it from the request context
		const host = request.headers.get("host");
		if (classifyDomainHost(host)?.type === "unknownPlatform") {
			return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
		}

		const platformOrganizationLabel = getPlatformOrganizationLabel(host);
		const platformOrganization = platformOrganizationLabel
			? await resolvePlatformOrganization(platformOrganizationLabel)
			: null;
		const customDomain = platformOrganization ? null : getCustomDomainFromHeaders(request.headers);
		const domainConfig = customDomain ? await getDomainConfig(customDomain) : null;
		const organizationId = platformOrganization?.id ?? domainConfig?.organizationId;
		const isEnterprise = !!customDomain;

		const result = await verifyTurnstileToken(token, organizationId, isEnterprise);

		if (result.success) {
			return NextResponse.json({ success: true });
		}

		return NextResponse.json({ success: false, error: result.error }, { status: 400 });
	} catch (error) {
		console.error("Turnstile verification error:", error);
		return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
	}
}
