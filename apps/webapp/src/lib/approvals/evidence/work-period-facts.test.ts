import { describe, expect, it } from "vitest";
import type { PolicyClockOutBreakSnapshot } from "@/lib/time-tracking/policy-clock-out-break-snapshot";
import { ApprovalEvidenceError } from "./errors";
import {
	breakAdjustmentDisclosure,
	buildWorkPeriodSubmittedFacts,
	compareLiveWorkPeriodWithRevision,
	fingerprintWorkPeriodMaterialFacts,
	type WorkPeriodFactsInput,
} from "./work-period-facts";

const start = new Date("2026-03-29T00:30:00.000Z");
const end = new Date("2026-03-29T08:31:40.000Z");

const workPolicyBreak: PolicyClockOutBreakSnapshot = {
	version: 1,
	evaluatedAt: end.toISOString(),
	resolution: "work_policy",
	teamId: null,
	assignment: { id: "assignment-1", type: "organization" },
	policy: { id: "policy-1", name: "Default" },
	regulationEnabled: true,
	regulation: { id: "regulation-1", name: "ArbZG", maxUninterruptedMinutes: null },
	breakRules: [{ id: "rule-1", workingMinutesThreshold: 360, requiredBreakMinutes: 30 }],
};

function input(
	overrides: {
		kind?: WorkPeriodFactsInput["kind"];
		period?: Partial<WorkPeriodFactsInput["period"]>;
		clockIn?: Partial<NonNullable<WorkPeriodFactsInput["clockIn"]>> | null;
		clockOut?: Partial<NonNullable<WorkPeriodFactsInput["clockOut"]>> | null;
		policy?: WorkPeriodFactsInput["policy"];
		requesterEmployeeId?: string;
	} = {},
): WorkPeriodFactsInput {
	const entry = (type: "clock_in" | "clock_out", id: string, timestamp: Date) => ({
		id,
		organizationId: "org-1",
		employeeId: "employee-1",
		type,
		timestamp,
		utcOffsetMinutes: type === "clock_in" ? 60 : 120,
		timezone: "Europe/Berlin",
		timezoneSource: "browser",
	});
	return {
		kind: overrides.kind ?? "manual_time_submission",
		requesterEmployeeId: overrides.requesterEmployeeId ?? "employee-1",
		period: {
			id: "period-1",
			organizationId: "org-1",
			employeeId: "employee-1",
			clockInId: "entry-in",
			clockOutId: "entry-out",
			canonicalRecordId: "record-1",
			startTime: start,
			endTime: end,
			durationMinutes: 482,
			isActive: false,
			deletedAt: null,
			projectId: "project-1",
			workCategoryId: null,
			workLocationType: "office",
			...overrides.period,
		},
		clockIn:
			overrides.clockIn === null
				? null
				: { ...entry("clock_in", "entry-in", start), ...overrides.clockIn },
		clockOut:
			overrides.clockOut === null
				? null
				: { ...entry("clock_out", "entry-out", end), ...overrides.clockOut },
		policy: overrides.policy ?? { surchargeSnapshot: null, breakPolicySnapshot: null },
	};
}

function incompleteField(run: () => unknown): string | undefined {
	try {
		run();
	} catch (error) {
		if (error instanceof ApprovalEvidenceError && error.code === "evidence_incomplete") {
			return error.details.field;
		}
		throw error;
	}
	return undefined;
}

