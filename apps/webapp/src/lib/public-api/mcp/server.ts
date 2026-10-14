/**
 * The MCP server on the Public API (#795): `/api/mcp` over stateless
 * streamable HTTP (MCP TypeScript SDK v2). It is a thin layer over the
 * Public API, not a second path to the data:
 *
 * - Every HTTP request is admitted by the Public API pipeline first: the API
 *   key, both rate limits and billing. A refusal is plain HTTP problem JSON
 *   (401, 402 or 429), never an OAuth challenge.
 * - Each tool runs its endpoint through `executeEndpoint`, in process: the key
 *   scope, the endpoint's query schema and its organization-scoped read.
 *   `scope_missing`, `validation_failed` and `not_found` come back as tool
 *   results with `isError: true` and the same problem JSON.
 * - Only `tools/call` writes the key request log, with channel `mcp` and the
 *   tool's `/api/v1` route.
 *
 * The SDK builds a fresh server per request from the admitted key, so nothing
 * is kept between requests.
 */
import {
	type AuthInfo,
	type CallToolResult,
	createMcpHandler,
	type McpRequestContext,
	Server,
} from "@modelcontextprotocol/server";
import type { ApiKeyPrincipal } from "../keys/principal";
import {
	admitKeyRequest,
	executeEndpoint,
	type KeyRequestLogEntry,
	type PublicApiDependencies,
	recordKeyRequest,
} from "../pipeline";
import { type Problem, problem } from "../problem";
import { type McpTool, mcpToolsFor, PUBLIC_API_TOOLS } from "./tools";

export const MCP_ROUTE = "/api/mcp";

const SERVER_INFO = { name: "z8", title: "Z8", version: "1.0.0" };

const INSTRUCTIONS = [
	"Read-only access to one organization's Z8 data, limited to the API key's scopes.",
	"Work periods are UTC instants, each with the UTC offset where it was recorded: show them in that offset, never in another timezone.",
	"Absences are local calendar dates. Lists are paged: pass `nextCursor` back as `cursor`.",
	"Employees, projects and customers carry `customFields` keyed by field id, read as of `asOf` (today in the organization's timezone by default); the `list_*_custom_fields` tools name each field, and select values carry their label inline.",
].join(" ");

/** Bodies larger than this are not read to find a refused tool call. */
const MAX_INSPECTED_BODY_BYTES = 1024 * 1024;

type ToolCallRecord = Pick<KeyRequestLogEntry, "method" | "route" | "status" | "rowCount">;

/** What one admitted request hands its per-request server. */
interface AdmittedRequest {
	principal: ApiKeyPrincipal;
	recordToolCall(record: ToolCallRecord): Promise<void>;
}

const ADMITTED = "z8.admittedRequest";

function admittedRequestOf(context: McpRequestContext): AdmittedRequest {
	const admitted = context.authInfo?.extra?.[ADMITTED] as AdmittedRequest | undefined;
	// The route admits every request before the SDK sees it.
	if (!admitted) throw new Error("MCP request reached the server without an admitted API key");
	return admitted;
}

const toolNamed = (name: unknown) => PUBLIC_API_TOOLS.find((tool) => tool.name === name);

type LoggedRoute = Pick<ToolCallRecord, "method" | "route">;

/** A tool call is logged under its tool's `/api/v1` route; an unknown tool under the MCP route. */
const loggedRouteOf = (tool: McpTool | undefined): LoggedRoute =>
	tool
		? { method: tool.endpoint.method, route: tool.endpoint.path }
		: { method: "POST", route: MCP_ROUTE };

