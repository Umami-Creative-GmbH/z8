/**
 * Drift test for the committed Public API OpenAPI document (#763). When a
 * route schema changes, regenerate it with `pnpm public-api:openapi`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PUBLIC_API_ENDPOINTS } from "./endpoints";
import { buildOpenApiDocument, serializeOpenApiDocument } from "./openapi";

describe("Public API OpenAPI document", () => {
	it("matches what the route schemas generate", async () => {
		const generated = serializeOpenApiDocument(buildOpenApiDocument(PUBLIC_API_ENDPOINTS));
		// `pnpm public-api:openapi` (vitest -u) rewrites the committed file.
		await expect(
			generated,
			"openapi/public-api-v1.json is out of date: run `pnpm public-api:openapi` in apps/webapp",
		).toMatchFileSnapshot("../../../openapi/public-api-v1.json");
	});

	it("documents every endpoint with its key scope and the problem responses", () => {
		const document = buildOpenApiDocument(PUBLIC_API_ENDPOINTS);
		for (const endpoint of PUBLIC_API_ENDPOINTS) {
			const operation = document.paths[endpoint.path]?.get as {
				"x-z8-scope": string;
				responses: Record<string, unknown>;
			};
			expect(operation["x-z8-scope"]).toBe(endpoint.scope);
			expect(Object.keys(operation.responses)).toEqual(["200", "400", "401", "402", "403", "429"]);
		}
	});

	it("has a generated docs reference page for every endpoint", () => {
		// `pnpm generate:api-reference` in apps/docs writes one page per operation.
		const reference = join(import.meta.dirname, "../../../../docs/content/docs/api-reference");
		const meta = JSON.parse(readFileSync(join(reference, "meta.json"), "utf8")) as {
			pages: string[];
		};
		for (const endpoint of PUBLIC_API_ENDPOINTS) {
			expect(existsSync(join(reference, `${endpoint.operationId}.mdx`)), endpoint.operationId).toBe(
				true,
			);
			expect(meta.pages).toContain(endpoint.operationId);
		}
	});

	it("changes when a route's query or response schema changes", () => {
		const [first, ...rest] = PUBLIC_API_ENDPOINTS;
		const before = serializeOpenApiDocument(buildOpenApiDocument(PUBLIC_API_ENDPOINTS));
		const withQuery = buildOpenApiDocument([
			{ ...first, query: first.query.extend({ extra: z.string().optional() }) },
			...rest,
		]);
		const withResponse = buildOpenApiDocument([
			{ ...first, response: z.object({ changed: z.boolean() }) },
			...rest,
		]);
		expect(serializeOpenApiDocument(withQuery)).not.toBe(before);
		expect(serializeOpenApiDocument(withResponse)).not.toBe(before);
	});
});
