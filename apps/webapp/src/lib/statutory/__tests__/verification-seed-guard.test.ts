import { describe, expect, it } from "vitest";
import { judgeVerificationSeedTarget } from "./verification-seed-guard";

describe("verification seed target guard", () => {
	it("lets the seed run on a database that holds no organization but its own", () => {
		expect(judgeVerificationSeedTarget({ foreignOrganizations: 0, allowPopulated: false })).toEqual(
			{
				ok: true,
			},
		);
	});

	it("refuses a database that holds another organization, says why and names the override", () => {
		const verdict = judgeVerificationSeedTarget({ foreignOrganizations: 3, allowPopulated: false });

		expect(verdict.ok).toBe(false);
		expect(!verdict.ok && verdict.reason).toBe(
			"Refusing to touch this database: it holds 3 organizations besides 'stv-org', so it may not be disposable. " +
				"If it is a disposable copy, pass --allow-populated-database.",
		);
	});

	it("names a single other organization in the singular", () => {
		const verdict = judgeVerificationSeedTarget({ foreignOrganizations: 1, allowPopulated: false });

		expect(!verdict.ok && verdict.reason).toContain("it holds 1 organization besides 'stv-org'");
	});

	it("lets the caller override the refusal with --allow-populated-database", () => {
		expect(judgeVerificationSeedTarget({ foreignOrganizations: 3, allowPopulated: true })).toEqual({
			ok: true,
		});
	});
});