function toolError(body: Problem): CallToolResult {
	return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

function buildServer(dependencies: PublicApiDependencies, admitted: AdmittedRequest): Server {
	// The low-level server: the tool list depends on the key, and tool errors
	// carry the Public API's problem JSON rather than the SDK's messages.
	const server = new Server(SERVER_INFO, {
		capabilities: { tools: { listChanged: false } },
		instructions: INSTRUCTIONS,
	});
	server.setRequestHandler("tools/list", () => ({
		tools: mcpToolsFor(admitted.principal.scopes).map((tool) => tool.definition),
	}));
	server.setRequestHandler("tools/call", async (request) => {
		const tool = toolNamed(request.params.name);
		if (!tool) {
			await admitted.recordToolCall({ ...loggedRouteOf(tool), status: 404, rowCount: null });
			return toolError(
				problem("not_found", { detail: `There is no tool named ${request.params.name}.` }),
			);
		}
		// Stays a server error unless the endpoint answers.
		const record: ToolCallRecord = { ...loggedRouteOf(tool), status: 500, rowCount: null };
		try {
			const result = await executeEndpoint(
				dependencies,
				tool.endpoint,
				admitted.principal,
				request.params.arguments ?? {},
			);
			if (!result.ok) {
				record.status = result.problem.status;
				return toolError(result.problem);
			}
			record.status = 200;
			record.rowCount = result.rowCount;
			const body = result.body as Record<string, unknown>;
			return server.projectCallToolResult(
				{ content: [{ type: "text", text: JSON.stringify(body) }], structuredContent: body },
				tool.definition.outputSchema,
			);
		} finally {
			await admitted.recordToolCall(record);
		}
	});
	return server;
}

/** The request body as text; null once it grows past `maxBytes`. */
async function boundedBodyText(request: Request, maxBytes: number): Promise<string | null> {
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxBytes) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/**
 * Where a refused request's tool call is logged; null when the request is no
 * tool call. At most `MAX_INSPECTED_BODY_BYTES` of the body are read.
 */
async function refusedToolCallOf(request: Request): Promise<LoggedRoute | null> {
	if (request.method !== "POST") return null;
	let message: unknown;
	try {
		const text = await boundedBodyText(request, MAX_INSPECTED_BODY_BYTES);
		if (text === null) return null;
		message = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof message !== "object" || message === null || Array.isArray(message)) return null;
	const { method, params } = message as { method?: unknown; params?: { name?: unknown } };
	if (method !== "tools/call") return null;
	return loggedRouteOf(toolNamed(params?.name));
}

function withHeaders(response: Response, extra: Record<string, string>): Response {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(extra)) headers.set(name, value);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export interface McpEndpointOptions {
	/** Protocol-level failures the SDK reports out of band (malformed requests and the like). */
	onProtocolError?(error: Error): void;
}

/** Binds the MCP server to the Public API pipeline's dependencies. */
export function createMcpEndpoint(
	dependencies: PublicApiDependencies,
	options: McpEndpointOptions = {},
): (request: Request) => Promise<Response> {
	// No tool emits notifications, so every answer is a single JSON body.
	const handler = createMcpHandler(
		(context) => buildServer(dependencies, admittedRequestOf(context)),
		{ onerror: options.onProtocolError },
	);

	return async function handleMcpRequest(request) {
		const requestedAt = dependencies.now();
		const admission = await admitKeyRequest(dependencies, request);
		if (admission.outcome === "unidentified") return admission.response;

		const { principal } = admission;
		const recordToolCall = (record: ToolCallRecord) =>
			recordKeyRequest(dependencies, {
				organizationId: principal.organizationId,
				apiKeyId: principal.apiKeyId,
				channel: "mcp",
				...record,
				ipAddress: dependencies.clientIp(request),
				requestedAt,
			});

		if (admission.outcome === "refused") {
			const toolCall = await refusedToolCallOf(request);
			if (toolCall) {
				await recordToolCall({ ...toolCall, status: admission.response.status, rowCount: null });
			}
			return admission.response;
		}

		const authInfo: AuthInfo = {
			token: "",
			clientId: principal.apiKeyId,
			scopes: [...principal.scopes],
			extra: { [ADMITTED]: { principal, recordToolCall } satisfies AdmittedRequest },
		};
		return withHeaders(await handler.fetch(request, { authInfo }), admission.headers);
	};
}
