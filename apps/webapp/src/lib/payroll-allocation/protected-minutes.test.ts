import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
	allocateProtectedMinutes,
	employeePayrollWindow,
	type ProtectedWorkSegment,
} from "./protected-minutes";

const instant = (value: string) => Temporal.Instant.from(value);

function segment(
	startAt: string,
	endAt: string,
	storedMinutes: number | null,
): ProtectedWorkSegment {
	return { startAt: instant(startAt), endAt: instant(endAt), storedMinutes };
}

function window(start: string, endExclusive: string) {
	return { start: instant(start), endExclusive: instant(endExclusive) };
}

function allocatedMinutes(
	work: ProtectedWorkSegment,
	range: ReturnType<typeof window>,
): number | undefined {
	const allocation = allocateProtectedMinutes(work, range);
	return allocation.status === "allocated" ? allocation.minutes : undefined;
}

describe("allocateProtectedMinutes", () => {
	it("credits stored minutes for a fully included segment even when endpoints differ", () => {
		// Protected 60 minutes whose exact endpoints span 60m40s.
		const work = segment("2026-06-10T08:00:00Z", "2026-06-10T09:00:40Z", 60);

		expect(
			allocateProtectedMinutes(
				work,
				window("2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z"),
			),
		).toEqual({
			status: "allocated",
			minutes: 60,
			overlap: { start: work.startAt, endExclusive: work.endAt },
		});
	});

	it("splits a boundary-crossing segment by cumulative half-up allocation of stored minutes", () => {
		// 3 stored minutes over 3m20s; boundary after 1m40s is exactly half: C = 1.5 -> 2.
		const work = segment("2026-06-10T23:58:20Z", "2026-06-11T00:01:40Z", 3);
		const first = window("2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z");
		const second = window("2026-06-11T00:00:00Z", "2026-06-12T00:00:00Z");

		expect(allocateProtectedMinutes(work, first)).toEqual({
			status: "allocated",
			minutes: 2,
			overlap: { start: work.startAt, endExclusive: first.endExclusive },
		});
		expect(allocatedMinutes(work, second)).toBe(1);
	});

	it("rounds cumulative amounts just below half down", () => {
		// 1 stored minute over 60s; boundary after 29.999s gives C = 0.49998 -> 0.
		const work = segment(
			"2026-06-10T23:59:30.001Z",
			"2026-06-11T00:00:30.001Z",
			1,
		);

		expect(
			allocatedMinutes(
				work,
				window("2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z"),
			),
		).toBe(0);
		expect(
			allocatedMinutes(
				work,
				window("2026-06-11T00:00:00Z", "2026-06-12T00:00:00Z"),
			),
		).toBe(1);
	});

	it("uses stored minutes, not elapsed time, when a differing segment crosses a boundary", () => {
		// 60 stored minutes over 60m40s, crossing midnight 30 minutes in.
		const work = segment("2026-06-10T23:30:00Z", "2026-06-11T00:30:40Z", 60);
		const before = allocatedMinutes(
			work,
			window("2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z"),
		);
		const after = allocatedMinutes(
			work,
			window("2026-06-11T00:00:00Z", "2026-06-12T00:00:00Z"),
		);

		// 60 * 1800 / 3640 = 29.67 -> 30
		expect(before).toBe(30);
		expect(after).toBe(30);
	});

	it("conserves stored minutes across adjacent partitions in any evaluation order", () => {
		const work = segment("2026-06-10T21:07:13Z", "2026-06-11T02:52:51Z", 346);
		const boundaries = [
			"2026-06-10T00:00:00Z",
			"2026-06-10T22:00:00Z",
			"2026-06-10T22:17:05Z",
			"2026-06-10T23:59:59.999Z",
			"2026-06-11T00:00:00Z",
			"2026-06-11T01:33:00Z",
			"2026-06-12T00:00:00Z",
		];
		const windows = boundaries
			.slice(0, -1)
			.map((start, index) => window(start, boundaries[index + 1] as string));

		const forward = windows.map((range) => allocatedMinutes(work, range) ?? 0);
		const reversed = windows
			.toReversed()
			.map((range) => allocatedMinutes(work, range) ?? 0)
			.toReversed();

		expect(forward).toEqual(reversed);
		expect(forward.reduce((total, minutes) => total + minutes, 0)).toBe(346);
		expect(
			allocatedMinutes(
				work,
				window(boundaries[0] as string, boundaries.at(-1) as string),
			),
		).toBe(346);
	});

	it("treats zero stored minutes as valid zero credit, not missing work", () => {
		const work = segment("2026-06-10T23:59:50Z", "2026-06-11T00:00:20Z", 0);

		expect(
			allocateProtectedMinutes(
				work,
				window("2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z"),
			),
		).toMatchObject({ status: "allocated", minutes: 0 });
		expect(
			allocateProtectedMinutes(
				work,
				window("2026-06-11T00:00:00Z", "2026-06-12T00:00:00Z"),
			),
		).toMatchObject({ status: "allocated", minutes: 0 });
	});

	it("credits a zero-length segment only to the window containing its instant", () => {
		const work = segment("2026-06-11T00:00:00Z", "2026-06-11T00:00:00Z", 0);

		expect(
			allocateProtectedMinutes(
				work,
				window("2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z"),
			),
		).toEqual({ status: "outside" });
		expect(
			allocateProtectedMinutes(
				work,
				window("2026-06-11T00:00:00Z", "2026-06-12T00:00:00Z"),
			),
		).toMatchObject({ status: "allocated", minutes: 0 });
	});

	it("excludes segments that only touch the window boundary", () => {
		const work = segment("2026-06-10T22:00:00Z", "2026-06-11T00:00:00Z", 120);

		expect(
			allocateProtectedMinutes(
				work,
				window("2026-06-11T00:00:00Z", "2026-06-12T00:00:00Z"),
			),
		).toEqual({ status: "outside" });
	});

	it("blocks a boundary split when stored minutes indicate an unlocated break", () => {
		// 8h elapsed but only 7h30 stored: the 30-minute break could be on either side.
		const work = segment("2026-06-10T20:00:00Z", "2026-06-11T04:00:00Z", 450);

		expect(
			allocateProtectedMinutes(
				work,
				window("2026-06-11T00:00:00Z", "2026-06-12T00:00:00Z"),
			),
		).toEqual({ status: "blocked", reason: "unresolved_interval" });
		expect(
			allocateProtectedMinutes(
				work,
				window("2026-06-10T00:00:00Z", "2026-06-12T00:00:00Z"),
			),
		).toMatchObject({ status: "allocated", minutes: 450 });
	});

	it("blocks a boundary split when stored minutes exceed the recorded interval", () => {
		const work = segment("2026-06-10T23:00:00Z", "2026-06-11T01:00:00Z", 125);

		expect(
			allocateProtectedMinutes(
				work,
				window("2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z"),
			),
		).toEqual({ status: "blocked", reason: "unresolved_interval" });
	});

	it("blocks completed work without stored minutes instead of treating it as zero", () => {
		const work = segment("2026-06-10T08:00:00Z", "2026-06-10T09:00:00Z", null);

		expect(
			allocateProtectedMinutes(
				work,
				window("2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z"),
			),
		).toEqual({ status: "blocked", reason: "missing_stored_minutes" });
		expect(
			allocateProtectedMinutes(
				work,
				window("2026-06-11T00:00:00Z", "2026-06-12T00:00:00Z"),
			),
		).toEqual({ status: "outside" });
	});

	it("blocks reversed endpoints", () => {
		const work = segment("2026-06-10T09:00:00Z", "2026-06-10T08:00:00Z", 60);

		expect(
			allocateProtectedMinutes(
				work,
				window("2026-06-10T00:00:00Z", "2026-06-11T00:00:00Z"),
			),
		).toEqual({ status: "blocked", reason: "invalid_endpoints" });
	});
});

