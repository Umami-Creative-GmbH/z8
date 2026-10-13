import { describe, expect, it } from "vitest";
import { fallbackReadmeTranslator, renderPersonalDataExportReadme } from "./readme";

const base = {
	t: fallbackReadmeTranslator,
	organizationName: "Acme GmbH",
	employeeName: "Ada Lovelace",
	exportedAt: "2026-10-13T08:00:00Z",
	categories: ["employment"] as const,
};

describe("renderPersonalDataExportReadme", () => {
	it("names the organization, the employee and the files of an employee export", () => {
		const readme = renderPersonalDataExportReadme({ ...base, kind: "employee" });

		expect(readme).toContain("Your personal data from Acme GmbH");
		expect(readme).toContain(
			"the personal data Acme GmbH keeps about Ada Lovelace, as read on 2026-10-13T08:00:00Z (UTC)",
		);
		expect(readme).toContain("You requested this export yourself.");
		expect(readme).toContain("employment.json");
		expect(readme).toContain("The folder employment/ holds the same tables as CSV files.");
		expect(readme).toContain("_manifest.json");
		expect(readme).not.toContain("time.json");
	});

	it("says an administrator created an admin export", () => {
		const readme = renderPersonalDataExportReadme({ ...base, kind: "admin" });

		expect(readme).toContain("An administrator of Acme GmbH created this export on your behalf.");
		expect(readme).not.toContain("You requested this export yourself.");
	});
});