describe("work-period submitted facts", () => {
	it("keeps each endpoint's identity and capture, the stored minutes and UTC elapsed time apart", () => {
		const facts = buildWorkPeriodSubmittedFacts(input());

		expect(facts.interval).toEqual({
			clockIn: {
				entryId: "entry-in",
				at: "2026-03-29T00:30:00Z",
				utcOffsetMinutes: 60,
				timezone: "Europe/Berlin",
				timezoneSource: "browser",
			},
			clockOut: {
				entryId: "entry-out",
				at: "2026-03-29T08:31:40Z",
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
				timezoneSource: "browser",
			},
			storedDurationMinutes: 482,
			elapsedSeconds: 8 * 3600 + 100,
		});
		expect(facts).not.toHaveProperty("before");
		expect(facts.subjectEmployeeId).toBe("employee-1");
		expect(facts.requesterEmployeeId).toBe("employee-1");
		expect(facts.attribution).toEqual({
			projectId: "project-1",
			workCategoryId: null,
			workLocationType: "office",
		});
	});

	it("never recomputes the stored minutes from the endpoints", () => {
		const facts = buildWorkPeriodSubmittedFacts(input({ period: { durationMinutes: 481 } }));
		expect(facts.interval.storedDurationMinutes).toBe(481);
		expect(facts.interval.elapsedSeconds).toBe(8 * 3600 + 100);
	});

	it("records manual submissions without a break disclosure", () => {
		const facts = buildWorkPeriodSubmittedFacts(input());
		expect(facts.policy).toEqual({
			kind: "manual_time_submission",
			surchargeSnapshot: null,
		});
	});

	it("discloses that break adjustment may apply without inventing a deduction", () => {
		const facts = buildWorkPeriodSubmittedFacts(
			input({
				kind: "policy_clock_out",
				policy: { surchargeSnapshot: null, breakPolicySnapshot: workPolicyBreak },
			}),
		);
		expect(facts.policy).toEqual({
			kind: "policy_clock_out",
			breakAdjustment: "may_apply",
			breakPolicySnapshot: workPolicyBreak,
			surchargeSnapshot: null,
		});
		expect(JSON.stringify(facts)).not.toContain("deduct");
	});

	it("classifies break disclosure only from the captured policy inputs", () => {
		expect(breakAdjustmentDisclosure({ version: 1, evaluatedAt: "x", resolution: "none" })).toBe(
			"not_applicable",
		);
		expect(breakAdjustmentDisclosure({ ...workPolicyBreak, regulationEnabled: false })).toBe(
			"not_applicable",
		);
		expect(
			breakAdjustmentDisclosure({
				...workPolicyBreak,
				breakRules: [],
				regulation: { ...workPolicyBreak.regulation, maxUninterruptedMinutes: null },
			}),
		).toBe("not_applicable");
		expect(
			breakAdjustmentDisclosure({
				...workPolicyBreak,
				breakRules: [],
				regulation: { ...workPolicyBreak.regulation, maxUninterruptedMinutes: 360 },
			}),
		).toBe("may_apply");
		expect(breakAdjustmentDisclosure(workPolicyBreak)).toBe("may_apply");
	});

	it("requires the captured break policy for policy clock-out", () => {
		expect(
			incompleteField(() => buildWorkPeriodSubmittedFacts(input({ kind: "policy_clock_out" }))),
		).toBe("break_policy");
	});

	it.each([
		["missing clock-in", { clockIn: null }, "clock_in"],
		["missing clock-out", { clockOut: null }, "clock_out"],
		["foreign clock-in", { clockIn: { organizationId: "org-2" } }, "clock_in"],
		["other employee's clock-out", { clockOut: { employeeId: "employee-2" } }, "clock_out"],
		["wrong entry type", { clockIn: { type: "clock_out" as const } }, "clock_in"],
		[
			"clock-in not the period start",
			{ clockIn: { timestamp: new Date(start.getTime() + 1) } },
			"clock_in",
		],
		[
			"clock-out not the period end",
			{ clockOut: { timestamp: new Date(end.getTime() - 1) } },
			"clock_out",
		],
		["open period", { period: { endTime: null } }, "interval"],
		["active period", { period: { isActive: true } }, "interval"],
		["deleted period", { period: { deletedAt: end } }, "interval"],
		["missing stored minutes", { period: { durationMinutes: null } }, "duration"],
		["equal endpoints", { period: { endTime: start }, clockOut: { timestamp: start } }, "interval"],
		["another requester", { requesterEmployeeId: "employee-2" }, "roles"],
	] as const)("refuses to guess with %s", (_name, overrides, field) => {
		expect(
			incompleteField(() =>
				buildWorkPeriodSubmittedFacts(input(overrides as Parameters<typeof input>[0])),
			),
		).toBe(field);
	});

	it("fingerprints identity, interval and policy inputs but not attribution", () => {
		const base = buildWorkPeriodSubmittedFacts(input());
		const fingerprint = fingerprintWorkPeriodMaterialFacts(base);

		expect(fingerprint).toMatch(/^work_period:v1:[0-9a-f]{64}$/);
		expect(
			fingerprintWorkPeriodMaterialFacts(
				buildWorkPeriodSubmittedFacts(input({ period: { projectId: null } })),
			),
		).toBe(fingerprint);
		expect(
			fingerprintWorkPeriodMaterialFacts(
				buildWorkPeriodSubmittedFacts(input({ clockOut: { utcOffsetMinutes: 60 } })),
			),
		).not.toBe(fingerprint);
		expect(
			fingerprintWorkPeriodMaterialFacts(
				buildWorkPeriodSubmittedFacts(input({ period: { durationMinutes: 481 } })),
			),
		).not.toBe(fingerprint);
	});
});

describe("live comparison with the submitted revision", () => {
	const submitted = buildWorkPeriodSubmittedFacts(input());

	it("is current while identity, endpoints and stored minutes are unchanged", () => {
		expect(
			compareLiveWorkPeriodWithRevision(submitted, input({ period: { projectId: null } })),
		).toEqual({ kind: "current" });
	});

	it("reports a moved endpoint or changed stored minutes as material", () => {
		const later = new Date(end.getTime() + 60_000);
		expect(
			compareLiveWorkPeriodWithRevision(
				submitted,
				input({ period: { endTime: later, durationMinutes: 483 }, clockOut: { timestamp: later } }),
			),
		).toEqual({ kind: "material_change", changedFields: ["interval"] });
	});

	it("reports a replaced endpoint entry as material", () => {
		expect(
			compareLiveWorkPeriodWithRevision(
				submitted,
				input({ period: { clockOutId: "entry-out-2" }, clockOut: { id: "entry-out-2" } }),
			),
		).toEqual({ kind: "material_change", changedFields: ["interval"] });
	});

	it("holds live rows that can no longer be verified", () => {
		expect(
			compareLiveWorkPeriodWithRevision(submitted, input({ period: { deletedAt: end } })),
		).toEqual({ kind: "material_change", changedFields: ["unverifiable:interval"] });
	});
});
