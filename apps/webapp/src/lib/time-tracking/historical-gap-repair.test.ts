import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type HistoricalGapRepairPlan,
	planHistoricalGapRepair,
} from "./historical-gap-repair";
import {
	assessHistoricalWork,
	type HistoricalEntryEvidence,
	type HistoricalPeriodEvidence,
	type HistoricalRecordEvidence,
	type HistoricalWorkEvidence,
	type HistoricalWorkScope,
} from "./historical-work-diagnostics";

const organizationId = "org-1";
const worker = "a0000000-0000-4000-8000-000000000001";
const peer = "a0000000-0000-4000-8000-000000000002";
const project = "f0000000-0000-4000-8000-000000000001";
const category = "f0000000-0000-4000-8000-000000000002";

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
		utcOffsetMinutes: 120,
		timezone: "Europe/Berlin",
		timezoneSource: "user_setting",
		isSuperseded: false,
		supersededById: null,
		createdBy: `${type}-author`,
		...overrides,
	};
}

type WorkFixture = {
	period: HistoricalPeriodEvidence;
	record: HistoricalRecordEvidence | null;
	entries: HistoricalEntryEvidence[];
};

function work(
	start: string,
	end: string,
	options: {
		employeeId?: string;
		minutes?: number;
		period?: Partial<HistoricalPeriodEvidence>;
		record?: Partial<HistoricalRecordEvidence> | null;
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
		canonicalRecordId: options.record === null ? null : recordId,
		graphRevision: 0,
		createdAt: at(end),
		...options.period,
	};
	const record: HistoricalRecordEvidence | null =
		options.record === null
			? null
			: {
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
		records: fixtures.flatMap((fixture) => (fixture.record ? [fixture.record] : [])),
		entries: fixtures.flatMap((fixture) => fixture.entries),
		operations: [],
		adoption: { control: null, admissions: new Map() },
		foreignOwnedWork: [],
		...overrides,
	};
}

const july: HistoricalWorkScope = {
	employeeIds: [worker, peer],
	range: { start: at("2026-07-01T00:00:00Z"), endExclusive: at("2026-08-01T00:00:00Z") },
};

const ownedReferences = {
	projectIds: new Set([project]),
	workCategoryIds: new Set([category]),
};

function plan(
	subject: HistoricalWorkEvidence,
	references = ownedReferences,
): HistoricalGapRepairPlan {
	return planHistoricalGapRepair({
		evidence: subject,
		report: assessHistoricalWork(subject, july),
		references,
	});
}

function onlyUnit(result: HistoricalGapRepairPlan) {
	expect(result.employees).toHaveLength(1);
	expect(result.employees[0].units).toHaveLength(1);
	return result.employees[0].units[0];
}

function heldReasons(result: HistoricalGapRepairPlan) {
	return result.held.map((gap) => [gap.kind, gap.reason]).toSorted();
}

