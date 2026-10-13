import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createInMemoryZipWriter, writePersonalDataArchive } from "./archive";
import { recordPart, tablePart } from "./collector";

const scope = {
	organizationId: "org-1",
	employeeId: "6b0c1f1e-0000-4000-8000-000000000001",
	userId: "user-1",
	kind: "employee" as const,
};

async function readZip(bytes: Uint8Array) {
	const zip = await JSZip.loadAsync(bytes);
	const files: Record<string, string> = {};
	for (const entry of Object.values(zip.files)) {
		if (!entry.dir) files[entry.name] = await entry.async("string");
	}
	return files;
}

describe("writePersonalDataArchive", () => {
	it("writes one JSON file per category, a CSV per table part, the manifest and the README", async () => {
		const bytes = await writePersonalDataArchive(createInMemoryZipWriter(), {
			exportId: "export-1",
			scope,
			exportedAt: "2026-10-13T08:00:00Z",
			locale: "de",
			readme: "Ihre Daten\n",
			categories: [
				{
					category: "employment",
					parts: [
						recordPart("employee", { first_name: "Ada", birthday: "1990-02-28" }),
						tablePart(
							"employment_terms",
							["valid_from", "hourly_rate", "change_reason"],
							[
								{ valid_from: "2026-01-01T00:00:00Z", hourly_rate: "21.50", change_reason: null },
								{
									valid_from: "2026-07-01T00:00:00Z",
									hourly_rate: "23.00",
									change_reason: 'Raise, "annual"',
								},
							],
						),
					],
				},
			],
		});

		const files = await readZip(bytes);
		expect(Object.keys(files).sort()).toEqual([
			"README.txt",
			"_manifest.json",
			"employment.json",
			"employment/employment_terms.csv",
		]);

		expect(JSON.parse(files["employment.json"] as string)).toEqual({
			_metadata: {
				category: "employment",
				kind: "employee",
				organizationId: "org-1",
				employeeId: scope.employeeId,
				exportedAt: "2026-10-13T08:00:00Z",
			},
			employee: { first_name: "Ada", birthday: "1990-02-28" },
			employment_terms: [
				{ valid_from: "2026-01-01T00:00:00Z", hourly_rate: "21.50", change_reason: null },
				{
					valid_from: "2026-07-01T00:00:00Z",
					hourly_rate: "23.00",
					change_reason: 'Raise, "annual"',
				},
			],
		});

		expect(files["employment/employment_terms.csv"]).toBe(
			[
				"valid_from,hourly_rate,change_reason",
				"2026-01-01T00:00:00Z,21.50,",
				'2026-07-01T00:00:00Z,23.00,"Raise, ""annual"""',
			].join("\n"),
		);
		expect(files["README.txt"]).toBe("Ihre Daten\n");

		const manifest = JSON.parse(files["_manifest.json"] as string);
		expect(manifest).toMatchObject({
			exportId: "export-1",
			kind: "employee",
			organizationId: "org-1",
			employeeId: scope.employeeId,
			exportedAt: "2026-10-13T08:00:00Z",
			locale: "de",
			categories: ["employment"],
		});
		expect(manifest.files).toEqual([
			{ path: "README.txt", category: null, format: "text", records: null, sizeBytes: 11 },
			{
				path: "employment.json",
				category: "employment",
				format: "json",
				records: 3,
				sizeBytes: expect.any(Number),
			},
			{
				path: "employment/employment_terms.csv",
				category: "employment",
				format: "csv",
				records: 2,
				sizeBytes: expect.any(Number),
			},
		]);
	});

	it("writes a header-only CSV for an empty table and copies original files", async () => {
		const bytes = await writePersonalDataArchive(createInMemoryZipWriter(), {
			exportId: "export-2",
			scope,
			exportedAt: "2026-10-13T08:00:00Z",
			locale: "en",
			readme: "Your data\n",
			categories: [
				{
					category: "employment",
					parts: [tablePart("skills", ["skill", "expires_on"], [])],
					files: [
						{ path: "certificates/forklift.pdf", read: async () => new Uint8Array([37, 80]) },
					],
				},
			],
		});

		const files = await readZip(bytes);
		expect(files["employment/skills.csv"]).toBe("skill,expires_on");
		expect(files["employment/certificates/forklift.pdf"]).toBe("%P");
		expect(JSON.parse(files["employment.json"] as string).skills).toEqual([]);
	});
});
