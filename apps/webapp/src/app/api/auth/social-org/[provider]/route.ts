import { type NextRequest, NextResponse } from "next/server";
import type { SocialOAuthProvider } from "@/db/schema";
import { getBaseUrlFromHost } from "@/lib/app-url";
import {
	classifyDomainHost,
	getDomainConfig,
	getPlatformOrganizationLabel,
	resolvePlatformOrganization,
} from "@/lib/domain";
import { createLogger } from "@/lib/logger";
import {
	buildAuthorizationUrl,
	createOAuthState,
	generateCodeVerifier,
	generateNonce,
	resolveCredentials,
	STATE_COOKIE_MAX_AGE,
	STATE_COOKIE_NAME,
} from "@/lib/social-oauth";
import { env } from "@/env";

const logger = createLogger("SocialOAuth:Initiate");

const VALID_PROVIDERS: SocialOAuthProvider[] = ["google", "github", "linkedin", "apple"];

/**
 * Validate callback URL to prevent open redirect attacks
 */
function isValidCallbackURL(url: string): boolean {
	// Only allow relative URLs starting with /
	if (!url.startsWith("/")) return false;
	// Prevent protocol-relative URLs (//evil.com)
	if (url.startsWith("//")) return false;
	// Prevent javascript: or data: URLs
	if (/^(javascript|data|vbscript):/i.test(url)) return false;
	return true;
}

/**
 * Initiate OAuth flow for organization-specific or global credentials
 *
 * GET /api/auth/social-org/[provider]?callbackURL=/dashboard
 */
async function handleSocialOrgOAuthInitiation(
	request: NextRequest,
	{ params }: { params: Promise<{ provider: string }> },
) {
	const { provider: providerParam } = await params;

	// Validate provider
	if (!VALID_PROVIDERS.includes(providerParam as SocialOAuthProvider)) {
		return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
	}
	const provider = providerParam as SocialOAuthProvider;

	// Get callback URL from query params and validate to prevent open redirect
	const callbackURL = request.nextUrl.searchParams.get("callbackURL") || "/";
	const safeCallbackURL = isValidCallbackURL(callbackURL) ? callbackURL : "/";

	// Determine organization from domain
	const host = request.headers.get("host");
	let organizationId: string | null = null;

	if (host) {
		const normalizedHost = host.toLowerCase().replace(/:\d+$/, "");
		const domainClassification = classifyDomainHost(normalizedHost);
		if (domainClassification?.type === "unknownPlatform") {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		try {
			const platformOrganizationLabel = getPlatformOrganizationLabel(normalizedHost);
			const platformOrganization = platformOrganizationLabel
				? await resolvePlatformOrganization(platformOrganizationLabel)
				: null;
			if (platformOrganizationLabel && !platformOrganization) {
				return NextResponse.json({ error: "Not found" }, { status: 404 });
			} else if (platformOrganization) {
				organizationId = platformOrganization.id;
			} else {
				const domainConfig = await getDomainConfig(normalizedHost);
				if (domainConfig) {
					organizationId = domainConfig.organizationId;
				}
			}
		} catch (error) {
			logger.warn({ error, host }, "Failed to get domain config");
		}
	}

	// Resolve credentials (org-specific or global)
	const credentialsResult = await resolveCredentials(organizationId, provider);
	if (!credentialsResult) {
		logger.warn({ provider, organizationId }, "No credentials available for provider");
		return NextResponse.json({ error: `${provider} login is not configured` }, { status: 400 });
	}

	// Generate PKCE values and nonce
	const codeVerifier = generateCodeVerifier();
	const nonce = generateNonce();

	// Create signed state
	const state = createOAuthState({
		organizationId,
		callbackURL: safeCallbackURL,
		codeVerifier,
		nonce,
	});

	// Build redirect URI
	const baseUrl = getBaseUrlFromHost(host);
	const redirectUri = `${baseUrl}/api/auth/callback/social-org/${provider}`;

	// Build authorization URL
	const authUrl = buildAuthorizationUrl({
		provider,
		credentials: credentialsResult.credentials,
		redirectUri,
		state: Buffer.from(JSON.stringify(state)).toString("base64url"),
		codeVerifier,
		nonce,
	});

	// Redirect to provider and store state in a response cookie.
	const response = NextResponse.redirect(authUrl);
	response.cookies.set(STATE_COOKIE_NAME, JSON.stringify(state), {
		httpOnly: true,
		secure: env.NODE_ENV === "production",
		sameSite: "lax",
		maxAge: STATE_COOKIE_MAX_AGE,
		path: "/",
	});

	logger.info(
		{
			provider,
			organizationId,
			isOrgSpecific: credentialsResult.isOrgSpecific,
		},
		"Initiating OAuth flow",
	);

	return response;
}

export { handleSocialOrgOAuthInitiation as GET };