describe("planHistoricalGapRepair fills uniquely evidenced gaps", () => {
	it("plans nothing for consistent work", () => {
		const result = plan(evidence([work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z")]));
		expect(result.employees).toEqual([]);
		expect(result.held).toEqual([]);
	});

	it("links an unlinked period to the record carrying its ID, keeping that ID", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { canonicalRecordId: null },
		});
		const record = { ...(fixture.record as HistoricalRecordEvidence), id: fixture.period.id };
		const unit = onlyUnit(plan(evidence([{ ...fixture, record }])));
		expect(unit.canonicalRecordId).toBe(fixture.period.id);
		expect(unit.fills).toEqual([
			expect.objectContaining({ kind: "canonical_link", recordId: fixture.period.id }),
		]);
		expect(unit.originalActor).toEqual({ kind: "unknown_historical" });
		expect(unit.expected.period).toMatchObject({ graphRevision: 0, canonicalRecordId: null });
	});

	it("creates a missing canonical record from the period with the completing entry's author", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:40Z", {
			minutes: 480,
			record: null,
			period: {
				approvalStatus: "pending",
				hasPendingChanges: true,
				projectId: project,
				workCategoryId: category,
				workLocationType: "home",
			},
		});
		const unit = onlyUnit(plan(evidence([fixture])));
		const clockOut = fixture.entries[1];
		expect(unit.canonicalRecordId).toBe(fixture.period.id);
		expect(unit.fills).toEqual([
			expect.objectContaining({
				kind: "canonical_record",
				recordId: fixture.period.id,
				// Stored minutes govern: 480 is kept although the endpoints span 480m40s.
				record: {
					startAt: "2026-07-02T08:00:00Z",
					endAt: "2026-07-02T16:00:40Z",
					durationMinutes: 480,
					approvalState: "pending",
				},
				detail: { workCategoryId: category, workLocationType: "home" },
				projectId: project,
			}),
		]);
		expect(unit.originalActor).toEqual({
			kind: "human",
			userId: clockOut.createdBy,
			evidence: { entryId: clockOut.id, side: "end" },
		});
	});

	it("keeps positive zero-minute work at zero minutes", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T08:00:20Z", {
			minutes: 0,
			record: null,
		});
		const unit = onlyUnit(plan(evidence([fixture])));
		expect(unit.fills[0]).toMatchObject({ kind: "canonical_record", record: { durationMinutes: 0 } });
	});

	it("restores a missing work detail and project allocation from the linked period", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { projectId: project, workLocationType: "office" },
			record: { detail: null },
		});
		const unit = onlyUnit(plan(evidence([fixture])));
		expect(unit.fills).toEqual([
			expect.objectContaining({
				kind: "canonical_detail",
				detail: { workCategoryId: null, workLocationType: "office" },
				projectId: project,
			}),
		]);
	});

	it("completes canonical work opened but never completed from the closed period", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			record: { endAt: null, durationMinutes: null },
		});
		const unit = onlyUnit(plan(evidence([fixture])));
		expect(unit.fills).toEqual([
			expect.objectContaining({
				kind: "canonical_completion",
				endAt: "2026-07-02T16:00:00Z",
				durationMinutes: 480,
			}),
		]);
	});

	it("completes a closed-out legacy period from its clock-out entry and canonical record", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { endTime: null, durationMinutes: null },
		});
		const unit = onlyUnit(plan(evidence([fixture])));
		expect(unit.fills).toEqual([
			expect.objectContaining({
				kind: "period_completion",
				endTime: "2026-07-02T16:00:00Z",
				durationMinutes: 480,
			}),
		]);
	});

	it("copies an agreeing representation's established minutes in either direction", () => {
		const canonical = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			minutes: 470,
			record: { durationMinutes: null },
		});
		const legacy = work("2026-07-03T08:00:00Z", "2026-07-03T16:00:00Z", {
			minutes: 465,
			period: { durationMinutes: null },
		});
		const result = plan(evidence([canonical, legacy]));
		const fills = result.employees[0].units.flatMap((unit) => unit.fills);
		expect(fills).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "canonical_duration", durationMinutes: 470 }),
				expect.objectContaining({ kind: "period_duration", durationMinutes: 465 }),
			]),
		);
	});

	it("fills missing canonical metadata only where the record has none", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { projectId: project, workCategoryId: category, workLocationType: "home" },
		});
		const unit = onlyUnit(plan(evidence([fixture])));
		expect(unit.fills.map((fill) => fill.kind === "canonical_metadata" && fill.field)).toEqual([
			"project",
			"work_category",
			"work_location_type",
		]);
	});

	it("separates employees and changes the plan identity with the expected revision", () => {
		const mine = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { canonicalRecordId: null },
		});
		const theirs = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			employeeId: peer,
			record: { detail: null },
		});
		const link = { ...mine, record: { ...(mine.record as HistoricalRecordEvidence), id: mine.period.id } };
		const first = plan(evidence([link, theirs]));
		expect(first.employees.map((employee) => employee.employeeId)).toEqual([worker, peer]);
		expect(plan(evidence([link, theirs])).employees[0].fingerprint).toBe(
			first.employees[0].fingerprint,
		);
		const revised = plan(
			evidence([{ ...link, period: { ...link.period, graphRevision: 1 } }, theirs]),
		);
		expect(revised.employees[0].fingerprint).not.toBe(first.employees[0].fingerprint);
		expect(revised.employees[1].fingerprint).toBe(first.employees[1].fingerprint);
	});
});

