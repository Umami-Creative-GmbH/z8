import { describe, expect, it } from "vitest";
import { createLifecycleDatabaseFixture } from "./database.test.fixture";

// No env stubs: this file runs in the real `unit` Vitest project.
describe("lifecycle database fixture in the unit project", () => {
	it("refuses to open the database fixture", async () => {
		await expect(createLifecycleDatabaseFixture()).rejects.toThrow(
			"database suites must be named `*.integration.test.ts`",
		);
	});
});
