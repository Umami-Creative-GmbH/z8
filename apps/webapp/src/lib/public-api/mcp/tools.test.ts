/**
 * The MCP server's tools (#795) are derived from the Public API endpoints:
 * one read-only tool per endpoint, with the endpoint's key scope and its Zod
 * schemas as the tool's input and output schemas.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PUBLIC_API_ENDPOINTS } from "../endpoints";
import { listAbsences } from "../resources/absences";
import { listEmployees } from "../resources/employees";
import { listWorkPeriods } from "../resources/work-periods";
import { mcpToolOf, mcpToolsFor, PUBLIC_API_TOOLS } from "./tools";

describe("Public API MCP tools", () => {
	it("offers one tool per endpoint, named after its operation, with its key scope", () => {
		expect(PUBLIC_API_TOOLS.map((tool) => [tool.name, tool.scope])).toEqual([
			["list_work_periods", "time-entries:read"],
			["list_absences", "absences:read"],
			["list_employees", "employees:read"],
			["list_projects", "projects:read"],
			["list_customers", "customers:read"],
		]);
		expect(PUBLIC_API_TOOLS.map((tool) => tool.endpoint)).toEqual(PUBLIC_API_ENDPOINTS);
	});

	it("lists only the tools a key's scopes allow", () => {
		expect(mcpToolsFor(["employees:read"]).map((tool) => tool.name)).toEqual(["list_employees"]);
		expect(mcpToolsFor(["absences:read-health"])).toEqual([]);
		expect(mcpToolsFor(["customers:read", "time-entries:read"]).map((tool) => tool.name)).toEqual([
			"list_work_periods",
			"list_customers",
		]);
	});

	it("describes a tool by the endpoint's arguments and page as JSON Schema", () => {
		const { definition } = mcpToolOf(listEmployees);
		expect(definition.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
		expect(definition.inputSchema).toMatchObject({
			type: "object",
			properties: {
				limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
				cursor: { type: "string" },
				status: { enum: ["active", "departed"] },
			},
		});
		expect(definition.inputSchema).not.toHaveProperty("$schema");
		expect(definition.outputSchema).toMatchObject({
			type: "object",
			properties: { data: { type: "array" }, nextCursor: {} },
			required: ["data", "nextCursor"],
		});
	});

	it("requires the range arguments where the endpoint does", () => {
		expect(mcpToolOf(listWorkPeriods).definition.inputSchema.required).toEqual(["from", "to"]);
		expect(mcpToolOf(listAbsences).definition.inputSchema.required).toEqual(["from", "to"]);
		expect(mcpToolOf(listEmployees).definition.inputSchema.required ?? []).toEqual([]);
	});

	it("states the data rules an agent needs in the tool descriptions", () => {
		const workPeriods = mcpToolOf(listWorkPeriods).definition.description;
		expect(workPeriods).toMatch(/UTC instant/);
		expect(workPeriods).toMatch(/never convert/i);
		expect(workPeriods).toMatch(/no end/);
		expect(workPeriods).toMatch(/366 days/);
		expect(workPeriods).toMatch(/time-entries:read/);

		const absences = mcpToolOf(listAbsences).definition.description;
		expect(absences).toMatch(/local calendar dates/);
		expect(absences).toMatch(/half day/);
		expect(absences).toMatch(/`absent`/);
		expect(absences).toMatch(/366 days/);

		expect(mcpToolOf(listEmployees).definition.description).toMatch(/nextCursor/);
		expect(mcpToolOf(listEmployees).definition.description).not.toMatch(/366 days/);
	});

	it("changes when the route's query or response schema changes", () => {
		const changedQuery = mcpToolOf({
			...listEmployees,
			query: listEmployees.query.extend({ teamId: z.uuid().optional() }),
		});
		expect(changedQuery.definition.inputSchema.properties).toHaveProperty("teamId");
		expect(mcpToolOf(listEmployees).definition.inputSchema.properties).not.toHaveProperty("teamId");

		const changedResponse = mcpToolOf({
			...listEmployees,
			response: z.object({ changed: z.boolean() }),
		});
		expect(changedResponse.definition.outputSchema).toMatchObject({
			properties: { changed: { type: "boolean" } },
		});
	});
});
