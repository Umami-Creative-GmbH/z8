import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { assembleAuditPackZip } from "../bundle-assembler";

describe("assembleAuditPackZip", () => {
	it("produces stable output for identical input", async () => {
		const input = {
			entries: [
				{
					id: "entry-2",
					organizationId: "org-1",
					occurredAt: "2026-02-01T10:00:00.000Z",
					lineage: {
						previousEntryId: "entry-1",
						replacesEntryId: null,
						supersededById: null,
					},
				},
			],
			corrections: [
				{
					id: "entry-2",
					previousEntryId: "entry-1",
					replacesEntryId: null,
					supersededById: null,
				},
			],
			approvals: [
				{
					id: "approval-1",
					organizationId: "org-1",
					entryId: "=entry-2",
					approvedAt: "2026-02-01T10:01:00.000Z",
					status: "approved" as const,
					approvedById: "user-1",
				},
			],
			timeline: [
				{ id: "entry-2", source: "entry" as const, occurredAt: "2026-02-01T10:00:00.000Z" },
			],
			scope: {
				organizationId: "org-1",
				dateRange: {
					start: "2026-02-01",
					end: "2026-02-28",
				},
			},
		};

		const zipA = await assembleAuditPackZip(input);
		const zipB = await assembleAuditPackZip(input);

		expect(zipA.equals(zipB)).toBe(true);
	});

	it("contains expected file paths", async () => {
		const zipBuffer = await assembleAuditPackZip({
			entries: [],
			corrections: [],
			approvals: [],
			timeline: [],
			scope: {},
		});

		const zip = await JSZip.loadAsync(zipBuffer);
		const paths = Object.values(zip.files)
			.filter((file) => !file.dir)
			.map((file) => file.name)
			.sort((a, b) => a.localeCompare(b));

		expect(paths).toEqual([
			"evidence/approvals.json",
			"evidence/audit-timeline.json",
			"evidence/corrections.json",
			"evidence/entries.json",
			"meta/scope.json",
			"views/approvals.csv",
			"views/entries.csv",
		]);
	});
});
