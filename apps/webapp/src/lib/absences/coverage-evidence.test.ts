import { describe, expect, it } from "vitest";
import {
	type CoverageRuleEvidence,
	type CoverageShiftEvidence,
	evaluateAbsenceCoverage,
	findAffectedShifts,
} from "./coverage-evidence";

const TZ = "Europe/Berlin";
const REQUESTER = "emp-requester";

// 2026-05-04 is a Monday, 2026-05-05 a Tuesday.
const fullDay = {
	categoryId: "cat",
	startDate: "2026-05-04",
	startPeriod: "full_day" as const,
	endDate: "2026-05-04",
	endPeriod: "full_day" as const,
};

function partial(startDate: string, startTime: string, endDate: string, endTime: string) {
	return {
		categoryId: "cat",
		startDate,
		startPeriod: "am" as const,
		endDate,
		endPeriod: "am" as const,
		durationKind: "partial_day" as const,
		startTime,
		endTime,
	};
}

function shift(
	overrides: Partial<CoverageShiftEvidence> & Pick<CoverageShiftEvidence, "id">,
): CoverageShiftEvidence {
	return {
		employeeId: REQUESTER,
		subareaId: "front",
		subareaName: "Front desk",
		date: "2026-05-04",
		startTime: "09:00",
		endTime: "17:00",
		...overrides,
	};
}

function rule(overrides: Partial<CoverageRuleEvidence> = {}): CoverageRuleEvidence {
	return {
		subareaId: "front",
		subareaName: "Front desk",
		dayOfWeek: "monday",
		startTime: "09:00",
		endTime: "17:00",
		minimumStaffCount: 2,
		...overrides,
	};
}

function evaluate(input: {
	request?: Parameters<typeof evaluateAbsenceCoverage>[0]["request"];
	requesterShifts: CoverageShiftEvidence[];
	colleagueShifts?: CoverageShiftEvidence[];
	rules?: CoverageRuleEvidence[];
	timezone?: string;
}) {
	return evaluateAbsenceCoverage({
		timezone: input.timezone ?? TZ,
		request: input.request ?? fullDay,
		requesterEmployeeId: REQUESTER,
		requesterShifts: input.requesterShifts,
		publishedShifts: [...input.requesterShifts, ...(input.colleagueShifts ?? [])],
		rules: input.rules ?? [rule()],
	});
}

