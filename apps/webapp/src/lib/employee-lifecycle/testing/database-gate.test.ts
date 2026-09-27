import { describe, expect, it } from "vitest";
import { createLifecycleDatabaseFixture, describeLifecycleDatabase } from "./database.test.fixture";

// No env stubs: this file runs in the real `unit` Vitest project.
describe("lifecycle database gate in the unit project", () => {
	it("throws instead of skipping a misnamed database suite", () => {
		expect(() => describeLifecycleDatabase("misnamed suite", () => {})).toThrow(
			"database suites must be named `*.integration.test.ts`",
		);
	});

	it("refuses to open the database fixture", async () => {
		await expect(createLifecycleDatabaseFixture()).rejects.toThrow(
			"database suites must be named `*.integration.test.ts`",
		);
	});
});
