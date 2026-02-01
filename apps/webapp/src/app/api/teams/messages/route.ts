/**
 * Teams Bot Messages Webhook
 *
 * POST /api/teams/messages
 *
 * This is the endpoint that Microsoft Teams calls when users interact
 * with the Z8 bot. It handles all incoming activities from Teams.
 *
 * Note: This endpoint is called by Microsoft, not by users directly.
 * It does not use standard Z8 authentication.
 */

import { connection, NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getBotAdapter, handleBotActivity, isBotConfigured } from "@/lib/teams";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TeamsWebhook");

export async function POST(request: NextRequest) {
	// Opt out of caching
	await connection();

	// Check if bot is configured
	if (!isBotConfigured()) {
		logger.warn("Teams webhook called but bot is not configured");
		return NextResponse.json(
			{ error: "Bot not configured" },
			{ status: 503 },
		);
	}

	try {
		const adapter = getBotAdapter();

		// Get request body and headers
		const body = await request.text();
		const authHeader = request.headers.get("Authorization") || "";

		// Create a mock request/response for Bot Framework
		// The adapter expects Node.js http objects, so we create adapters
		const mockReq = {
			body: JSON.parse(body),
			headers: {
				authorization: authHeader,
				"content-type": request.headers.get("Content-Type") || "application/json",
			},
			method: "POST",
		};

		let responseStatus = 200;
		let responseBody = "";

		const mockRes = {
			status: (code: number) => {
				responseStatus = code;
				return mockRes;
			},
			send: (data: unknown) => {
				responseBody = typeof data === "string" ? data : JSON.stringify(data);
			},
			end: () => {},
			setHeader: () => {},
		};

		// Process the activity through the Bot Framework adapter
		await adapter.process(mockReq as any, mockRes as any, async (context) => {
			await handleBotActivity(context);
		});

		// Return the response
		if (responseBody) {
			return new NextResponse(responseBody, {
				status: responseStatus,
				headers: { "Content-Type": "application/json" },
			});
		}

		return new NextResponse(null, { status: responseStatus });
	} catch (error) {
		logger.error({ error }, "Teams webhook error");

		return NextResponse.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}

// Also handle GET for webhook verification (some setups require this)
export async function GET() {
	await connection();

	if (!isBotConfigured()) {
		return NextResponse.json(
			{ status: "not_configured" },
			{ status: 503 },
		);
	}

	return NextResponse.json({
		status: "ok",
		service: "Z8 Teams Bot",
	});
}
