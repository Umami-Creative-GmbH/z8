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

export function onRequestError(
	_error: unknown,
	_request: RequestErrorRequest,
): void {
	// This failure hook has no authoritative product-analytics consent. A vendor
	// identity cookie is not consent, and resolving auth/DB here can fail recursively.
	// Never send raw errors, request context or protected parameters to third parties.
	// First-party operational tracing remains owned by instrumentation.node.ts.
}
