import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { classifyDomainHost, resolvePlatformOrganization } from "@/lib/domain";

const handlers = toNextJsHandler(auth);
type AuthMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export async function rejectUnsupportedPlatformHost(request: Request) {
	const hosts = [
		request.headers.get("x-forwarded-host"),
		request.headers.get("host"),
	];
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
		Array.from(platformLabels).map(async (label) =>
			resolvePlatformOrganization(label),
		),
	);

	if (resolvedOrganizations.some((organization) => !organization)) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}

	return null;
}

function withPlatformHostCheck(method: AuthMethod) {
	return async (request: Request) => {
		const response = await rejectUnsupportedPlatformHost(request);
		return response ?? handlers[method](request);
	};
}

export const GET = withPlatformHostCheck("GET");
export const POST = withPlatformHostCheck("POST");
export const PUT = withPlatformHostCheck("PUT");
export const PATCH = withPlatformHostCheck("PATCH");
export const DELETE = withPlatformHostCheck("DELETE");
