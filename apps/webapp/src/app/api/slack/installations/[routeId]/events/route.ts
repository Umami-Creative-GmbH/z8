import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { handleSlackCandidateEventRequest } from "@/lib/chat-installations/slack-candidate-routes";

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ routeId: string }> },
) {
	await connection();
	const [{ routeId }, rawBody] = await Promise.all([context.params, request.text()]);
	const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
	const signature = request.headers.get("x-slack-signature") ?? "";

	const result = await handleSlackCandidateEventRequest({
		routeId,
		rawBody,
		timestamp,
		signature,
	});

	return NextResponse.json(result.body, { status: result.status });
}
