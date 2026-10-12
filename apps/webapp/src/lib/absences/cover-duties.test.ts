import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { buildCoverDuties, type CoverDutyAbsence } from "./cover-duties";

// 11:30 UTC: already 11 Oct in Kiritimati (UTC+14), still 10 Oct in Los Angeles (UTC-7).
const NOW = Temporal.Instant.from("2026-10-10T11:30:00Z");

function absence(overrides: Partial<CoverDutyAbsence> = {}): CoverDutyAbsence {
	return {
		absenceId: "absence-1",
		absentEmployeeId: "employee-anna",
		absentEmployeeName: "Anna Example",
		absentEmployeeTimezone: null,
		startDate: "2026-10-09",
		endDate: "2026-10-12",
		status: "approved",
		category: { name: "Vacation", color: "#00ff00" },
		...overrides,
	};
}

const employeeViewer = { role: "employee" as const, managedEmployeeIds: new Set<string>() };

describe("buildCoverDuties", () => {
	it("lists an approved absence running today as running, with its end date", () => {
		const duties = buildCoverDuties({
			absences: [absence()],
			viewer: employeeViewer,
			organizationTimezone: "UTC",
			now: NOW,
		});

		expect(duties.running).toEqual([
			{
				absenceId: "absence-1",
				employeeId: "employee-anna",
				employeeName: "Anna Example",
				startDate: "2026-10-09",
				endDate: "2026-10-12",
				category: null,
			},
		]);
		expect(duties.upcoming).toEqual([]);
	});

	it("decides running by the absent employee's own timezone, not the organization's", () => {
		const endsToday = absence({
			absenceId: "ends-10th",
			startDate: "2026-10-08",
			endDate: "2026-10-10",
		});
		const startsTomorrow = absence({
			absenceId: "starts-11th",
			startDate: "2026-10-11",
			endDate: "2026-10-13",
		});

		const inKiritimati = buildCoverDuties({
			absences: [
				{ ...endsToday, absentEmployeeTimezone: "Pacific/Kiritimati" },
				{ ...startsTomorrow, absentEmployeeTimezone: "Pacific/Kiritimati" },
			],
			viewer: employeeViewer,
			organizationTimezone: "America/Los_Angeles",
			now: NOW,
		});
		// It is already 11 Oct there: the first absence is over, the second has begun.
		expect(inKiritimati.running.map((duty) => duty.absenceId)).toEqual(["starts-11th"]);
		expect(inKiritimati.upcoming).toEqual([]);

		const inLosAngeles = buildCoverDuties({
			absences: [
				{ ...endsToday, absentEmployeeTimezone: "America/Los_Angeles" },
				{ ...startsTomorrow, absentEmployeeTimezone: "America/Los_Angeles" },
			],
			viewer: employeeViewer,
			organizationTimezone: "Pacific/Kiritimati",
			now: NOW,
		});
		// Still 10 Oct there: the first absence runs until tonight, the second starts tomorrow.
		expect(inLosAngeles.running.map((duty) => duty.absenceId)).toEqual(["ends-10th"]);
		expect(inLosAngeles.upcoming.map((duty) => duty.absenceId)).toEqual(["starts-11th"]);
	});

	it("falls back to the organization's timezone when the absent employee has none", () => {
		const duties = buildCoverDuties({
			absences: [absence({ startDate: "2026-10-11", endDate: "2026-10-11" })],
			viewer: employeeViewer,
			organizationTimezone: "Pacific/Kiritimati",
			now: NOW,
		});

		expect(duties.running.map((duty) => duty.absenceId)).toEqual(["absence-1"]);
	});

	it("lists absences starting within the next 14 days as upcoming, and none later", () => {
		const duties = buildCoverDuties({
			absences: [
				absence({ absenceId: "in-14-days", startDate: "2026-10-24", endDate: "2026-10-30" }),
				absence({ absenceId: "in-15-days", startDate: "2026-10-25", endDate: "2026-10-30" }),
				absence({ absenceId: "in-2-days", startDate: "2026-10-12", endDate: "2026-10-12" }),
			],
			viewer: employeeViewer,
			organizationTimezone: "UTC",
			now: NOW,
		});

		expect(duties.running).toEqual([]);
		expect(duties.upcoming.map((duty) => duty.absenceId)).toEqual(["in-2-days", "in-14-days"]);
	});

	it("shows only approved absences, never pending or rejected ones or ended ones", () => {
		const duties = buildCoverDuties({
			absences: [
				absence({ absenceId: "pending", status: "pending" }),
				absence({ absenceId: "rejected", status: "rejected" }),
				absence({ absenceId: "ended", startDate: "2026-10-01", endDate: "2026-10-09" }),
			],
			viewer: employeeViewer,
			organizationTimezone: "UTC",
			now: NOW,
		});

		expect(duties).toEqual({ running: [], upcoming: [] });
	});

	it("shows the category only to an admin or a manager of the absent employee", () => {
		const input = { absences: [absence()], organizationTimezone: "UTC", now: NOW };
		const category = (viewer: Parameters<typeof buildCoverDuties>[0]["viewer"]) =>
			buildCoverDuties({ ...input, viewer }).running[0]?.category;

		expect(category(employeeViewer)).toBeNull();
		expect(
			category({ role: "manager", managedEmployeeIds: new Set(["employee-other"]) }),
		).toBeNull();
		expect(
			category({ role: "employee", managedEmployeeIds: new Set(["employee-anna"]) }),
		).toBeNull();
		expect(category({ role: "manager", managedEmployeeIds: new Set(["employee-anna"]) })).toEqual({
			name: "Vacation",
			color: "#00ff00",
		});
		expect(category({ role: "admin", managedEmployeeIds: new Set() })).toEqual({
			name: "Vacation",
			color: "#00ff00",
		});
	});

	it("never passes on anything beyond the name, dates and the visible category", () => {
		const leaky = {
			...absence(),
			sickDetail: "with_certificate",
			notes: "Doctor's appointment",
		} as CoverDutyAbsence;

		const [duty] = buildCoverDuties({
			absences: [leaky],
			viewer: { role: "admin", managedEmployeeIds: new Set() },
			organizationTimezone: "UTC",
			now: NOW,
		}).running;

		expect(Object.keys(duty ?? {}).sort()).toEqual([
			"absenceId",
			"category",
			"employeeId",
			"employeeName",
			"endDate",
			"startDate",
		]);
	});

	it("orders running duties by end date and upcoming ones by start date", () => {
		const duties = buildCoverDuties({
			absences: [
				absence({ absenceId: "late-end", startDate: "2026-10-01", endDate: "2026-10-20" }),
				absence({ absenceId: "early-end", startDate: "2026-10-05", endDate: "2026-10-11" }),
				absence({ absenceId: "later-start", startDate: "2026-10-20", endDate: "2026-10-21" }),
				absence({ absenceId: "sooner-start", startDate: "2026-10-15", endDate: "2026-10-30" }),
			],
			viewer: employeeViewer,
			organizationTimezone: "UTC",
			now: NOW,
		});

		expect(duties.running.map((duty) => duty.absenceId)).toEqual(["early-end", "late-end"]);
		expect(duties.upcoming.map((duty) => duty.absenceId)).toEqual(["sooner-start", "later-start"]);
	});
});