describe("evaluateAbsenceCoverage", () => {
	it("warns when a full-day absence drops published staffing below the rule minimum", () => {
		const result = evaluate({
			requesterShifts: [shift({ id: "own" })],
			colleagueShifts: [shift({ id: "peer", employeeId: "emp-peer" })],
		});

		expect(result.coverage).toEqual({
			status: "complete",
			gaps: [],
			risks: [
				{
					date: "2026-05-04",
					subareaId: "front",
					subareaName: "Front desk",
					startTime: "09:00",
					endTime: "17:00",
					minimumStaffCount: 2,
					staffCountAfterAbsence: 1,
				},
			],
		});
		expect(result.affectedShifts).toEqual([
			{
				id: "own",
				subareaId: "front",
				subareaName: "Front desk",
				date: "2026-05-04",
				startTime: "09:00",
				endTime: "17:00",
				affectedStartTime: "09:00",
				affectedEndTime: "17:00",
			},
		]);
	});

	it("keeps the requester in staffing outside a same-day partial absence", () => {
		const result = evaluate({
			request: partial("2026-05-04", "09:00", "2026-05-04", "13:00"),
			requesterShifts: [shift({ id: "own", startTime: "09:00", endTime: "17:00" })],
			colleagueShifts: [shift({ id: "peer", employeeId: "emp-peer" })],
		});

		expect(result.affectedShifts).toEqual([
			expect.objectContaining({ id: "own", affectedStartTime: "09:00", affectedEndTime: "13:00" }),
		]);
		expect(result.coverage.risks).toEqual([
			expect.objectContaining({ startTime: "09:00", endTime: "13:00", staffCountAfterAbsence: 1 }),
		]);
		expect(result.coverage.status).toBe("complete");
	});

	it("does not affect a shift outside a partial absence on the same day", () => {
		const result = evaluate({
			request: partial("2026-05-04", "07:00", "2026-05-04", "09:00"),
			requesterShifts: [shift({ id: "own", startTime: "09:00", endTime: "17:00" })],
		});

		expect(result.affectedShifts).toEqual([]);
		expect(result.coverage).toEqual({ status: "complete", gaps: [], risks: [] });
	});

	it("affects an overnight shift from the previous date that runs into a full-day absence", () => {
		// Sunday 22:00 to Monday 06:00; a Monday rule covers 00:00-06:00.
		const result = evaluate({
			requesterShifts: [
				shift({ id: "night", date: "2026-05-03", startTime: "22:00", endTime: "06:00" }),
			],
			colleagueShifts: [
				shift({
					id: "peer-night",
					employeeId: "emp-peer",
					date: "2026-05-03",
					startTime: "22:00",
					endTime: "04:00",
				}),
			],
			rules: [rule({ startTime: "00:00", endTime: "06:00", minimumStaffCount: 1 })],
		});

		expect(result.affectedShifts).toEqual([
			expect.objectContaining({
				id: "night",
				date: "2026-05-03",
				affectedStartTime: "00:00",
				affectedEndTime: "06:00",
			}),
		]);
		expect(result.coverage).toEqual({
			status: "complete",
			gaps: [],
			risks: [
				expect.objectContaining({
					date: "2026-05-04",
					startTime: "04:00",
					endTime: "06:00",
					minimumStaffCount: 1,
					staffCountAfterAbsence: 0,
				}),
			],
		});
	});

	it("evaluates an overnight partial absence across both dates' rules", () => {
		// Monday 20:00 to Tuesday 02:00 on a Monday 18:00-02:00 shift.
		const result = evaluate({
			request: partial("2026-05-04", "20:00", "2026-05-05", "02:00"),
			requesterShifts: [shift({ id: "late", startTime: "18:00", endTime: "02:00" })],
			colleagueShifts: [
				shift({ id: "peer", employeeId: "emp-peer", startTime: "18:00", endTime: "23:00" }),
			],
			rules: [
				rule({ startTime: "18:00", endTime: "23:59", minimumStaffCount: 1 }),
				rule({ dayOfWeek: "tuesday", startTime: "00:00", endTime: "02:00", minimumStaffCount: 1 }),
			],
		});

		expect(result.affectedShifts).toEqual([
			expect.objectContaining({ affectedStartTime: "20:00", affectedEndTime: "02:00" }),
		]);
		// The Monday rule ending 23:59 runs to midnight, so the rules cover the night without a gap
		// and the equal understaffing on both sides of midnight is one interval.
		expect(result.coverage).toEqual({
			status: "complete",
			gaps: [],
			risks: [
				expect.objectContaining({
					date: "2026-05-04",
					startTime: "23:00",
					endTime: "02:00",
					staffCountAfterAbsence: 0,
				}),
			],
		});
	});

	it("reports each change of staffing inside a shift separately", () => {
		const result = evaluate({
			requesterShifts: [shift({ id: "own" })],
			colleagueShifts: [
				shift({ id: "a", employeeId: "emp-a", startTime: "09:00", endTime: "17:00" }),
				shift({ id: "b", employeeId: "emp-b", startTime: "09:00", endTime: "11:00" }),
			],
			rules: [rule({ minimumStaffCount: 3 })],
		});

		expect(result.coverage.risks).toEqual([
			expect.objectContaining({ startTime: "09:00", endTime: "11:00", staffCountAfterAbsence: 2 }),
			expect.objectContaining({ startTime: "11:00", endTime: "17:00", staffCountAfterAbsence: 1 }),
		]);
	});

	it("checks overlapping rules against their highest minimum", () => {
		const result = evaluate({
			requesterShifts: [shift({ id: "own" })],
			colleagueShifts: [shift({ id: "a", employeeId: "emp-a" })],
			rules: [
				rule({ minimumStaffCount: 1 }),
				rule({ startTime: "12:00", endTime: "14:00", minimumStaffCount: 2 }),
			],
		});

		expect(result.coverage.risks).toEqual([
			expect.objectContaining({
				startTime: "12:00",
				endTime: "14:00",
				minimumStaffCount: 2,
				staffCountAfterAbsence: 1,
			}),
		]);
	});

	it("counts distinct colleagues in the same subarea only, ignoring open shifts", () => {
		const result = evaluate({
			requesterShifts: [shift({ id: "own" })],
			colleagueShifts: [
				shift({ id: "a1", employeeId: "emp-a", startTime: "09:00", endTime: "13:00" }),
				shift({ id: "a2", employeeId: "emp-a", startTime: "13:00", endTime: "17:00" }),
				shift({ id: "open", employeeId: null }),
				shift({ id: "elsewhere", employeeId: "emp-b", subareaId: "kitchen" }),
			],
		});

		expect(result.coverage.risks).toEqual([
			expect.objectContaining({ startTime: "09:00", endTime: "17:00", staffCountAfterAbsence: 1 }),
		]);
	});

	it("marks affected work without any applicable rule as incomplete", () => {
		const result = evaluate({
			requesterShifts: [shift({ id: "own" })],
			rules: [rule({ dayOfWeek: "tuesday" }), rule({ subareaId: "kitchen" })],
		});

		expect(result.coverage).toEqual({ status: "incomplete", gaps: ["rules_missing"], risks: [] });
	});

	it("keeps known warnings when rules cover only part of the affected work", () => {
		const result = evaluate({
			requesterShifts: [shift({ id: "own", startTime: "08:00", endTime: "18:00" })],
			rules: [rule({ minimumStaffCount: 1 })],
		});

		expect(result.coverage).toEqual({
			status: "incomplete",
			gaps: ["rules_partial"],
			risks: [expect.objectContaining({ startTime: "09:00", endTime: "17:00" })],
		});
	});

	it("marks shifts with unreadable times as unsupported evidence", () => {
		const result = evaluate({
			requesterShifts: [shift({ id: "own" }), shift({ id: "broken", startTime: "9 am" })],
			colleagueShifts: [shift({ id: "peer", employeeId: "emp-peer" })],
		});

		expect(result.coverage.status).toBe("incomplete");
		expect(result.coverage.gaps).toEqual(["unsupported"]);
		expect(result.coverage.risks).toHaveLength(1);
	});

	it("marks an invalid partial-day request as unsupported", () => {
		const result = evaluate({
			request: partial("2026-05-04", "13:00", "2026-05-04", "09:00"),
			requesterShifts: [shift({ id: "own" })],
		});

		expect(result.affectedShifts).toEqual([]);
		expect(result.coverage).toEqual({ status: "incomplete", gaps: ["unsupported"], risks: [] });
	});

	it("reads legacy half-day periods as noon boundaries", () => {
		const result = evaluate({
			request: { ...fullDay, startPeriod: "pm", endPeriod: "pm" },
			requesterShifts: [shift({ id: "own" })],
			colleagueShifts: [shift({ id: "peer", employeeId: "emp-peer" })],
		});

		expect(result.affectedShifts).toEqual([
			expect.objectContaining({ affectedStartTime: "12:00", affectedEndTime: "17:00" }),
		]);
		expect(result.coverage.risks).toEqual([
			expect.objectContaining({ startTime: "12:00", endTime: "17:00" }),
		]);
	});

	it("judges wall-clock times in the organization's zone", () => {
		const newYork = evaluate({
			timezone: "America/New_York",
			request: partial("2026-05-04", "09:00", "2026-05-04", "10:00"),
			requesterShifts: [shift({ id: "own" })],
		});

		expect(newYork.affectedShifts).toEqual([
			expect.objectContaining({ affectedStartTime: "09:00", affectedEndTime: "10:00" }),
		]);
		expect(newYork.coverage.risks).toEqual([
			expect.objectContaining({ date: "2026-05-04", startTime: "09:00", endTime: "10:00" }),
		]);
	});

	it("exposes no colleague identities", () => {
		const result = evaluate({
			requesterShifts: [shift({ id: "own" })],
			colleagueShifts: [shift({ id: "peer-shift", employeeId: "emp-peer" })],
		});

		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("emp-peer");
		expect(serialized).not.toContain("peer-shift");
		expect(serialized).not.toContain(REQUESTER);
	});
});

