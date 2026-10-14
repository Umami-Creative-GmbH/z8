/**
 * The MCP server's tools (#795): one read-only tool per Public API endpoint.
 * A tool's name, key scope and input and output schemas come from the
 * endpoint itself, so changing a route schema changes the tool with it.
 */
import type { Tool } from "@modelcontextprotocol/server";
import type { PublicApiEndpoint } from "../endpoint";
import { PUBLIC_API_ENDPOINTS } from "../endpoints";
import { jsonSchema } from "../openapi";
import { MAX_RANGE_DAYS } from "../resources/date-range";
import type { ApiKeyScope } from "../scopes";

/** A tool as `tools/list` returns it. */
export type McpToolDefinition = Tool & {
	title: string;
	description: string;
	outputSchema: NonNullable<Tool["outputSchema"]>;
};

export interface McpTool {
	name: string;
	scope: ApiKeyScope;
	endpoint: PublicApiEndpoint;
	definition: McpToolDefinition;
}

/** `listWorkPeriods` → `list_work_periods`. */
const toolNameOf = (operationId: string) =>
	operationId.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** The custom field rules of one record kind's list tool and definitions tool (#822). */
function customFieldRules(list: string, definitions: string): Record<string, string[]> {
	return {
		[list]: [
			`\`customFields\` is keyed by field id: call \`${toolNameOf(definitions)}\` for each field's name and type. A select value carries its option's label inline.`,
			"Custom field values are read as of `asOf`, today in the organization's timezone unless you pass one; a tracked field can hold another value on another date.",
		],
		[definitions]: [
			`Use the field ids to read \`customFields\` in \`${toolNameOf(list)}\`. Fields only managers or admins see are listed only with the key scope \`custom-fields:read-restricted\`.`,
		],
	};
}

/**
 * Data rules the endpoint description leaves to the client, which an agent
 * would otherwise get wrong.
 */
const AGENT_RULES: Record<string, string[]> = {
	listWorkPeriods: [
		"Show each time in the UTC offset recorded with it; never convert it to another timezone.",
	],
	...customFieldRules("listEmployees", "listEmployeeCustomFields"),
	...customFieldRules("listProjects", "listProjectCustomFields"),
	...customFieldRules("listCustomers", "listCustomerCustomFields"),
};

function descriptionOf(endpoint: PublicApiEndpoint): string {
	const hasRange = "from" in endpoint.query.shape && "to" in endpoint.query.shape;
	return [
		endpoint.description,
		...(AGENT_RULES[endpoint.operationId] ?? []),
		...(hasRange
			? [`\`from\` and \`to\` are required and may be at most ${MAX_RANGE_DAYS} days apart.`]
			: []),
		"Returns one page. While `nextCursor` is not null, call again with it as `cursor` for the next page.",
		`Requires the key scope \`${endpoint.scope}\`.`,
	].join("\n\n");
}

export function mcpToolOf(endpoint: PublicApiEndpoint): McpTool {
	const name = toolNameOf(endpoint.operationId);
	return {
		name,
		scope: endpoint.scope,
		endpoint,
		definition: {
			name,
			title: endpoint.summary,
			description: descriptionOf(endpoint),
			// The endpoint schemas are Zod objects, so both JSON Schemas have an object root.
			inputSchema: jsonSchema(endpoint.query, "input") as McpToolDefinition["inputSchema"],
			outputSchema: jsonSchema(endpoint.response, "output") as McpToolDefinition["outputSchema"],
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
	};
}

export const PUBLIC_API_TOOLS: readonly McpTool[] = PUBLIC_API_ENDPOINTS.map(mcpToolOf);

/** The tools a key with these scopes may see and call. */
export const mcpToolsFor = (scopes: readonly ApiKeyScope[]): McpTool[] =>
	PUBLIC_API_TOOLS.filter((tool) => scopes.includes(tool.scope));
