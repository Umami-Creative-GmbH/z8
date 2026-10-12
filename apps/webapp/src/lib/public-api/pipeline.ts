/**
 * The Public API v1 request pipeline (#763). Every `/api/v1` route runs it:
 *
 * 1. Authentication: only `Authorization: Bearer <api key>`. Browser sessions
 *    and session Bearer tokens are never accepted here. Once the key is
 *    identified, the request counts against the organization's ceiling, and
 *    Better Auth's verification checks the key and its own rate limit.
 * 2. Billing: an organization without billing access gets 402.
 * 3. Rate limits: every response for an identified key carries the
 *    `X-RateLimit-*` headers of the tighter limit (key or organization); a 429
 *    also carries `Retry-After`.
 * 4. Scope: the endpoint's key scope, else 403.
 * 5. The endpoint reads the key's organization only.
 * 6. Every request of an identified key goes to the key request log.
 * 7. Errors are `application/problem+json`.
 *
 * The pipeline takes its collaborators as dependencies, so suites run it
 * against PostgreSQL with real key verification.
 *
 * The MCP server (#795) runs the same steps: `admitKeyRequest` for every HTTP
 * request, `executeEndpoint` for each tool call and `recordKeyRequest` for
 * the key request log.
 */
import type { z } from "zod";
import type { KeyRequestChannel } from "@/db/schema/public-api";
import type { EndpointResult, PublicApiEndpoint, PublicApiReader } from "./endpoint";
import type { ApiKeyPrincipal } from "./keys/principal";
import { type Problem, problem, problemResponse } from "./problem";

/** One rate limit's state, as the `X-RateLimit-*` headers report it. */
export interface RateLimitState {
	limit: number;
	remaining: number;
	/** Unix epoch milliseconds when the window resets. */
	resetAt: number;
}

export type KeyVerification =
	| { ok: true; limit: RateLimitState | null }
	| { ok: false; reason: "invalid_key" }
	| { ok: false; reason: "rate_limited"; retryAfterSeconds: number; limit: RateLimitState | null };

/** The stored key a presented key belongs to, with its own limit before this request. */
export interface IdentifiedKey {
	principal: ApiKeyPrincipal;
	limit: RateLimitState | null;
}

export interface OrganizationLimitCheck extends RateLimitState {
	allowed: boolean;
	retryAfterSeconds: number;
}

export interface KeyRequestLogEntry {
	organizationId: string;
	apiKeyId: string;
	channel: KeyRequestChannel;
	method: string;
	route: string;
	status: number;
	rowCount: number | null;
	ipAddress: string | null;
	requestedAt: Date;
}

export interface PublicApiDependencies {
	database: PublicApiReader;
	/** The stored key a presented key belongs to, without counting a request. */
	identifyKey(key: string): Promise<IdentifiedKey | null>;
	/** Better Auth's verification: enabled, unexpired, within the key's own limit. */
	verifyKey(key: string, identified: IdentifiedKey): Promise<KeyVerification>;
	hasBillingAccess(organizationId: string): Promise<boolean>;
	checkOrganizationLimit(organizationId: string): Promise<OrganizationLimitCheck>;
	recordRequest(entry: KeyRequestLogEntry): Promise<void>;
	clientIp(request: Request): string | null;
	now(): Date;
	onError?(error: unknown, context: { route: string; organizationId: string }): void;
}

const BEARER = /^Bearer[ ]+(\S+)[ ]*$/i;

/** The presented API key; null when the request carries no Bearer credential. */
export function presentedApiKey(request: Request): string | null {
	const header = request.headers.get("authorization");
	return header ? (BEARER.exec(header)?.[1] ?? null) : null;
}

/** The tighter of two limits: the one with fewer requests left. */
function bindingLimit(limits: (RateLimitState | null)[]): RateLimitState | null {
	return limits.reduce<RateLimitState | null>((binding, next) => {
		if (!next) return binding;
		if (!binding) return next;
		if (next.remaining !== binding.remaining) {
			return next.remaining < binding.remaining ? next : binding;
		}
		return next.limit < binding.limit ? next : binding;
	}, null);
}

function rateLimitHeaders(limit: RateLimitState | null): Record<string, string> {
	if (!limit) return {};
	return {
		"X-RateLimit-Limit": String(limit.limit),
		"X-RateLimit-Remaining": String(Math.max(0, limit.remaining)),
		"X-RateLimit-Reset": String(Math.ceil(limit.resetAt / 1000)),
	};
}

function queryOf(request: Request): Record<string, string | string[]> {
	const query: Record<string, string | string[]> = {};
	for (const [name, value] of new URL(request.url).searchParams) {
		const current = query[name];
		query[name] = current === undefined ? value : [...[current].flat(), value];
	}
	return query;
}

function validationProblem(error: z.ZodError): Problem {
	return problem("validation_failed", {
		detail: "One or more query parameters are invalid.",
		errors: error.issues.map((issue) => ({
			parameter: issue.path.map(String).join(".") || "query",
			message: issue.message,
		})),
	});
}

/**
 * How the pipeline answers a request's API key. Every request of an
 * identified key counts against the organization's ceiling, so a refusal of
 * an identified key carries its principal (for the key request log) and its
 * response carries the `X-RateLimit-*` headers of the tighter limit.
 */
export type KeyAdmission =
	| { outcome: "unidentified"; response: globalThis.Response }
	| { outcome: "refused"; principal: ApiKeyPrincipal; response: globalThis.Response }
	| { outcome: "admitted"; principal: ApiKeyPrincipal; headers: Record<string, string> };

/**
 * Admits one request by its API key: identifies the key, counts the request
 * against the organization's ceiling and the key's own limit, verifies the key
 * and checks the organization's billing access.
 */
