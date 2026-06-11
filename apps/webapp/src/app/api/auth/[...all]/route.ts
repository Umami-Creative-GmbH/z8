import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { classifyDomainHost, resolvePlatformOrganization } from "@/lib/domain";

const handlers = toNextJsHandler(auth);

export async function rejectUnsupportedPlatformHost(request: Request) {
	const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")];
	const platformLabels = new Set<string>();

	for (const host of hosts) {
		const classification = classifyDomainHost(host);
		if (classification?.type === "unknownPlatform") {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		if (classification?.type === "platformOrganization") {
			platformLabels.add(classification.label);
		}
	}

	const resolvedOrganizations = await Promise.all(
		Array.from(platformLabels).map(async (label) => resolvePlatformOrganization(label)),
	);

	if (resolvedOrganizations.some((organization) => !organization)) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	return null;
}

export async function GET(request: Request) {
	const response = await rejectUnsupportedPlatformHost(request);
	return response ?? handlers.GET(request);
}

export async function POST(request: Request) {
	const response = await rejectUnsupportedPlatformHost(request);
	return response ?? handlers.POST(request);
}
