/**
 * Calendar OAuth Callback
 *
 * Handles the OAuth callback from calendar providers.
 * Exchanges the authorization code for tokens and stores the connection.
 *
 * GET /api/calendar/oauth/callback/google
 * GET /api/calendar/oauth/callback/microsoft365
 */

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { calendarConnection, employee } from "@/db/schema";
import { getDefaultAppBaseUrl } from "@/lib/app-url";
import { getCalendarProvider, isProviderSupported } from "@/lib/calendar-sync/providers";
import { storeCalendarTokens } from "@/lib/calendar-sync/token-store";
import type { CalendarProvider } from "@/lib/calendar-sync/types";

// ============================================
// TYPES
// ============================================

interface StatePayload {
	employeeId: string;
	organizationId: string;
	token: string;
	timestamp: number;
}

interface SignedState {
	payload: string;
	signature: string;
}

// Maximum age for state token (10 minutes)
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// ============================================
// ROUTE HANDLER
// ============================================

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ provider: string }> },
) {
	const { provider: providerParam } = await params;

	// Validate provider
	if (providerParam !== "google" && providerParam !== "microsoft365") {
		return redirectWithError("Invalid provider");
	}

	const provider = providerParam as CalendarProvider;

	if (!isProviderSupported(provider)) {
		return redirectWithError(`${provider} calendar sync is not configured`);
	}

	try {
		// Get query parameters
		const searchParams = request.nextUrl.searchParams;
		const code = searchParams.get("code");
		const state = searchParams.get("state");
		const error = searchParams.get("error");

		// Check for OAuth error
		if (error) {
			const errorDescription = searchParams.get("error_description") || error;
			return redirectWithError(errorDescription);
		}

		// Validate required parameters
		if (!code || !state) {
			return redirectWithError("Missing authorization code or state");
		}

		// Parse and verify signed state
		let statePayload: StatePayload;
		try {
			const signedState = JSON.parse(Buffer.from(state, "base64url").toString()) as SignedState;

			// Verify HMAC signature
			const secret = process.env.BETTER_AUTH_SECRET;
			if (!secret) {
				throw new Error("BETTER_AUTH_SECRET is required for OAuth state verification");
			}

			const expectedSignature = crypto
				.createHmac("sha256", secret)
				.update(signedState.payload)
				.digest("hex");

			// Use timing-safe comparison to prevent timing attacks
			const isValid = crypto.timingSafeEqual(
				Buffer.from(signedState.signature),
				Buffer.from(expectedSignature),
			);

			if (!isValid) {
				return redirectWithError("Invalid state signature");
			}

			statePayload = JSON.parse(signedState.payload);

			// Verify timestamp is not too old (prevent replay attacks)
			if (Date.now() - statePayload.timestamp > STATE_MAX_AGE_MS) {
				return redirectWithError("Authorization request has expired");
			}
		} catch (e) {
			if (e instanceof Error && e.message.includes("state")) {
				return redirectWithError(e.message);
			}
			return redirectWithError("Invalid state parameter");
		}

		// Build redirect URI (must match the one used to initiate)
		const baseUrl = getDefaultAppBaseUrl();
		const redirectUri = `${baseUrl}/api/calendar/oauth/callback/${provider}`;

		// Validate employee and exchange tokens in parallel (independent operations)
		const calendarProvider = getCalendarProvider(provider);
		const [emp, tokens] = await Promise.all([
			db.query.employee.findFirst({
				where: and(
					eq(employee.id, statePayload.employeeId),
					eq(employee.organizationId, statePayload.organizationId),
				),
			}),
			Effect.runPromise(calendarProvider.exchangeCodeForTokens({ code, state }, redirectUri)),
		]);

		if (!emp) {
			return redirectWithError("Employee not found");
		}

		// Check if connection already exists
		const existingConnection = await db.query.calendarConnection.findFirst({
			where: and(
				eq(calendarConnection.employeeId, statePayload.employeeId),
				eq(calendarConnection.provider, provider),
			),
		});

		if (existingConnection) {
			// Store tokens in Vault
			await storeCalendarTokens(statePayload.organizationId, existingConnection.id, {
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
			});

			// Update existing connection (sentinel values in DB)
			await db
				.update(calendarConnection)
				.set({
					accessToken: "vault:managed",
					refreshToken: tokens.refreshToken ? "vault:managed" : null,
					expiresAt: tokens.expiresAt,
					scope: tokens.scope,
					providerAccountId: tokens.providerAccountId,
					isActive: true,
					lastSyncError: null,
					consecutiveFailures: 0,
					updatedAt: new Date(),
				})
				.where(eq(calendarConnection.id, existingConnection.id));
		} else {
			// Create new connection first to get the ID
			const [newConnection] = await db
				.insert(calendarConnection)
				.values({
					employeeId: statePayload.employeeId,
					organizationId: statePayload.organizationId,
					provider,
					providerAccountId: tokens.providerAccountId,
					accessToken: "vault:managed",
					refreshToken: tokens.refreshToken ? "vault:managed" : null,
					expiresAt: tokens.expiresAt,
					scope: tokens.scope,
					calendarId: "primary", // Default to primary calendar
					isActive: true,
					pushEnabled: true,
					conflictDetectionEnabled: true,
					updatedAt: new Date(),
				})
				.returning({ id: calendarConnection.id });

			// Store tokens in Vault
			await storeCalendarTokens(statePayload.organizationId, newConnection.id, {
				accessToken: tokens.accessToken,
				refreshToken: tokens.refreshToken,
			});
		}

		// Redirect to settings page with success message
		return NextResponse.redirect(`${baseUrl}/settings/calendar?connected=${provider}`);
	} catch (error) {
		console.error("Error completing calendar OAuth:", error);
		return redirectWithError("Failed to connect calendar");
	}
}

// ============================================
// HELPERS
// ============================================

function redirectWithError(message: string): NextResponse {
	const baseUrl = getDefaultAppBaseUrl();
	const encodedMessage = encodeURIComponent(message);
	return NextResponse.redirect(`${baseUrl}/settings/calendar?error=${encodedMessage}`);
}