export async function admitKeyRequest(
	dependencies: PublicApiDependencies,
	request: Request,
): Promise<KeyAdmission> {
	const key = presentedApiKey(request);
	if (!key) {
		return {
			outcome: "unidentified",
			response: problemResponse(
				problem("invalid_key", { detail: "Send an API key as `Authorization: Bearer <key>`." }),
			),
		};
	}
	const identified = await dependencies.identifyKey(key);
	if (!identified) {
		return {
			outcome: "unidentified",
			response: problemResponse(problem("invalid_key", { detail: "The API key is not valid." })),
		};
	}

	const { principal } = identified;
	const refuse = (response: globalThis.Response): KeyAdmission => ({
		outcome: "refused",
		principal,
		response,
	});
	const organizationLimit = await dependencies.checkOrganizationLimit(principal.organizationId);
	if (!organizationLimit.allowed) {
		return refuse(
			problemResponse(
				problem("rate_limited", { detail: "The organization's request limit is used up." }),
				{
					...rateLimitHeaders(bindingLimit([organizationLimit, identified.limit])),
					"Retry-After": String(organizationLimit.retryAfterSeconds),
				},
			),
		);
	}

	const verification = await dependencies.verifyKey(key, identified);
	if (!verification.ok && verification.reason === "invalid_key") {
		return refuse(
			problemResponse(
				problem("invalid_key", { detail: "The API key is revoked, disabled or expired." }),
				rateLimitHeaders(bindingLimit([organizationLimit, identified.limit])),
			),
		);
	}
	if (!verification.ok) {
		return refuse(
			problemResponse(problem("rate_limited", { detail: "This key's request limit is used up." }), {
				...rateLimitHeaders(bindingLimit([verification.limit, organizationLimit])),
				"Retry-After": String(verification.retryAfterSeconds),
			}),
		);
	}

	const headers = rateLimitHeaders(bindingLimit([verification.limit, organizationLimit]));
	if (!(await dependencies.hasBillingAccess(principal.organizationId))) {
		return refuse(
			problemResponse(
				problem("billing_required", {
					detail: "The organization's subscription does not allow API access.",
				}),
				headers,
			),
		);
	}
	return { outcome: "admitted", principal, headers };
}

/**
 * Runs an endpoint for an admitted key: the key scope, then the endpoint's
 * query schema, then the endpoint itself. `input` is the query as its channel
 * delivers it: URL parameters on `/api/v1`, tool arguments over MCP. A thrown
 * error is reported and becomes `server_error`.
 */
export async function executeEndpoint<Query extends z.ZodObject, Response extends z.ZodType>(
	dependencies: PublicApiDependencies,
	endpoint: PublicApiEndpoint<Query, Response>,
	principal: ApiKeyPrincipal,
	input: unknown,
): Promise<EndpointResult<z.input<Response>>> {
	if (!principal.scopes.includes(endpoint.scope)) {
		return {
			ok: false,
			problem: problem("scope_missing", {
				detail: `This endpoint requires the key scope ${endpoint.scope}.`,
				requiredScope: endpoint.scope,
			}),
		};
	}
	const query = endpoint.query.safeParse(input);
	if (!query.success) return { ok: false, problem: validationProblem(query.error) };
	try {
		return await endpoint.run({ principal, query: query.data, database: dependencies.database });
	} catch (error) {
		dependencies.onError?.(error, {
			route: endpoint.path,
			organizationId: principal.organizationId,
		});
		return { ok: false, problem: problem("server_error") };
	}
}

/** Writes one key request log record. A failed write is reported, never thrown. */
export async function recordKeyRequest(
	dependencies: PublicApiDependencies,
	entry: KeyRequestLogEntry,
): Promise<void> {
	await dependencies.recordRequest(entry).catch((error) =>
		dependencies.onError?.(error, {
			route: entry.route,
			organizationId: entry.organizationId,
		}),
	);
}

/** Runs one Public API request through the pipeline and returns its response. */
export async function handlePublicApiRequest<Query extends z.ZodObject, Response extends z.ZodType>(
	dependencies: PublicApiDependencies,
	endpoint: PublicApiEndpoint<Query, Response>,
	request: Request,
): Promise<globalThis.Response> {
	const requestedAt = dependencies.now();
	const admission = await admitKeyRequest(dependencies, request);
	if (admission.outcome === "unidentified") return admission.response;

	let status = 500;
	let rowCount: number | null = null;
	try {
		const response = await respondToAdmission(
			dependencies,
			endpoint,
			admission,
			request,
			(rows) => {
				rowCount = rows;
			},
		);
		status = response.status;
		return response;
	} finally {
		await recordKeyRequest(dependencies, {
			organizationId: admission.principal.organizationId,
			apiKeyId: admission.principal.apiKeyId,
			channel: "api",
			method: endpoint.method,
			route: endpoint.path,
			status,
			rowCount,
			ipAddress: dependencies.clientIp(request),
			requestedAt,
		});
	}
}

async function respondToAdmission<Query extends z.ZodObject, Response extends z.ZodType>(
	dependencies: PublicApiDependencies,
	endpoint: PublicApiEndpoint<Query, Response>,
	admission: Exclude<KeyAdmission, { outcome: "unidentified" }>,
	request: Request,
	recordRows: (rows: number) => void,
): Promise<globalThis.Response> {
	if (admission.outcome === "refused") return admission.response;
	const result = await executeEndpoint(
		dependencies,
		endpoint,
		admission.principal,
		queryOf(request),
	);
	if (!result.ok) return problemResponse(result.problem, admission.headers);

	recordRows(result.rowCount);
	return new globalThis.Response(JSON.stringify(result.body), {
		status: 200,
		headers: {
			...admission.headers,
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
		},
	});
}
