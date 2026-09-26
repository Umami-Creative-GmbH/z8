import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import type { WorkFinding } from "@/lib/time-tracking/historical-work-diagnostics";
import {
	assessPayrollWorkCollection,
	type PayrollCollectionEmployee,
	type PayrollCollectionRequest,
	type PayrollCollectionSnapshot,
	type PayrollCollectionWorkRecord,
	payrollWorkInputDigest,
} from "./payroll-work-collection";

const instant = (value: string) => Temporal.Instant.from(value);

const berlin: PayrollCollectionEmployee = {
	id: "employee-berlin",
	employeeNumber: "B-1",
	firstName: "Bea",
	lastName: "Berlin",
	email: "bea@example.test",
	timezone: "Europe/Berlin",
};
const tokyo: PayrollCollectionEmployee = {
	id: "employee-tokyo",
	employeeNumber: "T-1",
	firstName: "Taro",
	lastName: "Tokyo",
	email: "taro@example.test",
	timezone: "Asia/Tokyo",
};

const july: PayrollCollectionRequest = {
	organizationId: "org-1",
	startDate: "2026-07-01",
	endDate: "2026-07-31",
	employeeIds: [berlin.id, tokyo.id],
	teamIds: null,
	projectIds: null,
};

function work(
	id: string,
	overrides: Partial<PayrollCollectionWorkRecord> = {},
): PayrollCollectionWorkRecord {
	return {
		id,
		employeeId: berlin.id,
		startAt: instant("2026-07-10T07:00:00Z"),
		endAt: instant("2026-07-10T09:00:00Z"),
		durationMinutes: 120,
		approvalState: "approved",
		updatedAt: instant("2026-07-10T09:00:01Z"),
		workPeriod: { id: `period-${id}`, graphRevision: 1, deleted: false },
		pendingCorrection: false,
		workCategory: null,
		projects: [],
		...overrides,
	};
}

function finding(overrides: Partial<WorkFinding>): WorkFinding {
	return {
		id: "finding-1",
		kind: "duration_conflict",
		shape: "conflicting",
		treatment: "review_required",
		blocking: true,
		employeeIds: [berlin.id],
		workPeriodIds: [],
		timeRecordIds: [],
		entryIds: [],
		provenance: { state: "pre_adoption", basis: "organization_not_adopted" },
		relevance: { level: "interval", start: "2026-07-03T08:00:00Z", end: "2026-07-03T10:00:00Z" },
		relevant: true,
		details: {},
		...overrides,
	};
}

function snapshot(overrides: Partial<PayrollCollectionSnapshot> = {}): PayrollCollectionSnapshot {
	return {
		employees: [berlin, tokyo],
		records: [],
		diagnostics: { completeness: { status: "complete", widenedTo: "requested" }, findings: [] },
		departureRepairs: [],
		...overrides,
	};
}

