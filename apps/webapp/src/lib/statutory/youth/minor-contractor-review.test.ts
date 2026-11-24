import { describe, expect, it } from "vitest";
import type { EmploymentPeriodSnapshot } from "@/lib/contracts/resolve-contract";
import { Temporal } from "temporal-polyfill";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { minorContractorEngagementFindings } from "./minor-contractor-review";

const localInstant = (date: string, time: string, zone: string) =>
	Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(zone).toInstant();

// #2022: a contractor under 18 on a day of an engagement in the window is one review item per
// engagement period (§ 1 Abs. 1 Nr. 3 JArbSchG); adults and employee stints raise none.

const timezone = "Europe/Berlin";
const window = { start: "2026-03-01", endExclusive: "2026-05-01" };

function stint(
	id: string,
	kind: "contractor" | "employee",
	from: string | null,
	until: string | null,
): EmploymentPeriodSnapshot {
	return {
		id,
		employeeId: "e1",
		status: until ? "closed" : "open",
		startedAt: from ? localInstant(from, "00:00", timezone) : null,
		startProvenance: from ? "recorded" : "unknown",
		endedAt: until ? localInstant(until, "00:00", timezone) : null,
		createdAt: localInstant("2026-01-01", "00:00", timezone),
		engagementKind: kind,
	};
}

function judge(input: {
	birthday: string | null;
	periods: EmploymentPeriodSnapshot[];
	employeeEngagementKind?: "contractor" | "employee";
}) {
	return minorContractorEngagementFindings({
		organizationId: "org",
		employeeId: "e1",
		birthday: input.birthday ? parsePlainDate(input.birthday) : null,
		employeeEngagementKind: input.employeeEngagementKind ?? "employee",
		periods: input.periods,
		timezone,
		window,
	});
}

describe("minorContractorEngagementFindings (#2022)", () => {
	it("raises one acknowledgeable warning per contractor engagement of a minor", () => {
		const findings = judge({
			birthday: "2010-06-01",
			periods: [
				stint("p1", "contractor", "2026-01-01", "2026-03-10"),
				stint("p2", "employee", "2026-03-10", "2026-04-01"),
				stint("p3", "contractor", "2026-04-01", null),
			],
		});

		expect(findings).toHaveLength(2);
		expect(findings[0]).toMatchObject({
			id: "jarbschg_minor_contractor:e1:engagement:p1",
			organizationId: "org",
			employeeId: "e1",
			domain: "youth_protection",
			kind: "jarbschg_minor_contractor",
			severity: "warning",
			subjectKey: "engagement:p1",
			periodStart: "2026-01-01",
			periodEnd: "2026-03-10",
			legalReference: "§ 1 Abs. 1 Nr. 3 JArbSchG",
			acknowledgementKind: "jarbschg_minor_contractor_review",
			blocksPublication: false,
		});
		// An open-ended engagement shows the window's end, and says it is open-ended.
		expect(findings[1]).toMatchObject({
			subjectKey: "engagement:p3",
			periodStart: "2026-04-01",
			periodEnd: "2026-05-01",
			adminDetail: { facts: { openEnded: true } },
		});
	});

	it("raises nothing for an adult contractor, a minor employee or an unknown birthday", () => {
		const contractor = [stint("p1", "contractor", "2026-01-01", null)];
		expect(judge({ birthday: "2000-01-01", periods: contractor })).toEqual([]);
		expect(judge({ birthday: null, periods: contractor })).toEqual([]);
		expect(
			judge({ birthday: "2010-06-01", periods: [stint("p1", "employee", "2026-01-01", null)] }),
		).toEqual([]);
	});

	it("raises it when the contractor is under 18 on any day of the engagement in the window", () => {
		// Turns 18 on 2026-03-15: a minor on the window's first days of the engagement.
		expect(
			judge({ birthday: "2008-03-15", periods: [stint("p1", "contractor", "2025-01-01", null)] }),
		).toHaveLength(1);
		// An engagement that starts after the 18th birthday is an adult's.
		expect(
			judge({ birthday: "2008-03-15", periods: [stint("p1", "contractor", "2026-03-15", null)] }),
		).toEqual([]);
		// An engagement that ended before the window is not judged.
		expect(
			judge({
				birthday: "2010-06-01",
				periods: [stint("p1", "contractor", "2025-01-01", "2026-03-01")],
			}),
		).toEqual([]);
		// One ending on the window's first day still has that day.
		expect(
			judge({
				birthday: "2010-06-01",
				periods: [stint("p1", "contractor", "2025-01-01", "2026-03-02")],
			}),
		).toHaveLength(1);
	});

	it("treats an employee with no recorded stint by their engagement kind", () => {
		const [finding] = judge({
			birthday: "2010-06-01",
			periods: [],
			employeeEngagementKind: "contractor",
		});
		expect(finding).toMatchObject({ subjectKey: "engagement:employee", periodEnd: "2026-05-01" });
		expect(judge({ birthday: "2010-06-01", periods: [] })).toEqual([]);
	});

	it("fingerprints the engagement period and the birthday, not the window", () => {
		const base = judge({
			birthday: "2010-06-01",
			periods: [stint("p1", "contractor", "2026-01-01", null)],
		})[0];
		const fingerprintOf = (birthday: string, period: EmploymentPeriodSnapshot) =>
			judge({ birthday, periods: [period] })[0]?.inputFingerprint;

		expect(fingerprintOf("2010-06-01", stint("p1", "contractor", "2026-01-01", null))).toBe(
			base.inputFingerprint,
		);
		expect(
			minorContractorEngagementFindings({
				organizationId: "org",
				employeeId: "e1",
				birthday: parsePlainDate("2010-06-01"),
				employeeEngagementKind: "employee",
				periods: [stint("p1", "contractor", "2026-01-01", null)],
				timezone,
				window: { start: "2026-03-02", endExclusive: "2026-05-02" },
			})[0]?.inputFingerprint,
		).toBe(base.inputFingerprint);
		expect(fingerprintOf("2010-07-01", stint("p1", "contractor", "2026-01-01", null))).not.toBe(
			base.inputFingerprint,
		);
		expect(
			fingerprintOf("2010-06-01", stint("p1", "contractor", "2026-01-01", "2026-06-01")),
		).not.toBe(base.inputFingerprint);
		expect(fingerprintOf("2010-06-01", stint("p1", "contractor", "2026-02-01", null))).not.toBe(
			base.inputFingerprint,
		);
	});
});
