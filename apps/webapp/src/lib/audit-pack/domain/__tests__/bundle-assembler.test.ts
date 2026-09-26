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
					employeeId: "employee-1",
					type: "clock_out",
					occurredAt: "2026-02-01T10:00:00.000Z",
					lineage: {
						previousEntryId: "entry-1",
						replacesEntryId: null,
						supersededById: null,
					},
					hash: { stored: "hash-2", previousHash: "hash-1", status: "reproduced" as const },
					appendLink: { resolution: "stored" as const, predecessorId: "entry-1" },
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
			appendAssurance: [],
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
			appendAssurance: [],
			scope: {},
		});

		const zip = await JSZip.loadAsync(zipBuffer);
		const paths = Object.values(zip.files)
			.filter((file) => !file.dir)
			.map((file) => file.name)
			.sort((a, b) => a.localeCompare(b));

		expect(paths).toEqual([
			"evidence/append-assurance.json",
			"evidence/approvals.json",
			"evidence/audit-timeline.json",
			"evidence/corrections.json",
			"evidence/entries.json",
			"meta/scope.json",
			"views/approvals.csv",
			"views/entries.csv",
		]);
	});

	it("labels resolved append links and hash status next to the stored fields", async () => {
		const zipBuffer = await assembleAuditPackZip({
			entries: [
				{
					id: "entry-2",
					organizationId: "org-1",
					employeeId: "employee-1",
					type: "clock_in",
					occurredAt: "2026-02-01T10:00:00.000Z",
					lineage: { previousEntryId: null, replacesEntryId: null, supersededById: null },
					hash: { stored: "hash-2", previousHash: "hash-1", status: "not_reproduced" },
					appendLink: { resolution: "derived", predecessorId: "entry-1" },
				},
			],
			corrections: [],
			approvals: [],
			timeline: [],
			appendAssurance: [],
			scope: {},
		});

		const zip = await JSZip.loadAsync(zipBuffer);
		const csv = await zip.file("views/entries.csv")?.async("string");

		expect(csv?.split("\n").slice(0, 2)).toEqual([
			'"id","organizationId","employeeId","type","occurredAt","previousEntryId","replacesEntryId","supersededById","hash","previousHash","hashStatus","appendPredecessorId","appendLinkResolution"',
			'"entry-2","org-1","employee-1","clock_in","2026-02-01T10:00:00.000Z","","","","hash-2","hash-1","not_reproduced","entry-1","derived"',
		]);
	});
});
