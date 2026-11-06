import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
	PersonalDataArchiveFileError,
	streamPersonalDataArchive,
} from "./archive";
import { recordPart, tablePart } from "./collector";

async function bytesOf(
	stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

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

describe("streamPersonalDataArchive", () => {
	it("writes one JSON file per category, a CSV per table part, the manifest and the README", async () => {
		const bytes = await bytesOf(
			streamPersonalDataArchive({
				exportId: "export-1",
				scope,
				exportedAt: "2026-10-13T08:00:00Z",
				locale: "de",
				readme: "Ihre Daten\n",
				categories: [
					{
						category: "employment",
						parts: [
							recordPart("employee", {
								first_name: "Ada",
								birthday: "1990-02-28",
							}),
							tablePart(
								"employment_terms",
								["valid_from", "hourly_rate", "change_reason"],
								[
									{
										valid_from: "2026-01-01T00:00:00Z",
										hourly_rate: "21.50",
										change_reason: null,
									},
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
			}),
		);

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
				{
					valid_from: "2026-01-01T00:00:00Z",
					hourly_rate: "21.50",
					change_reason: null,
				},
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
			{
				path: "README.txt",
				category: null,
				format: "text",
				records: null,
				sizeBytes: 11,
			},
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

	it("omits empty CSVs, preserves empty JSON parts and copies original files", async () => {
		const bytes = await bytesOf(
			streamPersonalDataArchive({
				exportId: "export-2",
				scope,
				exportedAt: "2026-10-13T08:00:00Z",
				locale: "en",
				readme: "Your data\n",
				categories: [
					{
						category: "employment",
						parts: [
							recordPart("employee", { first_name: "Ada" }),
							recordPart("optional", null),
							tablePart("skills", ["skill", "expires_on"], []),
						],
						files: [
							{
								path: "certificates/forklift.pdf",
								read: async () => new Uint8Array([37, 80]),
							},
						],
					},
				],
			}),
		);

		const files = await readZip(bytes);
		expect(files).not.toHaveProperty("employment/skills.csv");
		expect(files["employment/certificates/forklift.pdf"]).toBe("%P");
		expect(JSON.parse(files["employment.json"] as string).skills).toEqual([]);
		expect(JSON.parse(files["employment.json"] as string).optional).toBeNull();
		expect(JSON.parse(files["_manifest.json"] as string).files).toContainEqual({
			path: "employment/certificates/forklift.pdf",
			category: "employment",
			format: "file",
			records: null,
			sizeBytes: 2,
		});
	});

	it.each(["employee", "admin"] as const)(
		"omits empty and placeholder-only categories in an %s export",
		async (kind) => {
			const files = await readZip(
				await bytesOf(
					streamPersonalDataArchive({
						exportId: "export-empty",
						scope: { ...scope, kind },
						exportedAt: "2026-10-13T08:00:00Z",
						locale: "en",
						readme: "Your data\n",
						categories: [
							{
								category: "planning",
								parts: [tablePart("shifts", ["id"], [])],
							},
							{
								category: "account",
								parts: [recordPart("settings", null), recordPart("empty", {})],
							},
							{
								category: "integrations",
								parts: [
									recordPart(
										"kiosk_pin",
										{ pin_set: false, set_at: null, set_by: null },
										{ isPlaceholder: true },
									),
								],
							},
							{ category: "equipment", parts: [], files: [] },
						],
					}),
				),
			);
			expect(Object.keys(files).sort()).toEqual([
				"README.txt",
				"_manifest.json",
			]);
			const manifest = JSON.parse(files["_manifest.json"] as string);
			expect(manifest.categories).toEqual([]);
			expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(
				["README.txt"],
			);
		},
	);

	it("keeps stored zero, false and null values and retains placeholders inside populated JSON", async () => {
		const files = await readZip(
			await bytesOf(
				streamPersonalDataArchive({
					exportId: "export-values",
					scope,
					exportedAt: "2026-10-13T08:00:00Z",
					locale: "en",
					readme: "Your data\n",
					categories: [
						{
							category: "account",
							parts: [
								recordPart("settings", {
									enabled: false,
									count: 0,
									note: null,
								}),
							],
						},
						{
							category: "integrations",
							parts: [
								recordPart(
									"kiosk_pin",
									{ pin_set: false, set_at: null, set_by: null },
									{ isPlaceholder: true },
								),
								tablePart(
									"chat_accounts",
									["is_active"],
									[{ is_active: false }],
								),
							],
						},
					],
				}),
			),
		);
		expect(JSON.parse(files["account.json"] as string).settings).toEqual({
			enabled: false,
			count: 0,
			note: null,
		});
		expect(JSON.parse(files["integrations.json"] as string).kiosk_pin).toEqual({
			pin_set: false,
			set_at: null,
			set_by: null,
		});
		expect(files["integrations/chat_accounts.csv"]).toBe("is_active\nfalse");
		const manifest = JSON.parse(files["_manifest.json"] as string);
		expect(manifest.categories).toEqual(["account", "integrations"]);
		expect(
			manifest.files
				.filter((file: { format: string }) => file.format === "json")
				.map((file: { records: number }) => file.records),
		).toEqual([1, 1]);
	});

	it("keeps originals without emitting a metadata-only JSON file", async () => {
		const files = await readZip(
			await bytesOf(
				streamPersonalDataArchive({
					exportId: "export-original",
					scope,
					exportedAt: "2026-10-13T08:00:00Z",
					locale: "en",
					readme: "Your data\n",
					categories: [
						{
							category: "personnel_file",
							parts: [],
							files: [
								{
									path: "contract.pdf",
									read: async () => new Uint8Array([37, 80]),
								},
							],
						},
					],
				}),
			),
		);
		expect(Object.keys(files).sort()).toEqual([
			"README.txt",
			"_manifest.json",
			"personnel_file/contract.pdf",
		]);
		const manifest = JSON.parse(files["_manifest.json"] as string);
		expect(manifest.categories).toEqual(["personnel_file"]);
		expect(manifest.files.map((file: { path: string }) => file.path)).toEqual([
			"README.txt",
			"personnel_file/contract.pdf",
		]);
	});

	it("reads each original file only when the archive consumer reaches it", async () => {
		const reads: number[] = [];
		const stream = streamPersonalDataArchive({
			exportId: "export-3",
			scope,
			exportedAt: "2026-10-13T08:00:00Z",
			locale: "en",
			readme: "Your data\n",
			categories: [
				{
					category: "personnel_file",
					parts: [],
					files: Array.from({ length: 20 }, (_, index) => ({
						path: `contract/${index}.pdf`,
						read: async () => {
							reads.push(index);
							return new Uint8Array(1024).fill(index);
						},
					})),
				},
			],
		});
		const reader = stream.getReader();
		// README header + body, then the first original file's header + body.
		for (let chunk = 0; chunk < 4; chunk += 1) await reader.read();
		expect(reads).toEqual([0]);
		await reader.cancel();
	});

	it("fails the stream with a file error when an original file cannot be read", async () => {
		const stream = streamPersonalDataArchive({
			exportId: "export-4",
			scope,
			exportedAt: "2026-10-13T08:00:00Z",
			locale: "en",
			readme: "Your data\n",
			categories: [
				{
					category: "travel_expenses",
					parts: [],
					files: [
						{
							path: "receipts/taxi.pdf",
							read: async () => {
								throw new Error("checksum mismatch");
							},
						},
					],
				},
			],
		});
		await expect(bytesOf(stream)).rejects.toBeInstanceOf(
			PersonalDataArchiveFileError,
		);
	});
});
