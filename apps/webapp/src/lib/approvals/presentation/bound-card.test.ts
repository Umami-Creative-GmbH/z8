import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { AbsenceSubmittedRevisionRecord } from "../evidence/store";
import { buildAbsenceCardFacts } from "./bound-card";

const t = (
	_key: string,
	fallback: string,
	params?: Record<string, string | number>,
) =>
	fallback.replace(/\{(\w+)\}/g, (_match, name: string) =>
		String(params?.[name] ?? ""),
	);

function revision(
	overrides: Partial<AbsenceSubmittedRevisionRecord> = {},
	coverage: AbsenceSubmittedRevisionRecord["facts"]["coverage"] = {
		kind: "full_day",
		startDate: "2026-08-03",
		endDate: "2026-08-04",
	},
): AbsenceSubmittedRevisionRecord {
	return {
		id: "r1",
		organizationId: "org",
		workflowId: "w1",
		sourceId: "a1",
		requestCycleKey: "k",
		revision: 1,
		subjectEmployeeId: "e-subject",
		requesterEmployeeId: "e-subject",
		submitter: { kind: "employee", employeeId: "e-subject", userId: "u" },
		materialFingerprint: "absence:v1:x",
		facts: {
			schemaVersion: 1,
			kind: "absence",
			organizationId: "org",
			absenceId: "a1",
			subjectEmployeeId: "e-subject",
			requesterEmployeeId: "e-subject",
			categoryId: "c1",
			coverage,
			inputEncoding: "duration_kind_full_day",
			compatibility: {
				entry: {
					startDate: "2026-08-03",
					startPeriod: "full_day",
					endDate: "2026-08-04",
					endPeriod: "full_day",
				},
				canonicalRecord: {
					id: "t",
					startAt: "2026-08-03T00:00:00Z",
					endAt: "2026-08-05T00:00:00Z",
					encoding: "utc_synthetic_bounds",
				},
			},
		},
		labels: {
			subjectName: "Avery Requester",
			requesterName: "Avery Requester",
			submitterName: "Avery Requester",
			categoryName: "Vacation",
		},
		provenance: "captured_at_submission",
		submittedAt: parseInstant("2026-07-01T22:30:00Z"),
		...overrides,
	};
}

const berlin24 = {
	locale: "en",
	timezone: "Europe/Berlin",
	timeFormat: "24h" as const,
};

describe("buildAbsenceCardFacts", () => {
	it("shows submitted logical dates and coverage without shifting by the viewer zone", () => {
		const facts = buildAbsenceCardFacts(
			revision(),
			{ kind: "current", labelChanges: [] },
			{ locale: "en", timezone: "Pacific/Kiritimati", timeFormat: "24h" },
			t,
		);
		expect(facts).not.toBeNull();
		const byLabel = Object.fromEntries(
			facts?.map((fact) => [fact.label, fact.value]) ?? [],
		);
		expect(byLabel).toMatchObject({
			Employee: "Avery Requester",
			Category: "Vacation",
			Dates: "Aug 3, 2026 – Aug 4, 2026",
			Coverage: "Full days",
		});
		expect(byLabel).not.toHaveProperty("Requested by");
		expect(byLabel).not.toHaveProperty("Submitted by");
	});

	it("shows submission time in the recipient zone and hour cycle, labelled with the zone", () => {
		const facts = buildAbsenceCardFacts(
			revision(),
			{ kind: "current", labelChanges: [] },
			berlin24,
			t,
		);
		expect(facts?.find((fact) => fact.label === "Submitted")?.value).toBe(
			"Jul 2, 2026, 00:30 (Europe/Berlin)",
		);
		const twelve = buildAbsenceCardFacts(
			revision(),
			{ kind: "current", labelChanges: [] },
			{ locale: "en", timezone: "America/New_York", timeFormat: "12h" },
			t,
		);
		expect(twelve?.find((fact) => fact.label === "Submitted")?.value).toBe(
			"Jul 1, 2026, 6:30 PM (America/New_York)",
		);
	});

	it("distinguishes employee, requester and submitter for on-behalf requests", () => {
		const facts = buildAbsenceCardFacts(
			revision({
				requesterEmployeeId: "e-manager",
				submitter: { kind: "employee", employeeId: "e-admin", userId: "u2" },
				labels: {
					subjectName: "Avery Requester",
					requesterName: "Morgan Manager",
					submitterName: null,
					categoryName: "Vacation",
				},
			}),
			{ kind: "current", labelChanges: [] },
			berlin24,
			t,
		);
		const byLabel = Object.fromEntries(
			facts?.map((fact) => [fact.label, fact.value]) ?? [],
		);
		expect(byLabel["Requested by"]).toBe("Morgan Manager");
		// Optional label missing: unavailable, never invented.
		expect(byLabel["Submitted by"]).toBe("Unavailable");
	});

	it("renders genuine half-day periods and explicit times without inventing a zone", () => {
		const halfDay = buildAbsenceCardFacts(
			revision(
				{},
				{
					kind: "half_day_periods",
					startDate: "2026-08-03",
					startPeriod: "pm",
					endDate: "2026-08-04",
					endPeriod: "am",
				},
			),
			{ kind: "current", labelChanges: [] },
			berlin24,
			t,
		);
		expect(halfDay?.find((fact) => fact.label === "Coverage")?.value).toBe(
			"Starts afternoon, ends morning",
		);
		const explicit = buildAbsenceCardFacts(
			revision(
				{},
				{
					kind: "explicit_partial",
					startDate: "2026-08-03",
					startTime: "22:00",
					endDate: "2026-08-04",
					endTime: "02:00",
					overnight: true,
					wallClockZone: "not_captured",
				},
			),
			{ kind: "current", labelChanges: [] },
			berlin24,
			t,
		);
		expect(explicit?.find((fact) => fact.label === "Coverage")?.value).toBe(
			"22:00 – 02:00 next day (local time, zone not recorded)",
		);
	});

	it("labels a renamed category as current while keeping the submitted name", () => {
		const facts = buildAbsenceCardFacts(
			revision(),
			{
				kind: "current",
				labelChanges: [
					{
						field: "categoryName",
						submitted: "Vacation",
						current: "Annual leave",
					},
				],
			},
			berlin24,
			t,
		);
		const byLabel = Object.fromEntries(
			facts?.map((fact) => [fact.label, fact.value]) ?? [],
		);
		expect(byLabel.Category).toBe("Vacation");
		expect(byLabel["Current category name"]).toBe("Annual leave");
	});

	it("requires review when essential facts are missing or the request changed", () => {
		expect(
			buildAbsenceCardFacts(
				revision({ labels: { ...revision().labels, subjectName: null } }),
				{ kind: "current", labelChanges: [] },
				berlin24,
				t,
			),
		).toBeNull();
		expect(
			buildAbsenceCardFacts(
				revision({ labels: { ...revision().labels, categoryName: null } }),
				{ kind: "current", labelChanges: [] },
				berlin24,
				t,
			),
		).toBeNull();
		expect(
			buildAbsenceCardFacts(
				revision(),
				{ kind: "material_change", changedFields: ["endDate"] },
				berlin24,
				t,
			),
		).toBeNull();
	});
});
