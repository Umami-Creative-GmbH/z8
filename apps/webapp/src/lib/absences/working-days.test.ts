import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	type WorkingDayPolicyAssignment,
	type WorkingDaySchedule,
	workingDaysFrom,
} from "./working-days";

const WEEK = [
	"2026-10-12", // Monday
	"2026-10-13",
	"2026-10-14",
	"2026-10-15",
	"2026-10-16",
	"2026-10-17",
	"2026-10-18", // Sunday
];

function workingDaysOfWeek(isWorkingDay: (day: Temporal.PlainDate) => boolean): string[] {
	return WEEK.filter((day) => isWorkingDay(Temporal.PlainDate.from(day)));
}

const ALL_WEEKDAYS = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
] as const;

function scheduleDays(workDays: readonly (typeof ALL_WEEKDAYS)[number][]) {
	return ALL_WEEKDAYS.map((dayOfWeek) => ({ dayOfWeek, isWorkDay: workDays.includes(dayOfWeek) }));
}

const mondayToThursday: WorkingDaySchedule = {
	scheduleType: "detailed",
	workingDaysPreset: "weekdays",
	days: scheduleDays(["monday", "tuesday", "wednesday", "thursday"]),
};

const mondayToFridaySchedule: WorkingDaySchedule = {
	scheduleType: "simple",
	workingDaysPreset: "weekdays",
	days: [],
};

