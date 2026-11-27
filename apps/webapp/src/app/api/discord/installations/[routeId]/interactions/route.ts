import type { NextRequest } from "next/server";
import { connection, NextResponse } from "next/server";
import { handleDiscordInstallationInteractionRequest } from "@/lib/chat-installations/discord-installation-routes";

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ routeId: string }> },
) {
	await connection();
	const [{ routeId }, rawBody] = await Promise.all([context.params, request.text()]);
	const signature = request.headers.get("x-signature-ed25519") ?? "";
	const timestamp = request.headers.get("x-signature-timestamp") ?? "";

	const result = await handleDiscordInstallationInteractionRequest({
		routeId,
		rawBody,
		timestamp,
		signature,
	});

	if (result.body === null) {
		return new NextResponse(null, { status: result.status });
	}

	return NextResponse.json(result.body, { status: result.status });
}
