import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	assessHistoricalWork,
	calendarDateEnvelope,
	type HistoricalEntryEvidence,
	type HistoricalOperationEvidence,
	type HistoricalPeriodEvidence,
	type HistoricalRecordEvidence,
	type HistoricalWorkEvidence,
	type HistoricalWorkScope,
	projectHistoricalWorkForViewer,
	summarizeHistoricalWork,
	type WorkFinding,
} from "./historical-work-diagnostics";

const organizationId = "org-1";
const worker = "a0000000-0000-4000-8000-000000000001";
const peer = "a0000000-0000-4000-8000-000000000002";

let sequence = 0;
function nextId(prefix = "b") {
	sequence += 1;
	return `${prefix}0000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

const at = (value: string) => parseInstant(value);

function entry(
	type: "clock_in" | "clock_out",
	timestamp: string,
	overrides: Partial<HistoricalEntryEvidence> = {},
): HistoricalEntryEvidence {
	return {
		id: nextId("e"),
		employeeId: worker,
		type,
		timestamp: at(timestamp),
		utcOffsetMinutes: 0,
		timezone: "UTC",
		timezoneSource: "user_setting",
		isSuperseded: false,
		supersededById: null,
		createdBy: "worker-user",
		...overrides,
	};
}

type WorkFixture = {
	period: HistoricalPeriodEvidence;
	record: HistoricalRecordEvidence;
	entries: HistoricalEntryEvidence[];
};

/** A consistent closed period, its linked canonical record and endpoint entries. */
function work(
	start: string,
	end: string,
	options: {
		employeeId?: string;
		minutes?: number;
		period?: Partial<HistoricalPeriodEvidence>;
		record?: Partial<HistoricalRecordEvidence>;
	} = {},
): WorkFixture {
	const employeeId = options.employeeId ?? worker;
	const clockIn = entry("clock_in", start, { employeeId });
	const clockOut = entry("clock_out", end, { employeeId });
	const minutes = options.minutes ?? Math.round((Date.parse(end) - Date.parse(start)) / 60_000);
	const recordId = nextId("c");
	const period: HistoricalPeriodEvidence = {
		id: nextId("p"),
		employeeId,
		clockInId: clockIn.id,
		clockOutId: clockOut.id,
		startTime: at(start),
		endTime: at(end),
		durationMinutes: minutes,
		isActive: false,
		approvalStatus: "approved",
		hasPendingChanges: false,
		hasApprovalRequest: false,
		approvalWorkflowId: null,
		deletedAt: null,
		projectId: null,
		workCategoryId: null,
		workLocationType: null,
		canonicalRecordId: recordId,
		graphRevision: 0,
		createdAt: at(end),
		...options.period,
	};
	const record: HistoricalRecordEvidence = {
		id: recordId,
		employeeId,
		startAt: at(start),
		endAt: at(end),
		durationMinutes: minutes,
		approvalState: "approved",
		origin: "clock",
		createdAt: at(end),
		detail: { workCategoryId: null, workLocationType: null, computationMetadata: null },
		projectIds: [],
		...options.record,
	};
	return { period, record, entries: [clockIn, clockOut] };
}

function evidence(
	fixtures: readonly WorkFixture[],
	overrides: Partial<HistoricalWorkEvidence> = {},
): HistoricalWorkEvidence {
	return {
		organizationId,
		periods: fixtures.map((fixture) => fixture.period),
		records: fixtures.map((fixture) => fixture.record),
		entries: fixtures.flatMap((fixture) => fixture.entries),
		operations: [],
		adoption: { control: null, admissions: new Map() },
		foreignOwnedWork: [],
		...overrides,
	};
}

const july: HistoricalWorkScope = {
	employeeIds: [worker],
	range: { start: at("2026-07-01T00:00:00Z"), endExclusive: at("2026-08-01T00:00:00Z") },
};

function kinds(findings: readonly WorkFinding[]) {
	return findings.map((finding) => finding.kind).toSorted();
}

function only(findings: readonly WorkFinding[], kind: WorkFinding["kind"]) {
	const matches = findings.filter((finding) => finding.kind === kind);
	expect(matches).toHaveLength(1);
	return matches[0];
}

describe("assessHistoricalWork shape matrix", () => {
	it("reports consistent linked work as complete with no findings", () => {
		const report = assessHistoricalWork(
			evidence([work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z")]),
			july,
		);

		expect(report.findings).toEqual([]);
		expect(report.completeness).toEqual({
			status: "complete",
			widenedTo: "requested",
			affectedEmployeeIds: [],
			blockingFindingIds: [],
		});
	});

	it("classifies a missing canonical base as a missing historical gap", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { canonicalRecordId: null },
		});
		const report = assessHistoricalWork(evidence([fixture], { records: [] }), july);

		const finding = only(report.findings, "canonical_missing");
		expect(finding).toMatchObject({
			shape: "missing",
			treatment: "historical_gap",
			blocking: true,
			relevant: true,
			provenance: { state: "pre_adoption", basis: "organization_not_adopted" },
			workPeriodIds: [fixture.period.id],
		});
		expect(report.completeness.status).toBe("incomplete");
	});

	it("keeps an identity-matched canonical record as the period's representation with a missing link", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z");
		fixture.record.id = fixture.period.id;
		fixture.period.canonicalRecordId = null;

		const report = assessHistoricalWork(evidence([fixture]), july);

		expect(kinds(report.findings)).toEqual(["canonical_link_missing"]);
		expect(report.findings[0]).toMatchObject({
			shape: "missing",
			timeRecordIds: [fixture.period.id],
		});
	});

	it("treats a link to a record outside the loaded scope as unresolved and widens to the employee", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z");
		const report = assessHistoricalWork(evidence([fixture], { records: [] }), {
			...july,
			range: { start: at("2026-09-01T00:00:00Z"), endExclusive: at("2026-10-01T00:00:00Z") },
		});

		const finding = only(report.findings, "canonical_link_unresolved");
		expect(finding).toMatchObject({ shape: "conflicting", relevance: { level: "employee" } });
		expect(report.completeness).toMatchObject({
			status: "incomplete",
			widenedTo: "employees",
			affectedEmployeeIds: [worker],
		});
	});

	it("reports two periods sharing one canonical record as conflicting duplicate lineage", () => {
		const first = work("2026-07-02T08:00:00Z", "2026-07-02T12:00:00Z");
		const second = work("2026-07-02T08:00:00Z", "2026-07-02T12:00:00Z");
		second.period.canonicalRecordId = first.record.id;

		const report = assessHistoricalWork(
			evidence([first, second], { records: [first.record] }),
			july,
		);

		const finding = only(report.findings, "canonical_link_shared");
		expect(finding.shape).toBe("conflicting");
		expect(finding.workPeriodIds).toEqual([first.period.id, second.period.id].toSorted());
	});

	it("reports residue of an earlier relinking as conflicting, not as native work", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z");
		const residue: HistoricalRecordEvidence = { ...fixture.record, id: fixture.period.id };

		const report = assessHistoricalWork(
			evidence([fixture], { records: [fixture.record, residue] }),
			july,
		);

		expect(kinds(report.findings)).toEqual(["relinked_canonical_residue"]);
		expect(report.findings[0]).toMatchObject({
			shape: "conflicting",
			timeRecordIds: [residue.id],
			workPeriodIds: [fixture.period.id],
		});
	});

	it("validates canonical-native work on its own evidence without a fabricated period", () => {
		const native = work("2026-07-03T08:00:00Z", "2026-07-03T10:00:00Z").record;

		const report = assessHistoricalWork(evidence([], { records: [native] }), july);

		expect(report.findings).toEqual([]);
	});

	it("reports a missing canonical work detail", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			record: { detail: null },
		});

		expect(kinds(assessHistoricalWork(evidence([fixture]), july).findings)).toEqual([
			"canonical_detail_missing",
		]);
	});

	it("distinguishes ownership conflicts and keeps both employees", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			record: { employeeId: peer },
		});

		const finding = only(
			assessHistoricalWork(evidence([fixture]), july).findings,
			"ownership_conflict",
		);
		expect(finding.employeeIds).toEqual([worker, peer].toSorted());
		expect(finding.relevant).toBe(true);
	});

	it("widens work owned outside the organization's employees to the organization", () => {
		const report = assessHistoricalWork(
			evidence([], { foreignOwnedWork: [{ kind: "work_period", id: "p-foreign" }] }),
			july,
		);

		const finding = only(report.findings, "work_outside_organization_employees");
		expect(finding).toMatchObject({
			relevance: { level: "organization" },
			employeeIds: [],
			workPeriodIds: ["p-foreign"],
			provenance: { state: "ambiguous", reason: "ownership_unestablished" },
			treatment: "investigation_required",
		});
		expect(report.completeness.widenedTo).toBe("organization");
	});

	it("fills nothing for canonical work opened but never completed and reports the missing completion", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			record: { endAt: null, durationMinutes: null },
		});

		const finding = only(
			assessHistoricalWork(evidence([fixture]), july).findings,
			"endpoint_missing",
		);
		expect(finding).toMatchObject({ shape: "missing", details: { side: "canonical_end" } });
	});

	it("reports a closed period without an end instant as missing", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { endTime: null, durationMinutes: null },
		});
		fixture.record.endAt = null;
		fixture.record.durationMinutes = null;

		const report = assessHistoricalWork(evidence([fixture]), july);
		const finding = only(report.findings, "endpoint_missing");
		expect(finding.details).toMatchObject({ side: "period_end" });
		// An unknown end cannot establish irrelevance: the interval stays open.
		expect(finding.relevance).toEqual({
			level: "interval",
			start: "2026-07-02T08:00:00Z",
			end: null,
		});
	});

	it("reports canonical completion while the period is still open as conflicting", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { endTime: null, durationMinutes: null, isActive: true, clockOutId: null },
		});
		fixture.entries = fixture.entries.slice(0, 1);

		expect(kinds(assessHistoricalWork(evidence([fixture]), july).findings)).toEqual([
			"open_state_conflict",
		]);
	});

	it("does not treat legitimately active work as a gap", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { endTime: null, durationMinutes: null, isActive: true, clockOutId: null },
			record: { endAt: null, durationMinutes: null },
		});
		fixture.entries = fixture.entries.slice(0, 1);

		expect(assessHistoricalWork(evidence([fixture]), july).findings).toEqual([]);
	});

	it("reports more than one active period for an employee", () => {
		const open = {
			endTime: null,
			durationMinutes: null,
			isActive: true,
			clockOutId: null,
		} as const;
		const first = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: open,
			record: { endAt: null, durationMinutes: null },
		});
		const second = work("2026-07-03T08:00:00Z", "2026-07-03T16:00:00Z", {
			period: open,
			record: { endAt: null, durationMinutes: null },
		});
		first.entries = first.entries.slice(0, 1);
		second.entries = second.entries.slice(0, 1);

		const report = assessHistoricalWork(evidence([first, second]), july);
		expect(kinds(report.findings)).toContain("multiple_active_work");
	});

	it("reports contradictory endpoint representations and covers both intervals", () => {
		const fixture = work("2026-07-31T20:00:00Z", "2026-07-31T23:00:00Z", {
			record: { endAt: at("2026-08-01T02:00:00Z"), durationMinutes: 180 },
		});

		const finding = only(
			assessHistoricalWork(evidence([fixture]), july).findings,
			"endpoint_conflict",
		);
		expect(finding.details).toMatchObject({ side: "end", source: "canonical" });
		expect(finding.relevance).toEqual({
			level: "interval",
			start: "2026-07-31T20:00:00Z",
			end: "2026-08-01T02:00:00Z",
		});
	});

	it("reports an endpoint entry that disagrees with the period", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z");
		fixture.entries[0] = { ...fixture.entries[0], timestamp: at("2026-07-02T07:30:00Z") };

		const finding = only(
			assessHistoricalWork(evidence([fixture]), july).findings,
			"endpoint_conflict",
		);
		expect(finding.details).toMatchObject({ side: "start", source: "entry" });
		expect(finding.entryIds).toEqual([fixture.entries[0].id]);
	});

	it("reports a period still pointing to a superseded endpoint entry", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z");
		fixture.entries[1] = { ...fixture.entries[1], isSuperseded: true, supersededById: "e-new" };

		expect(kinds(assessHistoricalWork(evidence([fixture]), july).findings)).toEqual([
			"endpoint_entry_superseded",
		]);
	});

	it("reports an endpoint entry reference that does not resolve in the organization", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z");
		fixture.entries = fixture.entries.slice(1);

		expect(kinds(assessHistoricalWork(evidence([fixture]), july).findings)).toEqual([
			"endpoint_entry_unresolved",
		]);
	});

	it("discloses a missing clock-out entry without blocking", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { clockOutId: null },
		});
		fixture.entries = fixture.entries.slice(0, 1);

		const report = assessHistoricalWork(evidence([fixture]), july);
		expect(only(report.findings, "endpoint_entry_missing")).toMatchObject({
			shape: "missing",
			blocking: false,
		});
		expect(report.completeness.status).toBe("complete");
	});

	it("discloses inferred event-local captures without treating current settings as proof", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z");
		fixture.entries[0] = { ...fixture.entries[0], timezoneSource: "historical_inference" };

		const report = assessHistoricalWork(evidence([fixture]), july);
		expect(only(report.findings, "capture_inferred")).toMatchObject({
			shape: "disclosure",
			treatment: "disclosed",
			blocking: false,
			entryIds: [fixture.entries[0].id],
		});
		expect(report.completeness.status).toBe("complete");
	});

	it("reports a missing stored duration without deriving one", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { durationMinutes: null },
		});

		const finding = only(
			assessHistoricalWork(evidence([fixture]), july).findings,
			"duration_missing",
		);
		expect(finding).toMatchObject({ shape: "missing", details: { source: "period" } });
	});

	it("reports differing stored durations as conflicting and never picks one", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			record: { durationMinutes: 470 },
		});

		const finding = only(
			assessHistoricalWork(evidence([fixture]), july).findings,
			"duration_conflict",
		);
		expect(finding.details).toEqual({ periodMinutes: 480, canonicalMinutes: 470 });
	});

	it("preserves zero minutes over a positive sub-minute interval", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T08:00:20Z", { minutes: 0 });

		expect(assessHistoricalWork(evidence([fixture]), july).findings).toEqual([]);
	});

	it("holds nondeleted equal endpoints, reversed intervals and negative minutes for review", () => {
		const empty = work("2026-07-02T08:00:00Z", "2026-07-02T08:00:00Z", { minutes: 0 });
		const reversed = work("2026-07-03T08:00:00Z", "2026-07-03T07:00:00Z", { minutes: 0 });
		const negative = work("2026-07-04T08:00:00Z", "2026-07-04T09:00:00Z", {
			period: { durationMinutes: -60 },
			record: { durationMinutes: -60 },
		});

		const report = assessHistoricalWork(evidence([empty, reversed, negative]), july);

		expect(kinds(report.findings)).toEqual([
			"empty_interval",
			"negative_duration",
			"reversed_interval",
		]);
		for (const finding of report.findings) {
			expect(finding).toMatchObject({ shape: "conflicting", treatment: "review_required" });
		}
	});

	it("discloses a stored-versus-elapsed difference as established historical minutes", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T09:00:40Z", { minutes: 58 });

		const report = assessHistoricalWork(evidence([fixture]), july);
		expect(only(report.findings, "stored_elapsed_discrepancy")).toMatchObject({
			shape: "disclosure",
			blocking: false,
			details: { storedMinutes: 58, elapsedSeconds: 3640 },
		});
	});

	it("accepts a deletion sentinel and reports a payable representation of deleted work", () => {
		const deleted = { deletedAt: at("2026-07-05T00:00:00Z") };
		const sentinel = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: deleted,
			record: { endAt: at("2026-07-02T08:00:00Z"), durationMinutes: 0 },
		});
		const payable = work("2026-07-03T08:00:00Z", "2026-07-03T16:00:00Z", { period: deleted });

		const report = assessHistoricalWork(evidence([sentinel, payable]), july);

		const finding = only(report.findings, "deleted_work_payable");
		expect(finding.workPeriodIds).toEqual([payable.period.id]);
		expect(kinds(report.findings)).toEqual(["deleted_work_payable"]);
	});

	it("does not ask for a canonical representation of deleted work", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { deletedAt: at("2026-07-05T00:00:00Z"), canonicalRecordId: null },
		});

		expect(assessHistoricalWork(evidence([fixture], { records: [] }), july).findings).toEqual([]);
	});

	it("separates missing, conflicting and canonical-only metadata", () => {
		const category = "d0000000-0000-4000-8000-000000000001";
		const otherCategory = "d0000000-0000-4000-8000-000000000002";
		const project = "d0000000-0000-4000-8000-000000000003";
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { projectId: project, workCategoryId: category, workLocationType: null },
			record: {
				projectIds: [],
				detail: {
					workCategoryId: otherCategory,
					workLocationType: "home",
					computationMetadata: null,
				},
			},
		});

		const findings = assessHistoricalWork(evidence([fixture]), july).findings;

		expect(findings.map((finding) => [finding.kind, finding.details.field])).toEqual([
			["metadata_canonical_only", "work_location_type"],
			["metadata_conflict", "work_category"],
			["metadata_missing", "project"],
		]);
		expect(findings.find((f) => f.kind === "metadata_canonical_only")?.blocking).toBe(false);
	});

	it("accepts a project the canonical allocations already hold", () => {
		const project = "d0000000-0000-4000-8000-000000000003";
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { projectId: project },
			record: { projectIds: ["d0000000-0000-4000-8000-000000000009", project] },
		});

		expect(assessHistoricalWork(evidence([fixture]), july).findings).toEqual([]);
	});

	it("reports approval state conflicts and pending work without any relationship", () => {
		const conflict = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { approvalStatus: "pending", hasPendingChanges: true },
		});
		const orphanPending = work("2026-07-03T08:00:00Z", "2026-07-03T16:00:00Z", {
			period: { approvalStatus: "pending" },
			record: { approvalState: "pending" },
		});
		// Older pending work is linked only through its legacy approval request.
		const requestLinked = work("2026-07-04T08:00:00Z", "2026-07-04T16:00:00Z", {
			period: { approvalStatus: "pending", hasApprovalRequest: true },
			record: { approvalState: "pending" },
		});

		const findings = assessHistoricalWork(
			evidence([conflict, orphanPending, requestLinked]),
			july,
		).findings;

		expect(only(findings, "approval_state_conflict").details).toEqual({
			periodState: "pending",
			canonicalState: "approved",
		});
		expect(only(findings, "approval_relationship_missing").workPeriodIds).toEqual([
			orphanPending.period.id,
		]);
	});

	it("reports overlapping work across periods and native records, excluding adjacency", () => {
		const first = work("2026-07-02T08:00:00Z", "2026-07-02T12:00:00Z");
		const adjacent = work("2026-07-02T12:00:00Z", "2026-07-02T13:00:00Z");
		const overlapping = work("2026-07-02T11:00:00Z", "2026-07-02T11:30:00Z", {
			period: { approvalStatus: "rejected" },
			record: { approvalState: "rejected" },
		});
		const native = work("2026-07-02T12:30:00Z", "2026-07-02T14:00:00Z").record;

		const findings = assessHistoricalWork(
			evidence([first, adjacent, overlapping], {
				records: [first.record, adjacent.record, overlapping.record, native],
			}),
			july,
		).findings.filter((finding) => finding.kind === "overlapping_work");

		expect(findings.map((finding) => [...finding.workPeriodIds, ...finding.timeRecordIds])).toEqual(
			expect.arrayContaining([
				[first.period.id, overlapping.period.id].toSorted(),
				[adjacent.period.id, native.id],
			]),
		);
		expect(findings).toHaveLength(2);
	});
});

describe("assessHistoricalWork adoption provenance", () => {
	const admittedAt = at("2026-07-10T00:00:00Z");
	const adoption = {
		control: { mode: "active" as const, updatedAt: at("2026-07-09T00:00:00Z") },
		admissions: new Map([[worker, admittedAt]]),
	};

	function operation(
		fixture: WorkFixture,
		overrides: Partial<HistoricalOperationEvidence> = {},
	): HistoricalOperationEvidence {
		return {
			id: nextId("o"),
			employeeId: fixture.period.employeeId,
			kind: "create_completed_work",
			writer: "manual_entry",
			writerVersion: 1,
			appendAdmission: "append",
			workPeriodId: fixture.period.id,
			createdAt: fixture.period.createdAt,
			...overrides,
		};
	}

	function provenanceOf(fixture: WorkFixture, operations: HistoricalOperationEvidence[]) {
		fixture.period.durationMinutes = null;
		const report = assessHistoricalWork(evidence([fixture], { operations, adoption }), july);
		return only(report.findings, "duration_missing");
	}

	it("classifies work written before the admission point as pre-adoption history", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z");

		expect(provenanceOf(fixture, [])).toMatchObject({
			provenance: { state: "pre_adoption", basis: "written_before_admission" },
			treatment: "historical_gap",
		});
	});

	it("classifies a receipt written under legacy admission before adoption as pre-adoption", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z");

		expect(
			provenanceOf(fixture, [operation(fixture, { appendAdmission: "legacy" })]).provenance,
		).toEqual({ state: "pre_adoption", basis: "legacy_admission_receipt" });
	});

	it("classifies fresh backdated work as an integrity incident, not history", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { createdAt: at("2026-07-20T00:00:00Z") },
		});
		const receipt = operation(fixture);

		expect(provenanceOf(fixture, [receipt])).toMatchObject({
			provenance: {
				state: "fresh_backdated",
				operationId: receipt.id,
				writer: "manual_entry",
				admittedAt: "2026-07-10T00:00:00Z",
			},
			treatment: "integrity_incident",
		});
	});

	it("classifies an incomplete fresh post-adoption write as an integrity incident", () => {
		const fixture = work("2026-07-20T08:00:00Z", "2026-07-20T16:00:00Z");
		const receipt = operation(fixture, { writer: "web_clock_out", kind: "close_active_work" });

		expect(provenanceOf(fixture, [receipt])).toMatchObject({
			provenance: { state: "post_adoption", operationId: receipt.id, writer: "web_clock_out" },
			treatment: "integrity_incident",
		});
	});

	it("requires investigation for a write after admission without a participating receipt", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { createdAt: at("2026-07-20T00:00:00Z") },
		});

		expect(provenanceOf(fixture, [])).toMatchObject({
			provenance: { state: "ambiguous", reason: "written_after_admission_without_receipt" },
			treatment: "investigation_required",
		});
	});

	it("requires investigation for historical work amended by an adopted writer", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z");
		const amendment = operation(fixture, {
			kind: "amend_completed_work",
			writer: "admin_time_edit",
			createdAt: at("2026-07-21T00:00:00Z"),
		});

		expect(provenanceOf(fixture, [amendment]).provenance).toEqual({
			state: "ambiguous",
			reason: "amended_after_admission",
		});
	});

	it("uses the organization activation when the employee has no admitted position", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			employeeId: peer,
			period: { createdAt: at("2026-07-09T12:00:00Z"), durationMinutes: null },
		});
		const report = assessHistoricalWork(evidence([fixture], { adoption }), {
			...july,
			employeeIds: [peer],
		});

		expect(only(report.findings, "duration_missing").provenance).toEqual({
			state: "ambiguous",
			reason: "written_after_admission_without_receipt",
		});
	});
});

describe("assessHistoricalWork historical manual entries", () => {
	function manual(
		request: Record<string, unknown>,
		result: Record<string, unknown>,
		fixtureOptions: Parameters<typeof work>[2] = {},
		[start, end]: [string, string] = [result.startTime as string, result.endTime as string],
	) {
		const fixture = work(start, end, fixtureOptions);
		fixture.record.origin = "manual";
		fixture.record.detail = {
			workCategoryId: null,
			workLocationType: null,
			computationMetadata: JSON.stringify({
				ordinarySubmission: { submissionId: fixture.period.id, kind: "manual_time_submission" },
				request: {
					date: "2026-07-02",
					clockInTime: "08:00",
					clockOutTime: "16:00",
					reason: "Forgot to clock",
					timezone: "Europe/Berlin",
					browserTimezone: "Europe/Berlin",
					projectId: null,
					workCategoryId: null,
					...request,
				},
				result: { durationMinutes: 480, wasAdjusted: false, ...result },
			}),
		};
		return fixture;
	}

	it("accepts a submission reconstructed exactly in its recorded zone", () => {
		const fixture = manual(
			{},
			{
				startTime: "2026-07-02T06:00:00.000Z",
				endTime: "2026-07-02T14:00:00.000Z",
			},
		);

		expect(assessHistoricalWork(evidence([fixture]), july).findings).toEqual([]);
	});

	it("diagnoses a timezone interpretation mismatch without shifting the stored interval", () => {
		const fixture = manual(
			{},
			{
				startTime: "2026-07-02T08:00:00.000Z",
				endTime: "2026-07-02T16:00:00.000Z",
			},
		);

		const finding = only(
			assessHistoricalWork(evidence([fixture]), july).findings,
			"manual_interpretation_mismatch",
		);
		expect(finding).toMatchObject({
			shape: "suspected_defect",
			treatment: "review_required",
			blocking: false,
			details: {
				zone: "Europe/Berlin",
				zoneBasis: "request",
				submittedStart: "2026-07-02T06:00:00Z",
				submittedEnd: "2026-07-02T14:00:00Z",
				persistedStart: "2026-07-02T08:00:00Z",
				persistedEnd: "2026-07-02T16:00:00Z",
			},
		});
	});

	it("uses the contemporaneous endpoint capture when the request recorded no zone", () => {
		const fixture = manual(
			{ timezone: null },
			{ startTime: "2026-07-02T06:00:00.000Z", endTime: "2026-07-02T14:00:00.000Z" },
		);
		fixture.entries[0] = { ...fixture.entries[0], timezone: "Europe/Berlin" };

		expect(assessHistoricalWork(evidence([fixture]), july).findings).toEqual([]);
	});

	it("does not guess intent when neither the request nor a contemporaneous capture names the zone", () => {
		const fixture = manual(
			{ timezone: null },
			{ startTime: "2026-07-02T06:00:00.000Z", endTime: "2026-07-02T14:00:00.000Z" },
		);
		fixture.entries[0] = {
			...fixture.entries[0],
			timezone: "Europe/Berlin",
			timezoneSource: "historical_inference",
		};

		const findings = assessHistoricalWork(evidence([fixture]), july).findings;
		// Unrecoverable intent asks a reviewer for human evidence; it never blocks.
		expect(only(findings, "manual_zone_unrecorded")).toMatchObject({
			shape: "suspected_defect",
			treatment: "review_required",
			blocking: false,
		});
		expect(kinds(findings)).toEqual(["capture_inferred", "manual_zone_unrecorded"]);
	});

	it("reports a wall time in a daylight-saving gap or fold as ambiguous", () => {
		const fixture = manual(
			{ date: "2026-10-25", clockInTime: "02:30", clockOutTime: "04:00" },
			{
				startTime: "2026-10-25T00:30:00.000Z",
				endTime: "2026-10-25T03:00:00.000Z",
				durationMinutes: 150,
			},
		);

		const finding = only(
			assessHistoricalWork(evidence([fixture]), {
				...july,
				range: { start: at("2026-10-01T00:00:00Z"), endExclusive: at("2026-11-01T00:00:00Z") },
			}).findings,
			"manual_interpretation_ambiguous",
		);
		expect(finding.details).toMatchObject({ endpoint: "clock_in", ambiguity: "repeated" });
	});

	it("diagnoses silent trimming with the submitted and persisted intervals", () => {
		const fixture = manual(
			{},
			{
				startTime: "2026-07-02T06:00:00.000Z",
				endTime: "2026-07-02T11:59:00.000Z",
				durationMinutes: 359,
				wasAdjusted: true,
			},
		);

		const finding = only(
			assessHistoricalWork(evidence([fixture]), july).findings,
			"manual_trimmed",
		);
		expect(finding.details).toMatchObject({
			submittedStart: "2026-07-02T06:00:00Z",
			submittedEnd: "2026-07-02T14:00:00Z",
			persistedStart: "2026-07-02T06:00:00Z",
			persistedEnd: "2026-07-02T11:59:00Z",
		});
	});

	it("diagnoses a holiday check over UTC dates that differ from the dates worked", () => {
		const fixture = manual(
			{ date: "2026-07-03", clockInTime: "00:30", clockOutTime: "08:00" },
			{
				startTime: "2026-07-02T22:30:00.000Z",
				endTime: "2026-07-03T06:00:00.000Z",
				durationMinutes: 450,
			},
		);

		const finding = only(
			assessHistoricalWork(evidence([fixture]), july).findings,
			"manual_holiday_check_dates_differ",
		);
		expect(finding.details).toEqual({
			zone: "Europe/Berlin",
			checkedDates: ["2026-07-02", "2026-07-03"],
			occupiedDates: ["2026-07-03"],
		});
	});

	it("reports unreadable manual submission evidence instead of skipping it", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z");
		fixture.record.origin = "manual";
		fixture.record.detail = {
			workCategoryId: null,
			workLocationType: null,
			computationMetadata: '{"ordinarySubmission":{"kind":"manual_time_submission"}',
		};

		expect(kinds(assessHistoricalWork(evidence([fixture]), july).findings)).toEqual([
			"manual_evidence_unreadable",
		]);
	});
});

describe("assessHistoricalWork scoped completeness", () => {
	it("assesses pending, rejected, draft and open work before any payroll filter", () => {
		const pending = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { approvalStatus: "pending", hasPendingChanges: true, durationMinutes: null },
			record: { approvalState: "pending", durationMinutes: null },
		});
		const draft = work("2026-07-03T08:00:00Z", "2026-07-03T16:00:00Z", {
			period: { canonicalRecordId: null },
		});

		const report = assessHistoricalWork(
			evidence([pending, draft], { records: [pending.record] }),
			july,
		);

		expect(kinds(report.findings)).toEqual([
			"canonical_missing",
			"duration_missing",
			"duration_missing",
		]);
		expect(report.completeness.status).toBe("incomplete");
	});

	it("keeps unaffected scopes complete while another employee's history is uncertain", () => {
		const report = assessHistoricalWork(
			evidence([
				work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z"),
				work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
					employeeId: peer,
					period: { durationMinutes: null },
				}),
			]),
			july,
		);

		expect(report.findings).toEqual([]);
		expect(report.completeness.status).toBe("complete");
	});

	it("ignores out-of-range work with established dates", () => {
		const report = assessHistoricalWork(
			evidence([
				work("2026-06-02T08:00:00Z", "2026-06-02T16:00:00Z", { period: { durationMinutes: null } }),
			]),
			july,
		);

		expect(report.completeness.status).toBe("complete");
	});

	it("keeps work with an unknown end relevant to every later scope", () => {
		const fixture = work("2026-06-02T08:00:00Z", "2026-06-02T16:00:00Z", {
			period: { endTime: null, durationMinutes: null },
			record: { endAt: null, durationMinutes: null },
		});

		expect(assessHistoricalWork(evidence([fixture]), july).completeness.status).toBe("incomplete");
	});

	it("keeps disclosures from making a scope incomplete", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z");
		fixture.entries[0] = { ...fixture.entries[0], timezoneSource: "backfill" };

		const report = assessHistoricalWork(evidence([fixture]), july);

		expect(report.findings).toHaveLength(1);
		expect(report.completeness.status).toBe("complete");
	});

	it("builds a calendar-date envelope covering every zone's local days", () => {
		expect(calendarDateEnvelope("2026-07-01", "2026-07-31")).toEqual({
			start: at("2026-06-30T10:00:00Z"),
			endExclusive: at("2026-08-01T14:00:00Z"),
		});
	});
});

describe("diagnostic read authorization", () => {
	function reportWithPeerConflict() {
		const own = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { durationMinutes: null },
		});
		const shared = work("2026-07-03T08:00:00Z", "2026-07-03T16:00:00Z", {
			record: { employeeId: peer },
		});
		return assessHistoricalWork(
			evidence([own, shared], {
				foreignOwnedWork: [{ kind: "time_record", id: "c-foreign" }],
			}),
			july,
		);
	}

	it("gives an operator record-level findings and redacts findings about other employees", () => {
		const projected = projectHistoricalWorkForViewer(reportWithPeerConflict(), {
			organizationWide: false,
			canDiagnose: (employeeId) => employeeId === worker,
		});

		expect(projected.diagnostics).toBe("record_level");
		if (projected.diagnostics !== "record_level") throw new Error("unreachable");
		const serialized = JSON.stringify(projected.report);
		expect(serialized).not.toContain(peer);
		expect(serialized).not.toContain("c-foreign");
		expect(projected.report.findings.map((finding) => finding.kind).toSorted()).toEqual([
			"duration_missing",
			"ownership_conflict",
			"work_outside_organization_employees",
		]);
		expect(
			projected.report.findings.filter((finding) => "redacted" in finding && finding.redacted),
		).toHaveLength(2);
		expect(projected.report.completeness.status).toBe("incomplete");
		expect(projected.report.completeness.affectedEmployeeIds).toEqual([worker]);
		expect(projected.report.completeness.redactedEmployeeCount).toBe(1);
	});

	it("gives an organization-wide operator every record", () => {
		const report = reportWithPeerConflict();
		const projected = projectHistoricalWorkForViewer(report, {
			organizationWide: true,
			canDiagnose: () => true,
		});

		expect(projected).toEqual({ diagnostics: "record_level", report });
	});

	it("gives an ordinary reader only status and counts", () => {
		const projected = projectHistoricalWorkForViewer(reportWithPeerConflict(), {
			organizationWide: false,
			canDiagnose: () => false,
		});

		expect(projected).toEqual({
			diagnostics: "summary",
			summary: summarizeHistoricalWork(reportWithPeerConflict()),
		});
		const serialized = JSON.stringify(projected);
		expect(serialized).not.toMatch(/[0-9a-f]{8}-0000-4000/);
		expect(projected.diagnostics === "summary" && projected.summary).toMatchObject({
			status: "incomplete",
			widenedTo: "organization",
			findingCount: 3,
			blockingFindingCount: 3,
		});
	});
});
