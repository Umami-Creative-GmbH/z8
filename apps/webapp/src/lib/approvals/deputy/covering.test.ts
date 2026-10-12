import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { type CoverAbsenceFacts, type CoverFacts, resolveCovers } from "./covering";

const X = "approver-x";
const Y = "deputy-y";

function absence(overrides: Partial<CoverAbsenceFacts> = {}): CoverAbsenceFacts {
	return {
		id: "absence-1",
		employeeId: X,
		deputyEmployeeId: Y,
		startDate: "2026-06-03",
		endDate: "2026-06-05",
		startPeriod: "full_day",
		endPeriod: "full_day",
		status: "approved",
		countsAsWorkingTime: false,
		approvedAt: null,
		deputyAssignedAt: null,
		...overrides,
	};
}

// X works in Berlin; at 10:00Z on 4 June it is 4 June there.
function facts(overrides: Partial<CoverFacts> = {}): CoverFacts {
	return {
		deputyDecisionsEnabled: true,
		at: parseInstant("2026-06-04T10:00:00Z"),
		organizationTimezone: "Europe/Berlin",
		deputy: { employeeId: Y, active: true, canUseApprovalInbox: true },
		approvers: [{ employeeId: X, userTimezone: null }],
		absences: [absence()],
		...overrides,
	};
}

