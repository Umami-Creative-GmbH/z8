import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { classifyDomainHost, resolvePlatformOrganization } from "@/lib/domain";

const handlers = toNextJsHandler(auth);

export async function rejectUnsupportedPlatformHost(request: Request) {
	const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")];
	const resolvedLabels = new Map<string, boolean>();

	for (const host of hosts) {
		const classification = classifyDomainHost(host);
		if (classification?.type === "unknownPlatform") {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}

		if (classification?.type !== "platformOrganization") {
			continue;
		}

		let organizationExists = resolvedLabels.get(classification.label);
		if (organizationExists === undefined) {
			organizationExists = Boolean(await resolvePlatformOrganization(classification.label));
			resolvedLabels.set(classification.label, organizationExists);
		}

		if (!organizationExists) {
			return NextResponse.json({ error: "Not found" }, { status: 404 });
		}
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
