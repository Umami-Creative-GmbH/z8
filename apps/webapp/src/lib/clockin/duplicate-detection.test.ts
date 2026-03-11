import { describe, expect, it } from "vitest";
import {
	isClockinAbsenceDuplicate,
	isClockinWorkdayDuplicate,
} from "@/lib/clockin/duplicate-detection";

describe("Clockin duplicate detection", () => {
	it("marks matching employee and time window as duplicate", () => {
		expect(
			isClockinWorkdayDuplicate(
				{
					employeeId: "emp_1",
					startAt: "2026-03-01T08:00:00Z",
					endAt: "2026-03-01T16:00:00Z",
				},
				{
					employeeId: "emp_1",
					startTime: new Date("2026-03-01T08:00:00Z"),
					endTime: new Date("2026-03-01T16:00:00Z"),
				},
			),
		).toBe(true);
	});

	it("does not mark different work windows as duplicate", () => {
		expect(
			isClockinWorkdayDuplicate(
				{
					employeeId: "emp_1",
					startAt: "2026-03-01T08:00:00Z",
					endAt: "2026-03-01T15:00:00Z",
				},
				{
					employeeId: "emp_1",
					startTime: new Date("2026-03-01T08:00:00Z"),
					endTime: new Date("2026-03-01T16:00:00Z"),
				},
			),
		).toBe(false);
	});

	it("marks matching absence date ranges as duplicate", () => {
		expect(
			isClockinAbsenceDuplicate(
				{
					employeeId: "emp_1",
					startDate: "2026-03-10",
					endDate: "2026-03-12",
				},
				{
					employeeId: "emp_1",
					startDate: "2026-03-10",
					endDate: "2026-03-12",
				},
			),
		).toBe(true);
	});

	it("does not mark different employees as duplicate", () => {
		expect(
			isClockinAbsenceDuplicate(
				{
					employeeId: "emp_1",
					startDate: "2026-03-10",
					endDate: "2026-03-12",
				},
				{
					employeeId: "emp_2",
					startDate: "2026-03-10",
					endDate: "2026-03-12",
				},
			),
		).toBe(false);
	});
});
