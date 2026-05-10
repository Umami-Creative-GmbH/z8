import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ACTIONS_PATH = fileURLToPath(new URL("./actions.ts", import.meta.url));

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("platform diagnostics refresh action", () => {
	it("requires platform-admin authorization before collecting diagnostics", () => {
		const source = stripComments(readFileSync(ACTIONS_PATH, "utf8"));
		const authCheck = "adminService.requirePlatformAdmin()";
		const collectorCall = "collectPlatformDiagnostics()";

		expect(source).toContain('"use server"');
		expect(source).toContain("PlatformAdminService");
		expect(source).toContain(authCheck);
		expect(source).toContain(collectorCall);
		expect(source.indexOf(authCheck)).toBeLessThan(source.indexOf(collectorCall));
		expect(source).toContain("runServerActionSafe");
	});
});