describe("planHistoricalGapRepair holds everything else", () => {
	it("never derives a duration no representation holds", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { durationMinutes: null },
			record: { durationMinutes: null },
		});
		const result = plan(evidence([fixture]));
		expect(result.employees).toEqual([]);
		expect(heldReasons(result)).toEqual([
			["duration_missing", "original_rule_unknown"],
			["duration_missing", "original_rule_unknown"],
		]);
	});

	it("holds a missing record whose original creator no entry evidences", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			record: null,
			period: { clockOutId: null },
		});
		const result = plan(evidence([fixture]));
		expect(result.employees).toEqual([]);
		expect(heldReasons(result)).toEqual([
			["canonical_missing", "original_actor_unrepresentable"],
			["endpoint_entry_missing", "no_restorable_evidence"],
		]);
	});

	it("holds missing records of active work and without established minutes", () => {
		const active = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			record: null,
			period: { endTime: null, clockOutId: null, durationMinutes: null, isActive: true },
		});
		const unmeasured = work("2026-07-01T08:00:00Z", "2026-07-01T16:00:00Z", {
			record: null,
			period: { durationMinutes: null },
		});
		const result = plan(evidence([active, unmeasured]));
		expect(result.employees).toEqual([]);
		expect(heldReasons(result)).toEqual([
			["canonical_missing", "active_work"],
			["canonical_missing", "original_rule_unknown"],
			["duration_missing", "original_rule_unknown"],
		]);
	});

	it("holds all gaps of work with any conflicting finding", () => {
		const conflicted = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { workLocationType: "home", durationMinutes: 480 },
			record: { durationMinutes: 470 },
		});
		const result = plan(evidence([conflicted]));
		expect(result.employees).toEqual([]);
		expect(result.held).toEqual([
			expect.objectContaining({
				kind: "metadata_missing",
				reason: "conflicting_evidence",
				heldBy: [expect.stringMatching(/^duration_conflict:/)],
			}),
		]);
	});

	it("holds overlapping work as a possible duplicate and an empty interval for review", () => {
		const first = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			record: { detail: null },
		});
		const second = work("2026-07-02T15:00:00Z", "2026-07-02T18:00:00Z", {
			period: { canonicalRecordId: null },
			record: null,
		});
		const empty = work("2026-07-04T08:00:00Z", "2026-07-04T08:00:00Z", { record: null });
		const result = plan(evidence([first, second, empty]));
		expect(result.employees).toEqual([]);
		expect(heldReasons(result)).toEqual([
			["canonical_detail_missing", "conflicting_evidence"],
			["canonical_missing", "conflicting_evidence"],
			["canonical_missing", "conflicting_evidence"],
		]);
	});

	it("never starts a workflow or writes an entry, and leaves native work unrepaired", () => {
		const pending = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { approvalStatus: "pending" },
			record: { approvalState: "pending" },
		});
		const native = work("2026-07-03T08:00:00Z", "2026-07-03T16:00:00Z", {
			record: { detail: null },
		});
		const nativeEvidence = evidence([pending]);
		const result = plan({
			...nativeEvidence,
			records: [...nativeEvidence.records, native.record as HistoricalRecordEvidence],
		});
		expect(result.employees).toEqual([]);
		expect(heldReasons(result)).toEqual([
			["approval_relationship_missing", "no_restorable_evidence"],
			["canonical_detail_missing", "no_restorable_evidence"],
		]);
	});

	it("refuses references the organization does not own", () => {
		const fixture = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			record: null,
			period: { projectId: project },
		});
		const result = plan(evidence([fixture]), {
			projectIds: new Set(),
			workCategoryIds: new Set([category]),
		});
		expect(heldReasons(result)).toEqual([["canonical_missing", "reference_outside_organization"]]);
	});

	it("does not plan deleted work, post-adoption gaps or gaps of ambiguous provenance", () => {
		const deleted = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			record: null,
			period: { deletedAt: at("2026-07-03T00:00:00Z") },
		});
		const fresh = work("2026-07-05T08:00:00Z", "2026-07-05T16:00:00Z", {
			record: null,
			period: { createdAt: at("2026-07-05T16:00:00Z") },
		});
		const result = plan(
			evidence([deleted, fresh], {
				adoption: {
					control: { mode: "active", updatedAt: at("2026-07-04T00:00:00Z") },
					admissions: new Map(),
				},
			}),
		);
		expect(result).toEqual({ version: 1, employees: [], held: [] });
	});

	it("plans pre-adoption gaps of an adopted organization", () => {
		const historical = work("2026-07-02T08:00:00Z", "2026-07-02T16:00:00Z", {
			period: { canonicalRecordId: null },
		});
		const link = {
			...historical,
			record: { ...(historical.record as HistoricalRecordEvidence), id: historical.period.id },
		};
		const result = plan(
			evidence([link], {
				adoption: {
					control: { mode: "active", updatedAt: at("2026-07-04T00:00:00Z") },
					admissions: new Map(),
				},
			}),
		);
		expect(onlyUnit(result).fills[0].kind).toBe("canonical_link");
	});
});
