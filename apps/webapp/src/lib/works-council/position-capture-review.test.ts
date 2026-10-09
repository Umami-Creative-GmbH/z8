import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	buildPositionCaptureReview,
	type PositionCaptureReviewSource,
	positionCaptureReviewCsvRows,
} from "./position-capture-review";

const at = (iso: string) => parseInstant(iso);

const noticeV1 = {
	id: "notice-1",
	version: 1,
	purposeStatement: "Proof of on-site work",
	retentionDays: 90,
	templateRevision: 1,
	createdAt: at("2026-01-01T00:00:00Z"),
};
const noticeV2 = {
	...noticeV1,
	id: "notice-2",
	version: 2,
	purposeStatement: "Proof of on-site work at customer sites",
	createdAt: at("2026-03-01T00:00:00Z"),
};

function source(overrides: Partial<PositionCaptureReviewSource> = {}): PositionCaptureReviewSource {
	return {
		settings: { enabled: true, purposeStatement: noticeV2.purposeStatement, retentionDays: 60 },
		notices: [noticeV2, noticeV1],
		assignments: [],
		employees: [],
		employeeNames: {},
		accessLog: [],
		...overrides,
	};
}

const visibility = { identityVisibility: "named", minimumAggregationThreshold: 1 } as const;

describe("buildPositionCaptureReview consent counts", () => {
	it("counts active, withdrawn and undecided among the employees capture is switched on for", () => {
		const consent = (noticeId: string, version: number, withdrawnAt: string | null = null) => ({
			id: `consent-${noticeId}-${version}-${withdrawnAt ?? "open"}`,
			noticeId,
			noticeVersion: version,
			grantedAt: at("2026-03-02T00:00:00Z"),
			withdrawnAt: withdrawnAt ? at(withdrawnAt) : null,
		});
		const review = buildPositionCaptureReview(
			source({
				assignments: [
					{
						id: "a-team",
						assignmentType: "team",
						teamId: "team-field",
						teamName: "Field",
						employeeId: null,
						captureEnabled: true,
					},
					{
						id: "a-off",
						assignmentType: "employee",
						teamId: null,
						employeeId: "e-off",
						captureEnabled: false,
					},
				],
				employees: [
					// Active consent to the current notice.
					{
						employeeId: "e-active",
						teamId: "team-field",
						consents: [consent("notice-2", 2)],
						declines: [],
					},
					// Withdrew.
					{
						employeeId: "e-withdrawn",
						teamId: "team-field",
						consents: [consent("notice-2", 2, "2026-03-05T00:00:00Z")],
						declines: [],
					},
					// Consented only to the earlier version: has not answered the current one.
					{
						employeeId: "e-lapsed",
						teamId: "team-field",
						consents: [consent("notice-1", 1)],
						declines: [],
					},
					// "Not now" on the current version.
					{
						employeeId: "e-declined",
						teamId: "team-field",
						consents: [],
						declines: [{ noticeId: "notice-2", declinedAt: at("2026-03-03T00:00:00Z") }],
					},
					// Never answered.
					{ employeeId: "e-silent", teamId: "team-field", consents: [], declines: [] },
					// Switched off individually: not counted even with active consent.
					{
						employeeId: "e-off",
						teamId: "team-field",
						consents: [consent("notice-2", 2)],
						declines: [],
					},
					// No assignment reaches them.
					{ employeeId: "e-office", teamId: "team-office", consents: [], declines: [] },
				],
			}),
			visibility,
		);

		expect(review.consentCounts).toEqual({
			state: "available",
			switchedOnEmployees: 5,
			active: 1,
			withdrawn: 1,
			undecided: 3,
		});
	});

	it("withholds the counts below the minimum aggregation threshold unless identities are named, and counts nobody while switched off", () => {
		const employees = [
			{ employeeId: "e-1", teamId: null, consents: [], declines: [] },
			{ employeeId: "e-2", teamId: null, consents: [], declines: [] },
		];
		const organizationOn = [
			{
				id: "a-org",
				assignmentType: "organization" as const,
				teamId: null,
				employeeId: null,
				captureEnabled: true,
			},
		];

		for (const identityVisibility of ["aggregated", "pseudonymized"] as const) {
			expect(
				buildPositionCaptureReview(source({ assignments: organizationOn, employees }), {
					identityVisibility,
					minimumAggregationThreshold: 3,
				}).consentCounts,
			).toEqual({ state: "insufficient_data", switchedOnEmployees: 2 });
		}
		// Named identities already show who is who, so a small group hides nothing.
		expect(
			buildPositionCaptureReview(source({ assignments: organizationOn, employees }), {
				identityVisibility: "named",
				minimumAggregationThreshold: 3,
			}).consentCounts,
		).toEqual({
			state: "available",
			switchedOnEmployees: 2,
			active: 0,
			withdrawn: 0,
			undecided: 2,
		});
		expect(
			buildPositionCaptureReview(
				source({
					settings: { enabled: false, purposeStatement: null, retentionDays: 90 },
					assignments: organizationOn,
					employees,
				}),
				{ identityVisibility: "named", minimumAggregationThreshold: 0 },
			).consentCounts,
		).toEqual({
			state: "available",
			switchedOnEmployees: 0,
			active: 0,
			withdrawn: 0,
			undecided: 0,
		});
	});
});

