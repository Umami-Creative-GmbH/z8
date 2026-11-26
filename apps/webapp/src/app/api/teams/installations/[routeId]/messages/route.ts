import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import {
	handleTeamsCandidateHealthRequest,
	handleTeamsCandidateMessageRequest,
} from "@/lib/chat-installations/teams-candidate-routes";

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ routeId: string }> },
) {
	await connection();
	const { routeId } = await context.params;
	const rawBody = await request.text();
	const authorizationHeader = request.headers.get("authorization") ?? "";
	const contentType = request.headers.get("content-type") ?? "application/json";

	const result = await handleTeamsCandidateMessageRequest({
		routeId,
		rawBody,
		authorizationHeader,
		contentType,
	});

	if (result.body === null) {
		return new NextResponse(null, { status: result.status });
	}
	return NextResponse.json(result.body, { status: result.status });
}

export async function GET(
	_request: NextRequest,
	context: { params: Promise<{ routeId: string }> },
) {
	await connection();
	const { routeId } = await context.params;
	const result = await handleTeamsCandidateHealthRequest(routeId);
	return NextResponse.json(result.body ?? { status: "ok" }, { status: result.status });
}
