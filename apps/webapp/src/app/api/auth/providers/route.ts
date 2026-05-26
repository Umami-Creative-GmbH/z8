import { NextResponse } from "next/server";
import type { SocialProviderId } from "@/lib/social-providers";
import { env } from "@/env";

/**
 * GET /api/auth/providers
 *
 * Returns list of enabled social OAuth providers based on environment configuration.
 * A provider is enabled only if both CLIENT_ID and CLIENT_SECRET are configured.
 *
 * This endpoint is public (no authentication required) and aggressively cached.
 *
 * @returns JSON response with array of enabled provider IDs
 */
export async function GET() {
	const providers: SocialProviderId[] = [];

	// Check Google OAuth credentials
	if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
		providers.push("google");
	}

	// Check GitHub OAuth credentials
	if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
		providers.push("github");
	}

	// Check LinkedIn OAuth credentials
	if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) {
		providers.push("linkedin");
	}

	// Check Apple OAuth credentials
	if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
		providers.push("apple");
	}

	return NextResponse.json(
		{ providers },
		{
			headers: {
				// Cache for 1 hour (fresh), allow stale for 24 hours with revalidation
				"Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
			},
		},
	);
}
