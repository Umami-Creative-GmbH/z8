/**
 * Calendar OAuth Initiation
 *
 * Initiates the OAuth flow for connecting a calendar provider.
 * Redirects the user to the provider's authorization page.
 *
 * GET /api/calendar/oauth/google
 * GET /api/calendar/oauth/microsoft365
 */

import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { employee } from "@/db/schema";
import { getDefaultAppBaseUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { getCalendarProvider, isProviderSupported } from "@/lib/calendar-sync/providers";
import type { CalendarProvider } from "@/lib/calendar-sync/types";

// ============================================
// ROUTE HANDLER
// ============================================

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ provider: string }> },
) {
	const { provider: providerParam } = await params;

	// Validate provider
	if (providerParam !== "google" && providerParam !== "microsoft365") {
		return NextResponse.json(
			{ error: "Invalid provider. Supported: google, microsoft365" },
			{ status: 400 },
		);
	}

	const provider = providerParam as CalendarProvider;

	// Check if provider is configured
	if (!isProviderSupported(provider)) {
		return NextResponse.json(
			{ error: `${provider} calendar sync is not configured` },
			{ status: 400 },
		);
	}

	try {
		// Get authenticated session
		const headersList = await headers();
		const session = await auth.api.getSession({ headers: headersList });

		if (!session?.user) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		// Get the active organization from session
		const activeOrgId = session.session.activeOrganizationId;
		if (!activeOrgId) {
			return NextResponse.json({ error: "No active organization" }, { status: 400 });
		}

		// Get employee record
		const emp = await db.query.employee.findFirst({
			where: eq(employee.userId, session.user.id),
		});

		if (!emp) {
			return NextResponse.json({ error: "Employee not found" }, { status: 404 });
		}

		// Generate state token for CSRF protection with HMAC signature
		// Includes: employeeId, organizationId, timestamp, random nonce
		const randomToken = crypto.randomBytes(16).toString("hex");
		const payload = {
			employeeId: emp.id,
			organizationId: activeOrgId,
			token: randomToken,
			timestamp: Date.now(),
		};
		const payloadStr = JSON.stringify(payload);

		// Sign the payload with HMAC-SHA256 using BETTER_AUTH_SECRET
		const secret = process.env.BETTER_AUTH_SECRET;
		if (!secret) {
			throw new Error("BETTER_AUTH_SECRET is required for OAuth state signing");
		}
		const signature = crypto.createHmac("sha256", secret).update(payloadStr).digest("hex");

		// Combine payload and signature
		const state = Buffer.from(JSON.stringify({ payload: payloadStr, signature })).toString(
			"base64url",
		);

		// Build redirect URI
		const baseUrl = getDefaultAppBaseUrl();
		const redirectUri = `${baseUrl}/api/calendar/oauth/callback/${provider}`;

		// Get the provider and generate auth URL
		const calendarProvider = getCalendarProvider(provider);
		const authUrl = calendarProvider.getAuthorizationUrl({
			redirectUri,
			state,
		});

		// Redirect to provider's authorization page
		return NextResponse.redirect(authUrl);
	} catch (error) {
		console.error("Error initiating calendar OAuth:", error);
		return NextResponse.json({ error: "Failed to initiate calendar connection" }, { status: 500 });
	}
}
