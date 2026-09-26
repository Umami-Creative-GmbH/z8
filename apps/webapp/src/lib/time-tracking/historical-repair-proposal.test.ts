import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { proposeHistoricalRepair, type RequestedRepairChange } from "./historical-repair-proposal";
import type {
	HistoricalEntryEvidence,
	HistoricalOperationEvidence,
	HistoricalPeriodEvidence,
	HistoricalRecordEvidence,
	HistoricalWorkEvidence,
} from "./historical-work-diagnostics";

const organizationId = "org-1";
const worker = "a0000000-0000-4000-8000-000000000001";
const project = "f0000000-0000-4000-8000-000000000001";
const category = "f0000000-0000-4000-8000-000000000002";
const foreignProject = "f0000000-0000-4000-8000-000000000009";

let sequence = 0;
function nextId(prefix: string) {
	sequence += 1;
	return `${prefix}0000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

const at = (value: string) => parseInstant(value);

function entry(type: "clock_in" | "clock_out", timestamp: string): HistoricalEntryEvidence {
	return {
		id: nextId("e"),
		employeeId: worker,
		type,
		timestamp: at(timestamp),
		utcOffsetMinutes: 120,
		timezone: "Europe/Berlin",
		timezoneSource: "user_setting",
		isSuperseded: false,
		supersededById: null,
		createdBy: "worker-user",
	};
}

type Fixture = {
	period: HistoricalPeriodEvidence;
	record: HistoricalRecordEvidence | null;
	entries: HistoricalEntryEvidence[];
};

function work(
	options: {
		start?: string;
		end?: string;
		periodMinutes?: number | null;
		recordMinutes?: number | null;
		period?: Partial<HistoricalPeriodEvidence>;
		record?: Partial<HistoricalRecordEvidence> | null;
	} = {},
): Fixture {
	const start = options.start ?? "2026-07-06T07:00:00Z";
	const end = options.end ?? "2026-07-06T08:00:00Z";
	const clockIn = entry("clock_in", start);
	const clockOut = entry("clock_out", end);
	const id = nextId("p");
	const period: HistoricalPeriodEvidence = {
		id,
		employeeId: worker,
		clockInId: clockIn.id,
		clockOutId: clockOut.id,
		startTime: at(start),
		endTime: at(end),
		durationMinutes: options.periodMinutes === undefined ? 60 : options.periodMinutes,
		isActive: false,
		approvalStatus: "approved",
		hasPendingChanges: false,
		hasApprovalRequest: false,
		approvalWorkflowId: null,
		deletedAt: null,
		projectId: null,
		workCategoryId: null,
		workLocationType: null,
		canonicalRecordId: options.record === null ? null : id,
		graphRevision: 3,
		createdAt: at(end),
		...options.period,
	};
	const record: HistoricalRecordEvidence | null =
		options.record === null
			? null
			: {
					id,
					employeeId: worker,
					startAt: at(start),
					endAt: at(end),
					durationMinutes: options.recordMinutes === undefined ? 60 : options.recordMinutes,
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
	fixtures: readonly Fixture[],
	operations: HistoricalOperationEvidence[] = [],
): HistoricalWorkEvidence {
	return {
		organizationId,
		periods: fixtures.map((fixture) => fixture.period),
		records: fixtures.flatMap((fixture) => (fixture.record ? [fixture.record] : [])),
		entries: fixtures.flatMap((fixture) => fixture.entries),
		operations,
		adoption: { control: null, admissions: new Map() },
		foreignOwnedWork: [],
	};
}

const references = {
	projectIds: new Set([project]),
	workCategoryIds: new Set([category]),
};

function propose(
	subject: HistoricalWorkEvidence,
	workPeriodId: string,
	changes: RequestedRepairChange[],
) {
	return proposeHistoricalRepair({
		evidence: subject,
		references,
		request: { workPeriodId, changes, evidenceNote: "Paper timesheet signed by the employee" },
	});
}

function proposalOf(result: ReturnType<typeof propose>) {
	if (result.kind !== "proposal") throw new Error(`refused: ${result.reasons.join(", ")}`);
	return result;
}

describe("proposeHistoricalRepair", () => {
	it("proposes an exact before/after change with evidence, uncertainty and consequences", () => {
		const fixture = work({ recordMinutes: 45 });
		const receipt: HistoricalOperationEvidence = {
			id: nextId("r"),
			employeeId: worker,
			kind: "create_completed_work",
			writer: "manual_entry",
			writerVersion: 1,
			appendAdmission: "legacy",
			workPeriodId: fixture.period.id,
			createdAt: at("2026-07-06T08:00:00Z"),
		};
		const { proposal, fingerprint } = proposalOf(
			propose(evidence([fixture], [receipt]), fixture.period.id, [
				{ target: "time_record", field: "duration_minutes", after: 60 },
			]),
		);

		expect(proposal.work).toEqual({
			workPeriodId: fixture.period.id,
			timeRecordId: fixture.period.id,
		});
		expect(proposal.changes).toEqual([
			{
				target: "time_record",
				id: fixture.period.id,
				field: "duration_minutes",
				before: 45,
				after: 60,
			},
		]);
		expect(proposal.evidence.note).toBe("Paper timesheet signed by the employee");
		expect(proposal.evidence.findings.map((finding) => finding.kind)).toContain(
			"duration_conflict",
		);
		expect(proposal.uncertainty.remainingFindings.map((finding) => finding.kind)).not.toContain(
			"duration_conflict",
		);
		expect(proposal.consequences).toEqual({
			approval: {
				periodStatus: "approved",
				recordState: "approved",
				effects: ["approved_work_changes", "no_decision_recorded"],
			},
			allocation: { projectIds: [], effects: [] },
			replay: {
				receiptIds: [receipt.id],
				effects: ["committed_replay_returns_recorded_result"],
			},
			payroll: { effects: ["payable_minutes_change", "finalized_exports_unchanged"] },
			audit: {
				receiptKind: "apply_historical_repair_proposal",
				writer: "historical_repair_proposal",
			},
		});
		expect(proposal.expected.period).toMatchObject({ graphRevision: 3, durationMinutes: 60 });
		expect(proposal.expected.record).toMatchObject({ durationMinutes: 45 });
		expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});

	it("accepts operator minutes where no representation holds them", () => {
		const fixture = work({ periodMinutes: null, recordMinutes: null });
		const { proposal } = proposalOf(
			propose(evidence([fixture]), fixture.period.id, [
				{ target: "work_period", field: "duration_minutes", after: 55 },
				{ target: "time_record", field: "duration_minutes", after: 55 },
			]),
		);

		expect(proposal.changes.map((change) => [change.target, change.before, change.after])).toEqual([
			["work_period", null, 55],
			["time_record", null, 55],
		]);
		expect(proposal.evidence.findings.map((finding) => finding.kind)).toContain("duration_missing");
		expect(proposal.uncertainty.remainingFindings.map((finding) => finding.kind)).not.toContain(
			"duration_missing",
		);
		expect(proposal.consequences.payroll.effects).toContain("legacy_totals_change");
	});

	it("aligns conflicting record endpoints and metadata with owned references", () => {
		const fixture = work({
			record: { endAt: at("2026-07-06T08:30:00Z") },
			period: { workCategoryId: category },
		});
		const { proposal } = proposalOf(
			propose(evidence([fixture]), fixture.period.id, [
				{ target: "time_record", field: "end_at", after: "2026-07-06T08:00:00Z" },
				{ target: "time_record", field: "work_category_id", after: category },
				{ target: "time_record", field: "work_location_type", after: "office" },
				{ target: "work_period", field: "project_id", after: project },
			]),
		);

		expect(proposal.changes).toContainEqual({
			target: "time_record",
			id: fixture.period.id,
			field: "end_at",
			before: "2026-07-06T08:30:00Z",
			after: "2026-07-06T08:00:00Z",
		});
		expect(proposal.uncertainty.remainingFindings.map((finding) => finding.kind)).not.toContain(
			"endpoint_conflict",
		);
		expect(proposal.consequences.allocation.effects).toContain(
			"period_project_differs_from_record_allocation",
		);
	});

	it("discloses that record allocations keep their weights when minutes change", () => {
		const fixture = work({ recordMinutes: 45, record: { projectIds: [project] } });
		const { proposal } = proposalOf(
			propose(evidence([fixture]), fixture.period.id, [
				{ target: "time_record", field: "duration_minutes", after: 60 },
			]),
		);
		expect(proposal.consequences.allocation).toEqual({
			projectIds: [project],
			effects: ["allocation_weights_unchanged"],
		});
	});

	it("is stable for unchanged evidence and stale for any change to the work", () => {
		const fixture = work({ recordMinutes: 45 });
		const other = work({ start: "2026-07-07T07:00:00Z", end: "2026-07-07T08:00:00Z" });
		const changes: RequestedRepairChange[] = [
			{ target: "time_record", field: "duration_minutes", after: 60 },
		];
		const first = proposalOf(propose(evidence([fixture, other]), fixture.period.id, changes));
		const again = proposalOf(propose(evidence([other, fixture]), fixture.period.id, changes));
		expect(again.fingerprint).toBe(first.fingerprint);

		const revised = { ...fixture, period: { ...fixture.period, graphRevision: 4 } };
		const moved = proposalOf(propose(evidence([revised, other]), fixture.period.id, changes));
		expect(moved.fingerprint).not.toBe(first.fingerprint);

		const unrelated = { ...other, period: { ...other.period, graphRevision: 9 } };
		const unaffected = proposalOf(
			propose(evidence([fixture, unrelated]), fixture.period.id, changes),
		);
		expect(unaffected.fingerprint).toBe(first.fingerprint);
	});

	it.each([
		[
			"unknown work",
			() => ({ subject: evidence([work()]), id: nextId("p") }),
			[{ target: "work_period", field: "duration_minutes", after: 1 }],
			"work_not_found",
		],
		[
			"deleted work",
			() => {
				const fixture = work({ period: { deletedAt: at("2026-07-08T00:00:00Z") } });
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "work_period", field: "duration_minutes", after: 50 }],
			"work_deleted",
		],
		[
			"active work",
			() => {
				const fixture = work({ period: { isActive: true, endTime: null, clockOutId: null } });
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "work_period", field: "duration_minutes", after: 50 }],
			"work_active",
		],
		[
			"a pending approval",
			() => {
				const fixture = work({ period: { approvalStatus: "pending" } });
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "work_period", field: "duration_minutes", after: 50 }],
			"approval_pending",
		],
		[
			"a pending correction",
			() => {
				const fixture = work({ period: { hasPendingChanges: true } });
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "work_period", field: "duration_minutes", after: 50 }],
			"correction_pending",
		],
		[
			"a record change without a record",
			() => {
				const fixture = work({ record: null });
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "time_record", field: "duration_minutes", after: 50 }],
			"record_missing",
		],
		[
			"a metadata change without a work detail",
			() => {
				const fixture = work({ record: { detail: null } });
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "time_record", field: "work_location_type", after: "office" }],
			"record_detail_missing",
		],
		[
			"an unchanged value",
			() => {
				const fixture = work();
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "work_period", field: "duration_minutes", after: 60 }],
			"no_change",
		],
		[
			"the same field twice",
			() => {
				const fixture = work();
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[
				{ target: "work_period", field: "duration_minutes", after: 50 },
				{ target: "work_period", field: "duration_minutes", after: 40 },
			],
			"duplicate_field",
		],
		[
			"negative minutes",
			() => {
				const fixture = work();
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "work_period", field: "duration_minutes", after: -5 }],
			"invalid_value",
		],
		[
			"minutes beyond the interval",
			() => {
				const fixture = work();
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "time_record", field: "duration_minutes", after: 61 }],
			"minutes_exceed_interval",
		],
		[
			"a reversed record interval",
			() => {
				const fixture = work();
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "time_record", field: "end_at", after: "2026-07-06T07:00:00Z" }],
			"interval_invalid",
		],
		[
			"a foreign project",
			() => {
				const fixture = work();
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "work_period", field: "project_id", after: foreignProject }],
			"reference_outside_organization",
		],
		[
			"an unknown location type",
			() => {
				const fixture = work();
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "work_period", field: "work_location_type", after: "moon" }],
			"invalid_value",
		],
		[
			"a malformed instant",
			() => {
				const fixture = work();
				return { subject: evidence([fixture]), id: fixture.period.id };
			},
			[{ target: "time_record", field: "start_at", after: "yesterday" }],
			"invalid_value",
		],
	] as const)("refuses %s", (_name, setup, changes, reason) => {
		const { subject, id } = setup();
		const result = propose(subject, id, changes as unknown as RequestedRepairChange[]);
		expect(result).toMatchObject({ kind: "refused" });
		expect(result.kind === "refused" && result.reasons).toContain(reason);
	});

	it("refuses an empty change list", () => {
		const fixture = work();
		expect(propose(evidence([fixture]), fixture.period.id, [])).toEqual({
			kind: "refused",
			reasons: ["no_change"],
		});
	});
});