describe("buildPositionCaptureReview access log", () => {
	const accessLog: PositionCaptureReviewSource["accessLog"] = [
		{
			id: "log-2",
			kind: "data_export",
			accessedAt: at("2026-09-21T09:00:00Z"),
			viewer: null,
			subjectEmployeeIds: ["e-anna", "e-ben"],
			workPeriods: [],
		},
		{
			id: "log-1",
			kind: "work_period_detail",
			accessedAt: at("2026-09-20T15:00:00Z"),
			viewer: { userId: "u-olga", name: "Olga Owner" },
			subjectEmployeeIds: ["e-ben"],
			workPeriods: [{ id: "period-1" }, { id: "period-2" }],
		},
	];
	const employeeNames = { "e-anna": "Anna Field", "e-ben": "Ben Office" };

	it("names the viewer and the employees when identities are named", () => {
		const review = buildPositionCaptureReview(source({ accessLog, employeeNames }), visibility);

		expect(review.accessLog).toEqual([
			{
				id: "log-2",
				kind: "data_export",
				accessedAt: "2026-09-21T09:00:00Z",
				viewer: { kind: "deleted" },
				employees: {
					state: "listed",
					identities: [
						{ kind: "named", name: "Anna Field" },
						{ kind: "named", name: "Ben Office" },
					],
				},
				workPeriodCount: 0,
			},
			{
				id: "log-1",
				kind: "work_period_detail",
				accessedAt: "2026-09-20T15:00:00Z",
				viewer: { kind: "named", name: "Olga Owner" },
				employees: { state: "listed", identities: [{ kind: "named", name: "Ben Office" }] },
				workPeriodCount: 2,
			},
		]);
	});

	it("refers to viewers and employees by pseudonyms when identities are pseudonymized", () => {
		const review = buildPositionCaptureReview(
			source({
				accessLog,
				employeeNames,
				assignments: [
					{
						id: "a-ben",
						assignmentType: "employee",
						teamId: null,
						employeeId: "e-ben",
						captureEnabled: true,
					},
				],
			}),
			{ identityVisibility: "pseudonymized", minimumAggregationThreshold: 1 },
		);

		expect(review.accessLog.map((entry) => [entry.viewer, entry.employees])).toEqual([
			[
				{ kind: "deleted" },
				{
					state: "listed",
					identities: [
						{ kind: "pseudonym", ref: "A" },
						{ kind: "pseudonym", ref: "B" },
					],
				},
			],
			[
				{ kind: "pseudonym", ref: "A" },
				{ state: "listed", identities: [{ kind: "pseudonym", ref: "B" }] },
			],
		]);
		// The same employee keeps the same pseudonym across the section.
		expect(review.employeeAssignments).toEqual({
			state: "listed",
			rows: [{ employee: { kind: "pseudonym", ref: "B" }, captureEnabled: true }],
		});
		expect(JSON.stringify(review)).not.toMatch(/Anna|Ben|Olga|e-anna|e-ben|u-olga/);
	});

	it("shows no viewer and only how many employees were covered when identities are aggregated", () => {
		const review = buildPositionCaptureReview(source({ accessLog, employeeNames }), {
			identityVisibility: "aggregated",
			minimumAggregationThreshold: 1,
		});

		expect(review.accessLog.map((entry) => [entry.viewer, entry.employees])).toEqual([
			[{ kind: "hidden" }, { state: "counted", count: 2 }],
			[{ kind: "hidden" }, { state: "counted", count: 1 }],
		]);
		expect(JSON.stringify(review)).not.toMatch(/Anna|Ben|Olga|e-anna|e-ben|u-olga/);
	});
});

