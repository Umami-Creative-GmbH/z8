import { describe, expect, it } from "vitest";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { resolveVacationAllowance } from "./prorated-allowance";
import type { EmployeeVacationPolicyPeriod } from "./vacation-policy-history";
import type { VacationPolicy } from "./vacation-policy-store";
import { resolveWeightedVacationPolicy } from "./weighted-vacation-policy";

const policy = (days: string, minimum = "20"): VacationPolicy => ({
	id: days,
	organizationId: "org",
	name: days,
	startDate: "2026-01-01",
	validUntil: null,
	isCompanyDefault: false,
	isActive: true,
	defaultAnnualDays: days,
	statutoryMinimumDays: minimum,
	accrualType: "annual",
	accrualStartMonth: 1,
	allowCarryover: false,
	maxCarryoverDays: null,
	carryoverExpiryMonths: null,
	prorateInStartAndExitYear: true,
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
	createdBy: "actor",
});
const period = (
	startDate: string,
	endDate: string,
	days: string,
	minimum = "20",
): EmployeeVacationPolicyPeriod => ({
	startDate,
	endDate,
	resolution: {
		status: "resolved",
		source: "employee",
		policy: policy(days, minimum),
	},
});
const weighted = (periods: EmployeeVacationPolicyPeriod[], year = 2027) =>
	resolveWeightedVacationPolicy(periods, { year });
describe("weighted employee vacation policy", () => {
	it("combines January to June at 30 and July to December at 24 into 27 days", () => {
		expect(
			weighted([
				period("2027-01-01", "2027-06-30", "30"),
				period("2027-07-01", "2027-12-31", "24"),
			]),
		).toMatchObject({
			policy: { defaultAnnualDays: "27.00", statutoryMinimumDays: "20.00" },
			configuration: { status: "resolved" },
		});
	});
	it("uses actual leap February days and rounds only the combined allowance", () => {
		expect(
			weighted(
				[
					period("2028-01-01", "2028-02-14", "30"),
					period("2028-02-15", "2028-12-31", "24"),
				],
				2028,
			),
		).toMatchObject({ policy: { defaultAnnualDays: "24.74" } });
	});
	it("does not let a partial policy coverage invent an allowance", () => {
		expect(
			weighted([
				period("2027-01-01", "2027-06-30", "30"),
				period("2027-08-01", "2027-12-31", "24"),
			]),
		).toEqual({
			configuration: {
				status: "missing",
				periods: [{ startDate: "2027-07-01", endDate: "2027-07-31" }],
			},
		});
	});
	it("keeps team conflicts explicit rather than selecting a policy", () => {
		expect(
			weighted([
				{
					startDate: "2027-01-01",
					endDate: "2027-12-31",
					resolution: { status: "conflict", policyIds: ["a", "b"] },
				},
			]),
		).toEqual({
			configuration: {
				status: "conflict",
				periods: [
					{
						startDate: "2027-01-01",
						endDate: "2027-12-31",
						policyIds: ["a", "b"],
						reason: undefined,
					},
				],
			},
		});
	});
	it("is independent of the viewer timezone", () => {
		const previous = process.env.TZ;
		try {
			for (const zone of [
				"Pacific/Honolulu",
				"Pacific/Kiritimati",
				"Europe/Berlin",
			]) {
				process.env.TZ = zone;
				expect(
					weighted([
						period("2027-01-01", "2027-01-15", "30"),
						period("2027-01-16", "2027-12-31", "24"),
					]),
				).toMatchObject({ policy: { defaultAnnualDays: "24.24" } });
			}
		} finally {
			if (previous === undefined) delete process.env.TZ;
			else process.env.TZ = previous;
		}
	});
	it("weights the statutory floor before applying the unchanged employment waiting clock", () => {
		const { policy: combined } = weighted([
			period("2027-01-01", "2027-06-30", "30", "20"),
			period("2027-07-01", "2027-12-31", "24", "16"),
		]);
		if (!combined) throw new Error("Expected covered policy");
		expect(
			resolveVacationAllowance({
				policy: combined,
				employments: [
					{
						startDate: parsePlainDate("2027-02-01"),
						lastWorkingDay: parsePlainDate("2027-08-31"),
					},
				],
				year: 2027,
			}),
		).toMatchObject({
			fullAllowance: 27,
			days: 18,
			reason: {
				kind: "prorated",
				employments: [{ employmentMonths: 7, floorApplied: true }],
			},
		});
		expect(
			resolveVacationAllowance({
				policy: combined,
				customAnnualDays: "12.34",
				employments: [
					{ startDate: parsePlainDate("2027-10-01"), lastWorkingDay: null },
				],
				year: 2027,
			}),
		).toMatchObject({
			fullAllowance: 12.34,
			days: 12.34,
			reason: { kind: "none", cause: "custom_allowance" },
		});
		expect(
			resolveVacationAllowance({
				policy: combined,
				employments: [{ startDate: null, lastWorkingDay: null }],
				year: 2027,
			}),
		).toMatchObject({
			days: 27,
			reason: { kind: "none", cause: "no_known_start" },
		});
	});
});
