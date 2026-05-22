import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { classifyDomainHost, resolvePlatformOrganization } from "@/lib/domain";

const handlers = toNextJsHandler(auth);

async function rejectUnsupportedPlatformHost(request: Request) {
	const classification = classifyDomainHost(request.headers.get("host"));
	if (classification?.type === "unknownPlatform") {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	if (classification?.type !== "platformOrganization") {
		return null;
	}

	const platformOrganization = await resolvePlatformOrganization(classification.label);
	if (platformOrganization) {
		return null;
	}

	return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(request: Request) {
	const response = await rejectUnsupportedPlatformHost(request);
	return response ?? handlers.GET(request);
}

export async function POST(request: Request) {
	const response = await rejectUnsupportedPlatformHost(request);
	return response ?? handlers.POST(request);
}