describe("assessPayrollWorkCollection", () => {
	it("collects approved work with protected stored minutes in each employee-local window", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				records: [
					// Stored 60 minutes over 60m40s: fully included, so the stored minutes stand.
					work("full", {
						startAt: instant("2026-07-10T07:00:00Z"),
						endAt: instant("2026-07-10T08:00:40Z"),
						durationMinutes: 60,
						workCategory: { id: "category-1", name: "Regular", factor: "1.00" },
						projects: [
							{ projectId: "project-low", name: "Low", weightPercent: 20 },
							{ projectId: "project-high", name: "High", weightPercent: 80 },
						],
					}),
					// 23:00 Tokyo on 31 July is inside the Tokyo window but 14:00 UTC.
					work("tokyo", {
						employeeId: tokyo.id,
						startAt: instant("2026-07-31T13:00:00Z"),
						endAt: instant("2026-07-31T14:00:00Z"),
						durationMinutes: 60,
						workPeriod: null,
					}),
				],
			}),
			july,
		);

		expect(result.blockers).toEqual([]);
		expect(result.input.work).toEqual([
			expect.objectContaining({
				recordId: "full",
				employeeId: berlin.id,
				minutes: 60,
				startAt: "2026-07-10T07:00:00Z",
				endExclusive: "2026-07-10T08:00:40Z",
				workCategory: { id: "category-1", name: "Regular", factor: "1.00" },
				project: { id: "project-high", name: "High" },
				person: {
					employeeNumber: "B-1",
					firstName: "Bea",
					lastName: "Berlin",
					email: "bea@example.test",
				},
				source: {
					recordUpdatedAt: "2026-07-10T09:00:01Z",
					workPeriodId: "period-full",
					graphRevision: 1,
				},
			}),
			expect.objectContaining({
				recordId: "tokyo",
				minutes: 60,
				source: expect.objectContaining({ workPeriodId: null, graphRevision: null }),
			}),
		]);
	});

	it("splits boundary work by cumulative allocation so adjacent windows conserve stored minutes", () => {
		// 23:30-00:30 Berlin across 31 July / 1 August with 61 stored minutes.
		const crossing = work("crossing", {
			startAt: instant("2026-07-31T21:30:00Z"),
			endAt: instant("2026-07-31T22:30:00Z"),
			durationMinutes: 61,
		});
		const julyMinutes = assessPayrollWorkCollection(snapshot({ records: [crossing] }), july).input
			.work[0]?.minutes;
		const augustMinutes = assessPayrollWorkCollection(snapshot({ records: [crossing] }), {
			...july,
			startDate: "2026-08-01",
			endDate: "2026-08-31",
		}).input.work[0]?.minutes;

		expect(julyMinutes).toBe(31);
		expect(augustMinutes).toBe(30);
	});

	it("blocks open work that starts before the window ends instead of omitting it", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				records: [
					work("open", { endAt: null, durationMinutes: null, approvalState: "draft" }),
					work("later-open", {
						endAt: null,
						durationMinutes: null,
						startAt: instant("2026-08-02T08:00:00Z"),
					}),
				],
			}),
			july,
		);

		expect(result.blockers).toEqual([
			{
				kind: "open_work",
				sourceId: "open",
				employeeId: berlin.id,
				at: "2026-07-10T07:00:00Z",
				reason: null,
			},
		]);
		expect(result.input.work).toEqual([]);
	});

	it("blocks work whose approval is undecided and excludes rejected work explicitly", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				records: [
					work("pending", { approvalState: "pending" }),
					work("draft", { approvalState: "draft", employeeId: tokyo.id, workPeriod: null }),
					work("rejected", { approvalState: "rejected" }),
					work("pending-august", {
						approvalState: "pending",
						startAt: instant("2026-08-10T07:00:00Z"),
						endAt: instant("2026-08-10T08:00:00Z"),
					}),
				],
			}),
			july,
		);

		expect(result.blockers.map((blocker) => [blocker.kind, blocker.sourceId])).toEqual([
			["pending_work_approval", "pending"],
			["pending_work_approval", "draft"],
		]);
		expect(result.input.excluded).toEqual([{ recordId: "rejected", reason: "rejected" }]);
	});

	it("blocks work whose minutes cannot be allocated", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				records: [
					work("missing-minutes", { durationMinutes: null }),
					// Crosses the window end with 90 stored minutes over 60 elapsed: an unlocated break.
					work("unlocated-break", {
						startAt: instant("2026-07-31T21:30:00Z"),
						endAt: instant("2026-07-31T22:30:00Z"),
						durationMinutes: 90,
					}),
				],
			}),
			july,
		);

		expect(
			result.blockers.map((blocker) => [blocker.kind, blocker.sourceId, blocker.reason]),
		).toEqual([
			["unresolved_work_minutes", "missing-minutes", "missing_stored_minutes"],
			["unresolved_work_minutes", "unlocated-break", "unresolved_interval"],
		]);
	});

	it("blocks approved work whose correction still awaits a decision", () => {
		const result = assessPayrollWorkCollection(
			snapshot({ records: [work("corrected", { pendingCorrection: true })] }),
			july,
		);

		expect(result.blockers.map((blocker) => [blocker.kind, blocker.sourceId])).toEqual([
			["pending_work_correction", "corrected"],
		]);
		expect(result.input.work).toEqual([]);
	});

	it("uses the hull of reversed endpoints for relevance", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				records: [
					work("reversed-july", {
						startAt: instant("2026-07-10T09:00:00Z"),
						endAt: instant("2026-07-10T07:00:00Z"),
					}),
					work("reversed-2019", {
						startAt: instant("2019-03-10T09:00:00Z"),
						endAt: instant("2019-03-10T07:00:00Z"),
					}),
				],
			}),
			july,
		);

		expect(result.blockers.map((blocker) => [blocker.sourceId, blocker.reason])).toEqual([
			["reversed-july", "invalid_endpoints"],
		]);
	});

	it("keeps valid zero-minute work distinguishable from excluded and missing work", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				records: [
					work("zero", {
						startAt: instant("2026-07-10T07:00:00Z"),
						endAt: instant("2026-07-10T07:00:20Z"),
						durationMinutes: 0,
					}),
				],
			}),
			july,
		);

		expect(result.blockers).toEqual([]);
		expect(result.input.work).toEqual([]);
		expect(result.input.excluded).toEqual([{ recordId: "zero", reason: "zero_minutes" }]);
	});

	it("excludes the record of a deleted period without making it payable", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				records: [
					work("deleted", {
						workPeriod: { id: "period-deleted", graphRevision: 3, deleted: true },
					}),
				],
			}),
			july,
		);

		expect(result.input.work).toEqual([]);
		expect(result.input.excluded).toEqual([{ recordId: "deleted", reason: "deleted" }]);
	});

	it("turns relevant blocking diagnostics into blockers for the affected scoped employees only", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				records: [work("fine")],
				diagnostics: {
					completeness: { status: "incomplete", widenedTo: "requested" },
					findings: [
						finding({ id: "conflict", employeeIds: [berlin.id, "employee-outside-scope"] }),
						finding({ id: "disclosure", blocking: false, kind: "capture_inferred" }),
					],
				},
			}),
			july,
		);

		// The finding also names work outside the scope, so its start stays undisclosed.
		expect(result.blockers).toEqual([
			{
				kind: "uncertain_historical_work",
				sourceId: "conflict",
				employeeId: berlin.id,
				at: null,
				reason: "duration_conflict",
			},
		]);
		expect(JSON.stringify(result)).not.toContain("employee-outside-scope");
	});

	it("localizes historical uncertainty that lies entirely within the scope", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				diagnostics: {
					completeness: { status: "incomplete", widenedTo: "requested" },
					findings: [finding({ id: "own", employeeIds: [berlin.id] })],
				},
			}),
			july,
		);

		expect(result.blockers.map((blocker) => [blocker.employeeId, blocker.at])).toEqual([
			[berlin.id, "2026-07-03T08:00:00Z"],
		]);
	});

	it("widens organization-level uncertainty to every scoped employee", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				diagnostics: {
					completeness: { status: "incomplete", widenedTo: "organization" },
					findings: [
						finding({
							id: "foreign-owner",
							kind: "work_outside_organization_employees",
							employeeIds: [],
							relevance: { level: "organization" },
						}),
					],
				},
			}),
			july,
		);

		expect(result.blockers.map((blocker) => [blocker.employeeId, blocker.at])).toEqual([
			[berlin.id, null],
			[tokyo.id, null],
		]);
	});

	it("blocks unrepaired departure timers", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				departureRepairs: [
					{
						reviewId: "review-1",
						employeeId: tokyo.id,
						affectedEndAt: instant("2026-07-20T10:00:00Z"),
					},
				],
			}),
			july,
		);

		expect(result.blockers).toEqual([
			{
				kind: "offboarding_clock_repair",
				sourceId: "review-1",
				employeeId: tokyo.id,
				at: "2026-07-20T10:00:00Z",
				reason: null,
			},
		]);
	});

	it("applies the project filter after readiness, recording the filtered work as excluded", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				records: [
					work("in-project", { projects: [{ projectId: "p1", name: "One", weightPercent: 100 }] }),
					work("other-project", {
						projects: [{ projectId: "p2", name: "Two", weightPercent: 100 }],
					}),
					work("pending-other", {
						approvalState: "pending",
						projects: [{ projectId: "p2", name: "Two", weightPercent: 100 }],
					}),
				],
			}),
			{ ...july, projectIds: ["p1"] },
		);

		expect(result.input.work.map((line) => line.recordId)).toEqual(["in-project"]);
		expect(result.input.excluded).toEqual([
			{ recordId: "other-project", reason: "outside_project_filter" },
		]);
		// Undecided work is uncertain whatever its current project.
		expect(result.blockers.map((blocker) => blocker.sourceId)).toEqual(["pending-other"]);
	});

	it("ignores records of employees outside the scope", () => {
		const result = assessPayrollWorkCollection(
			snapshot({
				records: [work("stranger", { employeeId: "employee-stranger", approvalState: "pending" })],
			}),
			july,
		);

		expect(result.blockers).toEqual([]);
		expect(result.input.work).toEqual([]);
	});

	it("produces the same ordered input and digest regardless of read order", () => {
		const records = [
			work("b", {
				startAt: instant("2026-07-11T07:00:00Z"),
				endAt: instant("2026-07-11T08:00:00Z"),
				durationMinutes: 60,
			}),
			work("a", { employeeId: tokyo.id, workPeriod: null }),
			work("c"),
		];
		const forward = assessPayrollWorkCollection(snapshot({ records }), july);
		const reversed = assessPayrollWorkCollection(
			snapshot({ records: records.toReversed(), employees: [tokyo, berlin] }),
			july,
		);

		expect(reversed.input).toEqual(forward.input);
		expect(forward.input.digest).toBe(payrollWorkInputDigest(forward.input));
		expect(forward.input.work.map((line) => line.recordId)).toEqual(["c", "b", "a"]);
	});

	it("changes the digest when any collected fact changes", () => {
		const base = assessPayrollWorkCollection(snapshot({ records: [work("a")] }), july).input;
		const changed = assessPayrollWorkCollection(
			snapshot({ records: [work("a", { durationMinutes: 119 })] }),
			july,
		).input;

		expect(changed.digest).not.toBe(base.digest);
		expect(payrollWorkInputDigest({ ...base, work: changed.work })).not.toBe(base.digest);
	});
});
