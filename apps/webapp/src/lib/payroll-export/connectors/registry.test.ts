import { describe, expect, it } from "vitest";
import type { PayrollApiConnector } from "./types";
import { PayrollConnectorRegistry } from "./registry";

function createConnector(id: string): PayrollApiConnector {
	return {
		exporterId: id,
		exporterName: `Connector ${id}`,
		version: "1.0.0",
		validateConfig: async () => ({ valid: true }),
		testConnection: async () => ({ success: true }),
		export: async () => ({
			success: true,
			totalRecords: 0,
			syncedRecords: 0,
			failedRecords: 0,
			skippedRecords: 0,
			errors: [],
			metadata: {
				employeeCount: 0,
				dateRange: { start: "", end: "" },
				apiCallCount: 0,
				durationMs: 0,
			},
		}),
		getSyncThreshold: () => 500,
	};
}

describe("PayrollConnectorRegistry", () => {
	it("registers and gets a connector", () => {
		const registry = new PayrollConnectorRegistry();
		const connector = createConnector("personio");

		registry.register(connector);

		expect(registry.get("personio")).toBe(connector);
	});

	it("lists registered connectors", () => {
		const registry = new PayrollConnectorRegistry();
		const first = createConnector("personio");
		const second = createConnector("successfactors");

		registry.register(first);
		registry.register(second);

		expect(registry.list()).toEqual([first, second]);
	});

	it("checks connector availability", () => {
		const registry = new PayrollConnectorRegistry();
		registry.register(createConnector("personio"));

		expect(registry.has("personio")).toBe(true);
		expect(registry.has("missing")).toBe(false);
	});
});