describe("resolveCovers: whom the deputy covers for at an instant", () => {
	it("covers the approver during an approved absence that names the deputy", () => {
		expect(resolveCovers(facts())).toEqual([
			{ approverId: X, absenceId: "absence-1", day: "2026-06-04", absenceEndDate: "2026-06-05" },
		]);
	});

	it("does not cover for a pending or rejected absence", () => {
		expect(resolveCovers(facts({ absences: [absence({ status: "pending" })] }))).toEqual([]);
		expect(resolveCovers(facts({ absences: [absence({ status: "rejected" })] }))).toEqual([]);
	});

	it("does not cover for an absence in a category that counts as working time", () => {
		expect(resolveCovers(facts({ absences: [absence({ countsAsWorkingTime: true })] }))).toEqual(
			[],
		);
	});

	it("covers for nobody while the organization has deputy decisions turned off", () => {
		expect(resolveCovers(facts({ deputyDecisionsEnabled: false }))).toEqual([]);
	});

	it("covers for nobody when the deputy cannot use the approval inbox (a contact only)", () => {
		expect(
			resolveCovers(facts({ deputy: { employeeId: Y, active: true, canUseApprovalInbox: false } })),
		).toEqual([]);
	});

	it("covers for nobody when the deputy is no longer active in the organization", () => {
		expect(
			resolveCovers(facts({ deputy: { employeeId: Y, active: false, canUseApprovalInbox: true } })),
		).toEqual([]);
	});

	it("counts a half-day first or last day as a whole covered day", () => {
		const halfDays = absence({ startPeriod: "pm", endPeriod: "am" });
		// 05:00 Berlin on the first day, before the afternoon half starts.
		expect(
			resolveCovers(facts({ at: parseInstant("2026-06-03T03:00:00Z"), absences: [halfDays] })),
		).toMatchObject([{ approverId: X, day: "2026-06-03" }]);
		// 21:00 Berlin on the last day, after the morning half ended.
		expect(
			resolveCovers(facts({ at: parseInstant("2026-06-05T19:00:00Z"), absences: [halfDays] })),
		).toMatchObject([{ approverId: X, day: "2026-06-05" }]);
	});

	it("ends covering after the absence's last day, with no grace period", () => {
		// 00:00 Berlin on 6 June.
		expect(resolveCovers(facts({ at: parseInstant("2026-06-05T22:00:00Z") }))).toEqual([]);
		// One millisecond earlier it is still 5 June in Berlin.
		expect(resolveCovers(facts({ at: parseInstant("2026-06-05T21:59:59.999Z") }))).toMatchObject([
			{ day: "2026-06-05" },
		]);
	});

	it("starts covering once an absence that already started is approved", () => {
		const running = absence({ startDate: "2026-06-01", endDate: "2026-06-05" });
		expect(resolveCovers(facts({ absences: [{ ...running, status: "pending" }] }))).toEqual([]);
		expect(resolveCovers(facts({ absences: [running] }))).toMatchObject([{ approverId: X }]);
	});

	it("covers an earlier instant of the absence only from when it was approved", () => {
		const approvedLate = absence({
			startDate: "2026-06-01",
			approvedAt: parseInstant("2026-06-04T09:00:00Z"),
		});
		expect(
			resolveCovers(facts({ at: parseInstant("2026-06-02T10:00:00Z"), absences: [approvedLate] })),
		).toEqual([]);
		expect(
			resolveCovers(facts({ at: parseInstant("2026-06-04T09:00:00Z"), absences: [approvedLate] })),
		).toMatchObject([{ approverId: X }]);
	});

	it("covers an earlier instant of the absence only from when this deputy was named", () => {
		const namedLate = absence({
			startDate: "2026-06-01",
			deputyAssignedAt: parseInstant("2026-06-03T12:00:00Z"),
		});
		expect(
			resolveCovers(facts({ at: parseInstant("2026-06-03T11:59:59Z"), absences: [namedLate] })),
		).toEqual([]);
		expect(
			resolveCovers(facts({ at: parseInstant("2026-06-03T12:00:00Z"), absences: [namedLate] })),
		).toMatchObject([{ approverId: X }]);
	});

	it("follows the deputy of each day across consecutive absences", () => {
		const first = absence({ id: "first", startDate: "2026-06-01", endDate: "2026-06-03" });
		const second = absence({
			id: "second",
			startDate: "2026-06-04",
			endDate: "2026-06-05",
			deputyEmployeeId: "deputy-y2",
		});
		const thirdJune = parseInstant("2026-06-03T10:00:00Z");
		const fourthJune = parseInstant("2026-06-04T10:00:00Z");
		const y2 = { employeeId: "deputy-y2", active: true, canUseApprovalInbox: true };

		expect(resolveCovers(facts({ at: thirdJune, absences: [first, second] }))).toMatchObject([
			{ absenceId: "first" },
		]);
		expect(resolveCovers(facts({ at: fourthJune, absences: [first, second] }))).toEqual([]);
		expect(resolveCovers(facts({ at: thirdJune, deputy: y2, absences: [first, second] }))).toEqual(
			[],
		);
		expect(
			resolveCovers(facts({ at: fourthJune, deputy: y2, absences: [first, second] })),
		).toMatchObject([{ approverId: X, absenceId: "second" }]);
	});

	it("never chains: the deputy's own deputy covers only for the deputy", () => {
		const zed = { employeeId: "deputy-z", active: true, canUseApprovalInbox: true };
		const yAway = absence({ id: "y-away", employeeId: Y, deputyEmployeeId: "deputy-z" });
		const approvers = [
			{ employeeId: X, userTimezone: null },
			{ employeeId: Y, userTimezone: null },
		];

		expect(resolveCovers(facts({ deputy: zed, approvers, absences: [absence(), yAway] }))).toEqual([
			{ approverId: Y, absenceId: "y-away", day: "2026-06-04", absenceEndDate: "2026-06-05" },
		]);
		// Y being away does not stop Y covering for X.
		expect(resolveCovers(facts({ approvers, absences: [absence(), yAway] }))).toEqual([
			{ approverId: X, absenceId: "absence-1", day: "2026-06-04", absenceEndDate: "2026-06-05" },
		]);
	});

	it("returns every approver the deputy covers for at the instant, once each, and only those", () => {
		const approvers = ["x1", "x2", "x3", "x4"].map((employeeId) => ({
			employeeId,
			userTimezone: null,
		}));
		const absences = [
			absence({ id: "x1-a", employeeId: "x1", endDate: "2026-06-04" }),
			// A second absence of x1 that overlaps the first and also names Y.
			absence({ id: "x1-b", employeeId: "x1", startDate: "2026-06-04", endDate: "2026-06-10" }),
			absence({ id: "x2-a", employeeId: "x2" }),
			absence({ id: "x3-a", employeeId: "x3", deputyEmployeeId: "someone-else" }),
			absence({ id: "x4-a", employeeId: "x4", startDate: "2026-06-05" }),
		];

		expect(resolveCovers(facts({ approvers, absences }))).toEqual([
			// Of overlapping covering absences, the one that ends last.
			{ approverId: "x1", absenceId: "x1-b", day: "2026-06-04", absenceEndDate: "2026-06-10" },
			{ approverId: "x2", absenceId: "x2-a", day: "2026-06-04", absenceEndDate: "2026-06-05" },
		]);
	});

	describe("local days follow the approver's effective timezone", () => {
		// 2026-06-05T05:00Z is 4 June in Los Angeles but 5 June in Berlin and in UTC.
		const at = parseInstant("2026-06-05T05:00:00Z");
		const onlyFifth = absence({ startDate: "2026-06-05", endDate: "2026-06-05" });
		const onlyFourth = absence({ startDate: "2026-06-04", endDate: "2026-06-04" });

		it("uses the approver's own timezone over the organization's", () => {
			const losAngeles = [{ employeeId: X, userTimezone: "America/Los_Angeles" }];
			expect(resolveCovers(facts({ at, approvers: losAngeles, absences: [onlyFifth] }))).toEqual(
				[],
			);
			expect(
				resolveCovers(facts({ at, approvers: losAngeles, absences: [onlyFourth] })),
			).toMatchObject([{ day: "2026-06-04" }]);
		});

		it("falls back to the organization's timezone, then UTC", () => {
			const losAngelesOrg = facts({ at, organizationTimezone: "America/Los_Angeles" });
			expect(resolveCovers({ ...losAngelesOrg, absences: [onlyFourth] })).toMatchObject([
				{ day: "2026-06-04" },
			]);
			const noZones = facts({ at, organizationTimezone: null, absences: [onlyFifth] });
			expect(resolveCovers(noZones)).toMatchObject([{ day: "2026-06-05" }]);
		});
	});
});