describe("employeePayrollWindow", () => {
	it("builds half-open employee-local windows that meet at the shared boundary", () => {
		const may = employeePayrollWindow(
			"2026-05-01",
			"2026-05-31",
			"America/New_York",
		);
		const june = employeePayrollWindow(
			"2026-06-01",
			"2026-06-30",
			"America/New_York",
		);

		expect(may.start.toString()).toBe("2026-05-01T04:00:00Z");
		expect(may.endExclusive.toString()).toBe("2026-06-01T04:00:00Z");
		expect(june.start.equals(may.endExclusive)).toBe(true);
	});

	it("composes DST-shortened and DST-lengthened local days without losing minutes", () => {
		// Europe/Berlin: 2026-03-29 has 23 hours, 2026-10-25 has 25 hours.
		const springWork = segment(
			"2026-03-28T22:30:00Z",
			"2026-03-29T00:30:00Z",
			120,
		);
		const autumnWork = segment(
			"2026-10-24T21:00:00Z",
			"2026-10-25T23:30:00Z",
			1590,
		);
		const timezone = "Europe/Berlin";
		const springDays = ["2026-03-28", "2026-03-29"].map((date) =>
			employeePayrollWindow(date, date, timezone),
		);
		const autumnDays = ["2026-10-24", "2026-10-25", "2026-10-26"].map((date) =>
			employeePayrollWindow(date, date, timezone),
		);

		// Berlin midnight on 2026-03-29 is 2026-03-28T23:00Z: 30 of 120 minutes fall before it.
		expect(
			springDays.map((range) => allocatedMinutes(springWork, range) ?? 0),
		).toEqual([30, 90]);
		// Berlin midnights: 2026-10-24T22:00Z and 2026-10-25T23:00Z (25-hour day between them).
		expect(
			autumnDays.map((range) => allocatedMinutes(autumnWork, range) ?? 0),
		).toEqual([60, 1500, 30]);
		expect(
			allocatedMinutes(
				autumnWork,
				employeePayrollWindow("2026-10-24", "2026-10-26", timezone),
			),
		).toBe(1590);
	});

	it("allocates travel work by UTC instants against the employee's own payroll zone", () => {
		// Work captured in Tokyo while the employee's payroll calendar is Europe/Berlin.
		const tokyoShift = segment(
			"2026-06-30T20:00:00Z",
			"2026-07-01T04:00:00Z",
			480,
		);
		const june = employeePayrollWindow(
			"2026-06-01",
			"2026-06-30",
			"Europe/Berlin",
		);
		const july = employeePayrollWindow(
			"2026-07-01",
			"2026-07-31",
			"Europe/Berlin",
		);

		// Berlin month boundary is 2026-06-30T22:00Z: 120 minutes in June, 360 in July.
		expect(allocatedMinutes(tokyoShift, june)).toBe(120);
		expect(allocatedMinutes(tokyoShift, july)).toBe(360);
	});
});
