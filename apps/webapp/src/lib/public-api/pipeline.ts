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
 */
import type { z } from "zod";
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

async function runEndpoint<Query extends z.ZodObject, Response extends z.ZodType>(
	dependencies: PublicApiDependencies,
	endpoint: PublicApiEndpoint<Query, Response>,
	principal: ApiKeyPrincipal,
	request: Request,
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
	const query = endpoint.query.safeParse(queryOf(request));
	if (!query.success) return { ok: false, problem: validationProblem(query.error) };
	return endpoint.run({ principal, query: query.data, database: dependencies.database });
}

/** Runs one Public API request through the pipeline and returns its response. */
export async function handlePublicApiRequest<Query extends z.ZodObject, Response extends z.ZodType>(
	dependencies: PublicApiDependencies,
	endpoint: PublicApiEndpoint<Query, Response>,
	request: Request,
): Promise<globalThis.Response> {
	const requestedAt = dependencies.now();
	const key = presentedApiKey(request);
	if (!key) {
		return problemResponse(
			problem("invalid_key", { detail: "Send an API key as `Authorization: Bearer <key>`." }),
		);
	}
	const identified = await dependencies.identifyKey(key);
	if (!identified) {
		return problemResponse(problem("invalid_key", { detail: "The API key is not valid." }));
	}
	let status = 500;
	let rowCount: number | null = null;
	try {
		const response = await respondToKey(
			dependencies,
			endpoint,
			request,
			key,
			identified,
			(rows) => {
				rowCount = rows;
			},
		);
		status = response.status;
		return response;
	} finally {
		const { principal } = identified;
		await dependencies
			.recordRequest({
				organizationId: principal.organizationId,
				apiKeyId: principal.apiKeyId,
				method: endpoint.method,
				route: endpoint.path,
				status,
				rowCount,
				ipAddress: dependencies.clientIp(request),
				requestedAt,
			})
			.catch((error) =>
				dependencies.onError?.(error, {
					route: endpoint.path,
					organizationId: principal.organizationId,
				}),
			);
	}
}

/**
 * The response to a request whose key was identified. Every such request
 * counts against the organization's ceiling, so each response, refusals
 * included, carries the `X-RateLimit-*` headers of the tighter limit.
 */
async function respondToKey<Query extends z.ZodObject, Response extends z.ZodType>(
	dependencies: PublicApiDependencies,
	endpoint: PublicApiEndpoint<Query, Response>,
	request: Request,
	key: string,
	identified: IdentifiedKey,
	recordRows: (rows: number) => void,
): Promise<globalThis.Response> {
	const { principal } = identified;
	const organizationLimit = await dependencies.checkOrganizationLimit(principal.organizationId);
	if (!organizationLimit.allowed) {
		return problemResponse(
			problem("rate_limited", { detail: "The organization's request limit is used up." }),
			{
				...rateLimitHeaders(bindingLimit([organizationLimit, identified.limit])),
				"Retry-After": String(organizationLimit.retryAfterSeconds),
			},
		);
	}

	const verification = await dependencies.verifyKey(key, identified);
	if (!verification.ok && verification.reason === "invalid_key") {
		return problemResponse(
			problem("invalid_key", { detail: "The API key is revoked, disabled or expired." }),
			rateLimitHeaders(bindingLimit([organizationLimit, identified.limit])),
		);
	}
	if (!verification.ok) {
		return problemResponse(
			problem("rate_limited", { detail: "This key's request limit is used up." }),
			{
				...rateLimitHeaders(bindingLimit([verification.limit, organizationLimit])),
				"Retry-After": String(verification.retryAfterSeconds),
			},
		);
	}

	const headers = rateLimitHeaders(bindingLimit([verification.limit, organizationLimit]));
	if (!(await dependencies.hasBillingAccess(principal.organizationId))) {
		return problemResponse(
			problem("billing_required", {
				detail: "The organization's subscription does not allow API access.",
			}),
			headers,
		);
	}

	let result: EndpointResult<z.input<Response>>;
	try {
		result = await runEndpoint(dependencies, endpoint, principal, request);
	} catch (error) {
		dependencies.onError?.(error, {
			route: endpoint.path,
			organizationId: principal.organizationId,
		});
		return problemResponse(problem("server_error"), headers);
	}
	if (!result.ok) return problemResponse(result.problem, headers);

	recordRows(result.rowCount);
	return new globalThis.Response(JSON.stringify(result.body), {
		status: 200,
		headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}