describe("findAffectedShifts", () => {
	it("finds only the requester's shifts the absence overlaps, including the night before", () => {
		const { affected, unsupported } = findAffectedShifts({
			timezone: TZ,
			request: fullDay,
			requesterShifts: [
				shift({ id: "before", date: "2026-05-03", startTime: "08:00", endTime: "16:00" }),
				shift({ id: "night", date: "2026-05-03", startTime: "22:00", endTime: "02:00" }),
				shift({ id: "day" }),
			],
		});

		expect(affected.map((item) => item.id)).toEqual(["night", "day"]);
		expect(unsupported).toBe(false);
	});
});

describe("evaluateAbsenceCoverage at midnight", () => {
	// Rule times stop at 23:59; such a rule runs to the end of its day.
	it("treats a rule ending at 23:59 as covering a shift that ends at midnight", () => {
		const result = evaluate({
			requesterShifts: [shift({ id: "own", startTime: "16:00", endTime: "00:00" })],
			colleagueShifts: [
				shift({ id: "peer", employeeId: "emp-peer", startTime: "16:00", endTime: "00:00" }),
			],
			rules: [rule({ startTime: "16:00", endTime: "23:59", minimumStaffCount: 1 })],
		});

		expect(result.coverage).toEqual({ status: "complete", gaps: [], risks: [] });
	});

	it("covers an overnight shift with rules for each side of midnight", () => {
		const result = evaluate({
			request: { ...fullDay, endDate: "2026-05-05" },
			requesterShifts: [shift({ id: "own", startTime: "22:00", endTime: "06:00" })],
			colleagueShifts: [
				shift({ id: "peer", employeeId: "emp-peer", startTime: "22:00", endTime: "06:00" }),
			],
			rules: [
				rule({ startTime: "22:00", endTime: "23:59", minimumStaffCount: 1 }),
				rule({ dayOfWeek: "tuesday", startTime: "00:00", endTime: "06:00", minimumStaffCount: 1 }),
			],
		});

		expect(result.coverage).toEqual({ status: "complete", gaps: [], risks: [] });
	});

	it("reports understaffing up to midnight under a rule ending at 23:59", () => {
		const result = evaluate({
			requesterShifts: [shift({ id: "own", startTime: "16:00", endTime: "00:00" })],
			rules: [rule({ startTime: "16:00", endTime: "23:59", minimumStaffCount: 1 })],
		});

		expect(result.coverage.status).toBe("complete");
		expect(result.coverage.risks).toEqual([
			expect.objectContaining({ startTime: "16:00", endTime: "00:00", staffCountAfterAbsence: 0 }),
		]);
	});
});