describe("positionCaptureReviewCsvRows", () => {
	const review = (identityVisibility: "aggregated" | "pseudonymized" | "named") =>
		buildPositionCaptureReview(
			source({
				assignments: [
					{
						id: "a-team",
						assignmentType: "team",
						teamId: "t",
						teamName: "Field",
						employeeId: null,
						captureEnabled: true,
					},
					{
						id: "a-ben",
						assignmentType: "employee",
						teamId: null,
						employeeId: "e-ben",
						captureEnabled: false,
					},
				],
				employees: [{ employeeId: "e-anna", teamId: "t", consents: [], declines: [] }],
				employeeNames: { "e-ben": "Ben Office" },
				accessLog: [
					{
						id: "log-1",
						kind: "work_period_detail",
						accessedAt: at("2026-09-20T15:00:00Z"),
						viewer: { userId: "u-olga", name: "Olga Owner" },
						subjectEmployeeIds: ["e-ben"],
						workPeriods: [{ id: "period-1" }],
					},
				],
			}),
			{ identityVisibility, minimumAggregationThreshold: 1 },
		);

	it("writes the configuration, notices, consent counts and access log", () => {
		const rows = positionCaptureReviewCsvRows(review("named"));

		expect(rows).toContainEqual(["Position capture"]);
		expect(rows).toContainEqual(["Position capture enabled", "yes"]);
		expect(rows).toContainEqual(["Position retention days", 60]);
		expect(rows).toContainEqual(["Current position notice version", 2]);
		expect(rows).toContainEqual(["Team assignment", "Field", "on"]);
		expect(rows).toContainEqual(["Employee assignment", "Ben Office", "off"]);
		expect(rows).toContainEqual(["Consent: switched-on employees", 1]);
		expect(rows).toContainEqual(["Consent: active", 0]);
		expect(rows).toContainEqual(["Consent: withdrawn", 0]);
		expect(rows).toContainEqual(["Consent: undecided", 1]);
		expect(rows).toContainEqual([1, "2026-01-01T00:00:00Z", 90, 1, "Proof of on-site work"]);
		expect(rows).toContainEqual([
			"2026-09-20T15:00:00Z",
			"work_period_detail",
			"Olga Owner",
			"Ben Office",
			1,
		]);
	});

	it("writes no names under pseudonymized or aggregated identities", () => {
		const pseudonymized = JSON.stringify(positionCaptureReviewCsvRows(review("pseudonymized")));
		expect(pseudonymized).not.toMatch(/Ben|Olga/);
		expect(pseudonymized).toContain('"Employee A"');
		expect(pseudonymized).toContain('"Viewer A"');

		const aggregatedRows = positionCaptureReviewCsvRows(review("aggregated"));
		expect(JSON.stringify(aggregatedRows)).not.toMatch(/Ben|Olga|Employee A|Viewer A/);
		expect(aggregatedRows).toContainEqual(["Employee assignments switched on", 0]);
		expect(aggregatedRows).toContainEqual(["Employee assignments switched off", 1]);
		expect(aggregatedRows).toContainEqual([
			"2026-09-20T15:00:00Z",
			"work_period_detail",
			"hidden",
			"1 employee(s)",
			1,
		]);
	});
});

describe("buildPositionCaptureReview configuration", () => {
	const assignments = [
		{
			id: "a-org",
			assignmentType: "organization" as const,
			teamId: null,
			employeeId: null,
			captureEnabled: false,
		},
		{
			id: "a-team",
			assignmentType: "team" as const,
			teamId: "team-field",
			teamName: "Field",
			employeeId: null,
			captureEnabled: true,
		},
		{
			id: "a-anna",
			assignmentType: "employee" as const,
			teamId: null,
			employeeId: "e-anna",
			captureEnabled: false,
		},
		{
			id: "a-ben",
			assignmentType: "employee" as const,
			teamId: null,
			employeeId: "e-ben",
			captureEnabled: true,
		},
	];
	const employeeNames = { "e-anna": "Anna Field", "e-ben": "Ben Office" };

	it("shows the switch, retention, notices and named employee assignments", () => {
		const review = buildPositionCaptureReview(source({ assignments, employeeNames }), visibility);

		expect(review.enabled).toBe(true);
		expect(review.retentionDays).toBe(60);
		expect(review.currentNotice?.version).toBe(2);
		expect(review.noticeHistory.map((notice) => notice.version)).toEqual([2, 1]);
		expect(review.noticeHistory[1]).toEqual({
			version: 1,
			purposeStatement: "Proof of on-site work",
			retentionDays: 90,
			templateRevision: 1,
			publishedAt: "2026-01-01T00:00:00Z",
		});
		expect(review.organizationAssignment).toBe(false);
		expect(review.teamAssignments).toEqual([{ teamName: "Field", captureEnabled: true }]);
		expect(review.employeeAssignments).toEqual({
			state: "listed",
			rows: [
				{ employee: { kind: "named", name: "Anna Field" }, captureEnabled: false },
				{ employee: { kind: "named", name: "Ben Office" }, captureEnabled: true },
			],
		});
	});

	it("lists employee assignments under pseudonyms when identities are pseudonymized", () => {
		const review = buildPositionCaptureReview(source({ assignments, employeeNames }), {
			identityVisibility: "pseudonymized",
			minimumAggregationThreshold: 1,
		});

		expect(review.employeeAssignments).toEqual({
			state: "listed",
			rows: [
				{ employee: { kind: "pseudonym", ref: "A" }, captureEnabled: false },
				{ employee: { kind: "pseudonym", ref: "B" }, captureEnabled: true },
			],
		});
		expect(JSON.stringify(review)).not.toMatch(/Anna|Ben|e-anna|e-ben/);
	});

	it("only counts employee assignments when identities are aggregated", () => {
		const review = buildPositionCaptureReview(source({ assignments, employeeNames }), {
			identityVisibility: "aggregated",
			minimumAggregationThreshold: 1,
		});

		expect(review.employeeAssignments).toEqual({ state: "counted", switchedOn: 1, switchedOff: 1 });
		expect(JSON.stringify(review)).not.toMatch(/Anna|Ben|e-anna|e-ben/);
	});
});
