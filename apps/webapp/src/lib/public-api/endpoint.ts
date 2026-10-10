import type { z } from "zod";
import type { db } from "@/db";
import type { ApiKeyPrincipal } from "./keys/principal";
import type { Problem } from "./problem";
import type { ApiKeyScope } from "./scopes";

type Database = typeof db;
/** What an endpoint may use to read: selects only, never writes. */
export type PublicApiReader = Pick<Database, "select">;

export interface EndpointContext<Query> {
	principal: ApiKeyPrincipal;
	query: Query;
	/** Reads of the key's organization only: every query filters by `principal.organizationId`. */
	database: PublicApiReader;
}

export type EndpointResult<Body> =
	| { ok: true; body: Body; rowCount: number }
	| { ok: false; problem: Problem };

/**
 * One Public API v1 operation. Its Zod schemas validate the request, type the
 * response and generate the OpenAPI document, so the spec cannot drift from
 * what the route accepts. Within `/api/v1`, changes only add fields or endpoints.
 */
export interface PublicApiEndpoint<
	Query extends z.ZodObject = z.ZodObject,
	Response extends z.ZodType = z.ZodType,
> {
	method: "GET";
	path: `/api/v1/${string}`;
	operationId: string;
	tag: string;
	summary: string;
	description: string;
	scope: ApiKeyScope;
	query: Query;
	response: Response;
	run(context: EndpointContext<z.output<Query>>): Promise<EndpointResult<z.input<Response>>>;
}

export const defineEndpoint = <Query extends z.ZodObject, Response extends z.ZodType>(
	endpoint: PublicApiEndpoint<Query, Response>,
) => endpoint;
