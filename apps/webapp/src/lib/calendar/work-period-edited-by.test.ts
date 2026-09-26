import { describe, expect, it } from "vitest";
import { formatWorkPeriodEditedDate, resolveWorkPeriodEditedBy } from "./work-period-edited-by";

const original = {
	type: "clock_in",
	createdBy: "user-owner",
	createdAt: new Date("2026-09-01T07:00:00.000Z"),
	editorName: "Ada Owner",
};

describe("resolveWorkPeriodEditedBy", () => {
	it("names the manager whose correction now bounds the work period", () => {
		expect(
			resolveWorkPeriodEditedBy({
				ownerUserId: "user-owner",
				endpoints: [
					original,
					{
						type: "correction",
						createdBy: "user-manager",
						createdAt: new Date("2026-09-03T10:00:00.000Z"),
						editorName: "John Doe",
					},
				],
			}),
		).toEqual({
			editedByName: "John Doe",
			editedAt: new Date("2026-09-03T10:00:00.000Z"),
		});
	});

	it("uses the newest correction endpoint", () => {
		expect(
			resolveWorkPeriodEditedBy({
				ownerUserId: "user-owner",
				endpoints: [
					{
						type: "correction",
						createdBy: "user-admin",
						createdAt: new Date("2026-09-02T10:00:00.000Z"),
						editorName: "Grace Admin",
					},
					{
						type: "correction",
						createdBy: "user-manager",
						createdAt: new Date("2026-09-04T10:00:00.000Z"),
						editorName: "John Doe",
					},
				],
			})?.editedByName,
		).toBe("John Doe");
	});

	it("ignores the employee's own edits and uncorrected entries", () => {
		expect(
			resolveWorkPeriodEditedBy({
				ownerUserId: "user-owner",
				endpoints: [original, null],
			}),
		).toBeNull();
		expect(
			resolveWorkPeriodEditedBy({
				ownerUserId: "user-owner",
				endpoints: [
					{
						type: "correction",
						createdBy: "user-manager",
						createdAt: new Date("2026-09-02T10:00:00.000Z"),
						editorName: "John Doe",
					},
					{
						type: "correction",
						createdBy: "user-owner",
						createdAt: new Date("2026-09-05T10:00:00.000Z"),
						editorName: "Ada Owner",
					},
				],
			}),
		).toBeNull();
	});
});

describe("formatWorkPeriodEditedDate", () => {
	it("formats the edit day as dd.mm.yyyy in the calendar timezone", () => {
		const lateEvening = new Date("2026-09-03T22:30:00.000Z");

		expect(formatWorkPeriodEditedDate(lateEvening, "UTC")).toBe("03.09.2026");
		expect(formatWorkPeriodEditedDate(lateEvening, "Europe/Berlin")).toBe("04.09.2026");
		expect(formatWorkPeriodEditedDate(lateEvening.toISOString(), "UTC")).toBe("03.09.2026");
	});
});