let nextId = 0;
function assignment(
	overrides: Partial<WorkingDayPolicyAssignment> & Pick<WorkingDayPolicyAssignment, "schedule">,
): WorkingDayPolicyAssignment {
	nextId += 1;
	return {
		id: `assignment-${String(nextId).padStart(3, "0")}`,
		assignmentType: "employee",
		effectiveFrom: null,
		effectiveUntil: null,
		createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

describe("workingDaysFrom", () => {
	it("works Monday to Friday without a policy", () => {
		expect(workingDaysOfWeek(workingDaysFrom({ assignments: [], holidays: [] }))).toEqual(
			WEEK.slice(0, 5),
		);
	});

	it("works Monday to Friday when the policy has no schedule", () => {
		expect(
			workingDaysOfWeek(
				workingDaysFrom({ assignments: [assignment({ schedule: null })], holidays: [] }),
			),
		).toEqual(WEEK.slice(0, 5));
	});

	it.each([
		["weekdays", WEEK.slice(0, 5)],
		["weekends", WEEK.slice(5)],
		["all_days", WEEK],
	] as const)("uses the simple %s preset", (workingDaysPreset, expected) => {
		const schedule: WorkingDaySchedule = {
			scheduleType: "simple",
			workingDaysPreset,
			// Simple presets ignore day rows.
			days: scheduleDays(["wednesday"]),
		};
		expect(
			workingDaysOfWeek(workingDaysFrom({ assignments: [assignment({ schedule })], holidays: [] })),
		).toEqual(expected);
	});

	it("uses the work days of a simple custom preset", () => {
		const schedule: WorkingDaySchedule = {
			scheduleType: "simple",
			workingDaysPreset: "custom",
			days: scheduleDays(["monday", "wednesday", "saturday"]),
		};
		expect(
			workingDaysOfWeek(workingDaysFrom({ assignments: [assignment({ schedule })], holidays: [] })),
		).toEqual(["2026-10-12", "2026-10-14", "2026-10-17"]);
	});

	it("uses the work days of a detailed schedule whatever its cycle", () => {
		const schedule = { ...mondayToThursday, scheduleCycle: "biweekly" as const };
		expect(
			workingDaysOfWeek(workingDaysFrom({ assignments: [assignment({ schedule })], holidays: [] })),
		).toEqual(WEEK.slice(0, 4));
	});

	it("counts a weekday as worked when any of its rows is a work day", () => {
		const schedule: WorkingDaySchedule = {
			scheduleType: "detailed",
			workingDaysPreset: "weekdays",
			days: [
				{ dayOfWeek: "saturday", isWorkDay: false },
				{ dayOfWeek: "saturday", isWorkDay: true },
			],
		};
		expect(
			workingDaysOfWeek(workingDaysFrom({ assignments: [assignment({ schedule })], holidays: [] })),
		).toEqual(["2026-10-17"]);
	});

	it("prefers the employee assignment, then the team's, then the organization's", () => {
		const organization = assignment({
			assignmentType: "organization",
			schedule: { ...mondayToFridaySchedule, workingDaysPreset: "all_days" },
		});
		const team = assignment({
			assignmentType: "team",
			schedule: { ...mondayToFridaySchedule, workingDaysPreset: "weekends" },
		});
		const employee = assignment({ assignmentType: "employee", schedule: mondayToThursday });

		expect(
			workingDaysOfWeek(
				workingDaysFrom({ assignments: [organization, team, employee], holidays: [] }),
			),
		).toEqual(WEEK.slice(0, 4));
		expect(
			workingDaysOfWeek(workingDaysFrom({ assignments: [organization, team], holidays: [] })),
		).toEqual(WEEK.slice(5));
		expect(
			workingDaysOfWeek(workingDaysFrom({ assignments: [organization], holidays: [] })),
		).toEqual(WEEK);
	});

	it("uses the policy in effect on each day across a policy change", () => {
		const before = assignment({
			schedule: mondayToFridaySchedule,
			effectiveUntil: Temporal.Instant.from("2026-10-14T23:59:59.999Z"),
		});
		const after = assignment({
			schedule: mondayToThursday,
			effectiveFrom: Temporal.Instant.from("2026-10-15T00:00:00Z"),
		});
		const isWorkingDay = workingDaysFrom({ assignments: [before, after], holidays: [] });

		const days: string[] = [];
		for (
			let day = Temporal.PlainDate.from("2026-10-12");
			Temporal.PlainDate.compare(day, Temporal.PlainDate.from("2026-10-23")) <= 0;
			day = day.add({ days: 1 })
		) {
			if (isWorkingDay(day)) days.push(day.toString());
		}
		expect(days).toEqual([
			"2026-10-12",
			"2026-10-13",
			"2026-10-14",
			"2026-10-15",
			"2026-10-19",
			"2026-10-20",
			"2026-10-21",
			"2026-10-22",
		]);
	});

	it("lets the later-starting assignment win on a day both are in force", () => {
		const open = assignment({ schedule: mondayToFridaySchedule });
		const fromMidday = assignment({
			schedule: mondayToThursday,
			effectiveFrom: Temporal.Instant.from("2026-10-16T12:00:00Z"),
		});
		const isWorkingDay = workingDaysFrom({ assignments: [open, fromMidday], holidays: [] });

		expect(isWorkingDay(Temporal.PlainDate.from("2026-10-09"))).toBe(true);
		// The new policy is in force from Friday noon, so it already decides Friday.
		expect(isWorkingDay(Temporal.PlainDate.from("2026-10-16"))).toBe(false);
	});

	it("breaks ties between equal starts by the newest assignment", () => {
		const older = assignment({
			schedule: mondayToFridaySchedule,
			createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
		});
		const newer = assignment({
			schedule: mondayToThursday,
			createdAt: Temporal.Instant.from("2026-02-01T00:00:00Z"),
		});
		expect(
			workingDaysOfWeek(workingDaysFrom({ assignments: [newer, older], holidays: [] })),
		).toEqual(WEEK.slice(0, 4));
		expect(
			workingDaysOfWeek(workingDaysFrom({ assignments: [older, newer], holidays: [] })),
		).toEqual(WEEK.slice(0, 4));
	});

	it("falls back to the next level outside an assignment's effective window", () => {
		const organization = assignment({
			assignmentType: "organization",
			schedule: mondayToFridaySchedule,
		});
		const employee = assignment({
			schedule: mondayToThursday,
			effectiveFrom: Temporal.Instant.from("2026-10-15T00:00:00Z"),
			effectiveUntil: Temporal.Instant.from("2026-10-15T23:59:59.999Z"),
		});
		const isWorkingDay = workingDaysFrom({ assignments: [organization, employee], holidays: [] });

		expect(isWorkingDay(Temporal.PlainDate.from("2026-10-16"))).toBe(true);
		expect(isWorkingDay(Temporal.PlainDate.from("2026-10-22"))).toBe(true);
	});

	it("excludes the employee's holidays", () => {
		const isWorkingDay = workingDaysFrom({
			assignments: [],
			holidays: [
				{
					id: "holiday",
					name: "Reformation Day",
					categoryId: "",
					startDate: new Date("2026-10-13T00:00:00Z"),
					endDate: new Date("2026-10-14T23:59:59.999Z"),
				},
			],
		});
		expect(workingDaysOfWeek(isWorkingDay)).toEqual(["2026-10-12", "2026-10-15", "2026-10-16"]);
	});
});
