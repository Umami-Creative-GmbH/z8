import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const timeTrackingDir = dirname(fileURLToPath(import.meta.url));

// #443: every export of a "use server" module can become a public endpoint, so
// writers that take employee or organization IDs from the caller stay out of them.
describe("time-tracking server action surface", () => {
	it("exposes no unauthenticated post-clock-out writer from the actions module", async () => {
		const actions = await import("./actions");

		for (const name of [
			"checkComplianceAfterClockOut",
			"calculateAndPersistSurcharges",
			"enforceBreaksAfterClockOut",
			"resolveTimeApprovalManagerId",
		]) {
			expect(actions).not.toHaveProperty(name);
		}
	});

	it.each(["actions/compliance.ts", "actions/approvals.ts"])(
		"keeps %s a server-only helper module",
		(file) => {
			const source = readFileSync(join(timeTrackingDir, file), "utf8");

			expect(source).toContain('import "server-only";');
			expect(source).not.toContain('"use server"');
		},
	);
});
