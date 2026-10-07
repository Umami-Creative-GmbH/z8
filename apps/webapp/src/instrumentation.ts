import { SETUP_REQUEST_PATH } from "@/lib/setup/telemetry";

type RequestErrorRequest = {
	headers?: Headers | { cookie?: string | string[] };
	path?: string;
};

export async function register() {
	// Turbopack also compiles this file for the Edge runtime. Keep every Node-only
	// import behind this dynamic import so the Edge bundle never traces it.
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const { registerNodeRuntime } = await import("./instrumentation.node");
		await registerNodeRuntime();
	}
}

export const onRequestError = async (
	err: unknown,
	request: RequestErrorRequest,
) => {
	if (
		process.env.NEXT_RUNTIME !== "nodejs" ||
		(request.path && SETUP_REQUEST_PATH.test(request.path))
	) {
		return;
	}

	const { getPostHogDistinctIdFromCookie, getPostHogServer } = await import(
		"@/lib/posthog-server"
	);
	const posthog = getPostHogServer();

	if (!posthog) {
		return;
	}

	const cookieHeader =
		request.headers instanceof Headers
			? request.headers.get("cookie")
			: request.headers?.cookie;
	const distinctId = getPostHogDistinctIdFromCookie(cookieHeader ?? undefined);
	const error = err instanceof Error ? err : new Error(String(err));

	await posthog.captureException(error, distinctId ?? undefined);
};
