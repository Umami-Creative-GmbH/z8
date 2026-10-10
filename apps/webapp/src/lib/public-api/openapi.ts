import { z } from "zod";
import type { PublicApiEndpoint } from "./endpoint";
import { PROBLEM_CONTENT_TYPE, PROBLEM_TYPES } from "./problem";
import { API_KEY_SCOPES } from "./scopes";

/**
 * Generates the Public API v1 OpenAPI document from the Zod schemas the routes
 * validate with (#763). The document is committed as `apps/webapp/openapi/public-api-v1.json`; a drift
 * test fails when it differs from what this produces.
 */

type JsonSchema = Record<string, unknown>;

const problemSchema = z
	.object({
		type: z.enum(Object.keys(PROBLEM_TYPES) as [keyof typeof PROBLEM_TYPES]),
		title: z.string(),
		status: z.int(),
		detail: z.string().optional(),
		errors: z
			.array(z.object({ parameter: z.string(), message: z.string() }))
			.optional()
			.describe("For `validation_failed`: each invalid query parameter."),
		requiredScope: z
			.enum(API_KEY_SCOPES)
			.optional()
			.describe("For `scope_missing`: the key scope the endpoint requires."),
	})
	.meta({ title: "Problem" });

function jsonSchema(schema: z.ZodType, io: "input" | "output"): JsonSchema {
	const { $schema: _, ...rest } = z.toJSONSchema(schema, {
		io,
		unrepresentable: "any",
	}) as JsonSchema;
	return rest;
}

const rateLimitHeaders = {
	"X-RateLimit-Limit": {
		description:
			"Requests allowed in the current window of the tighter limit (key or organization).",
		schema: { type: "integer" },
	},
	"X-RateLimit-Remaining": {
		description: "Requests left in that window.",
		schema: { type: "integer" },
	},
	"X-RateLimit-Reset": {
		description: "When that window resets, as Unix epoch seconds.",
		schema: { type: "integer" },
	},
};

const problemResponse = (description: string, extraHeaders: Record<string, unknown> = {}) => ({
	description,
	headers: { ...rateLimitHeaders, ...extraHeaders },
	content: { [PROBLEM_CONTENT_TYPE]: { schema: { $ref: "#/components/schemas/Problem" } } },
});

function parametersOf(endpoint: PublicApiEndpoint) {
	return Object.entries(endpoint.query.shape).map(([name, field]) => {
		const schema = jsonSchema(field as z.ZodType, "input");
		const { description, ...rest } = schema;
		return {
			name,
			in: "query",
			required: !(field as z.ZodType).safeParse(undefined).success,
			...(typeof description === "string" ? { description } : {}),
			schema: rest,
		};
	});
}

function operationOf(endpoint: PublicApiEndpoint) {
	return {
		operationId: endpoint.operationId,
		tags: [endpoint.tag],
		summary: endpoint.summary,
		description: `${endpoint.description}\n\nRequires the key scope \`${endpoint.scope}\`.`,
		security: [{ apiKey: [] }],
		parameters: parametersOf(endpoint),
		responses: {
			"200": {
				description: "OK",
				headers: rateLimitHeaders,
				content: { "application/json": { schema: jsonSchema(endpoint.response, "output") } },
			},
			"400": problemResponse("`validation_failed`: a query parameter is invalid."),
			"401": problemResponse("`invalid_key`: the API key is missing, unknown, revoked or expired."),
			"402": problemResponse("`billing_required`: the organization has no billing access."),
			"403": problemResponse("`scope_missing`: the key lacks the endpoint's key scope."),
			"429": problemResponse(
				"`rate_limited`: the key's or the organization's request limit is used up.",
				{
					"Retry-After": {
						description: "Seconds until a request may be retried.",
						schema: { type: "integer" },
					},
				},
			),
		},
		"x-z8-scope": endpoint.scope,
	};
}

export function buildOpenApiDocument(endpoints: readonly PublicApiEndpoint[]) {
	const paths: Record<string, Record<string, unknown>> = {};
	for (const endpoint of endpoints) {
		paths[endpoint.path] = {
			...paths[endpoint.path],
			[endpoint.method.toLowerCase()]: operationOf(endpoint),
		};
	}
	return {
		openapi: "3.1.0",
		info: {
			title: "Z8 Public API",
			version: "1.0.0",
			description: [
				"Read your organization's data from your own systems with an organization API key.",
				"",
				"Send the key as `Authorization: Bearer <key>`. A key acts as its organization, limited to its key scopes.",
				"Errors are `application/problem+json` (RFC 9457). Within `/api/v1`, changes only add fields or endpoints.",
			].join("\n"),
		},
		servers: [{ url: "https://ui.z8-time.app", description: "Z8" }],
		security: [{ apiKey: [] }],
		tags: [...new Set(endpoints.map((endpoint) => endpoint.tag))].map((name) => ({ name })),
		paths,
		components: {
			securitySchemes: {
				apiKey: {
					type: "http",
					scheme: "bearer",
					description: "An organization API key (starts with `z8_org`).",
				},
			},
			schemas: { Problem: jsonSchema(problemSchema, "output") },
		},
	};
}

export function serializeOpenApiDocument(document: ReturnType<typeof buildOpenApiDocument>) {
	return `${JSON.stringify(document, null, "\t")}\n`;
}
