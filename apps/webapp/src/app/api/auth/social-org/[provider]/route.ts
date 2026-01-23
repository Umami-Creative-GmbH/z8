import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import type { SocialOAuthProvider } from "@/db/schema";
import { env } from "@/env";
import { getDomainConfig } from "@/lib/domain/domain-service";
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

const logger = createLogger("SocialOAuth:Initiate");

const VALID_PROVIDERS: SocialOAuthProvider[] = ["google", "github", "linkedin", "apple"];

/**
 * Initiate OAuth flow for organization-specific or global credentials
 *
 * GET /api/auth/social-org/[provider]?callbackURL=/dashboard
 */
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ provider: string }> },
) {
	const { provider: providerParam } = await params;

	// Validate provider
	if (!VALID_PROVIDERS.includes(providerParam as SocialOAuthProvider)) {
		return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
	}
	const provider = providerParam as SocialOAuthProvider;

	// Get callback URL from query params
	const callbackURL = request.nextUrl.searchParams.get("callbackURL") || "/";

	// Determine organization from domain
	const host = request.headers.get("host");
	let organizationId: string | null = null;

	if (host) {
		const normalizedHost = host.toLowerCase().replace(/:\d+$/, "");
		try {
			const domainConfig = await getDomainConfig(normalizedHost);
			if (domainConfig) {
				organizationId = domainConfig.organizationId;
			}
		} catch (error) {
			logger.warn({ error, host }, "Failed to get domain config");
		}
	}

	// Resolve credentials (org-specific or global)
	const credentialsResult = await resolveCredentials(organizationId, provider);
	if (!credentialsResult) {
		logger.warn({ provider, organizationId }, "No credentials available for provider");
		return NextResponse.json(
			{ error: `${provider} login is not configured` },
			{ status: 400 },
		);
	}

	// Generate PKCE values and nonce
	const codeVerifier = generateCodeVerifier();
	const nonce = generateNonce();

	// Create signed state
	const state = createOAuthState({
		organizationId,
		callbackURL,
		codeVerifier,
		nonce,
	});

	// Build redirect URI
	const baseUrl = env.NEXT_PUBLIC_APP_URL || `https://${host}`;
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

	// Store state in cookie
	const cookieStore = await cookies();
	cookieStore.set(STATE_COOKIE_NAME, JSON.stringify(state), {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
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

	// Redirect to provider
	return NextResponse.redirect(authUrl);
}
