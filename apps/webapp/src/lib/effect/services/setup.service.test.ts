import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./setup.service.ts", import.meta.url), "utf8");

describe("SetupService credential account creation", () => {
	it("writes the Better Auth credential issuer with the local account id", () => {
		const accountInsert = source.match(
			/await tx\.insert\(account\)\.values\(\{[\s\S]*?providerId:\s*"credential",[\s\S]*?\}\);/,
		)?.[0];

		expect(accountInsert).toContain('issuer: "local:credential"');
		expect(accountInsert).toContain("accountId: userId");
		expect(accountInsert).toContain('providerId: "credential"');
	});
});
