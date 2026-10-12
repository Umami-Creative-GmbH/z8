/**
 * Public API errors (#763): `application/problem+json` bodies (RFC 9457) with
 * stable `type` codes. Within `/api/v1` codes are only ever added.
 */
export const PROBLEM_TYPES = {
	invalid_key: { status: 401, title: "Invalid API key" },
	scope_missing: { status: 403, title: "Key scope missing" },
	billing_required: { status: 402, title: "Billing required" },
	rate_limited: { status: 429, title: "Rate limit exceeded" },
	validation_failed: { status: 400, title: "Validation failed" },
	not_found: { status: 404, title: "Not found" },
	server_error: { status: 500, title: "Internal server error" },
} as const;

export type ProblemType = keyof typeof PROBLEM_TYPES;

export interface Problem {
	type: ProblemType;
	title: string;
	status: number;
	detail?: string;
	/** For `validation_failed`: each invalid query parameter. */
	errors?: { parameter: string; message: string }[];
	/** For `scope_missing`: the key scope the endpoint requires. */
	requiredScope?: string;
}

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export function problem(
	type: ProblemType,
	extra: Omit<Partial<Problem>, "type" | "title" | "status"> = {},
): Problem {
	const { status, title } = PROBLEM_TYPES[type];
	return { type, title, status, ...extra };
}

export function problemResponse(body: Problem, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status: body.status,
		headers: { ...headers, "Content-Type": PROBLEM_CONTENT_TYPE },
	});
}
