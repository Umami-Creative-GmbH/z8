import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { cronScheduleOverride } from "@/db/schema";
import {
	deleteCronScheduleOverride,
	listCronScheduleOverrides,
	upsertCronScheduleOverride,
} from "./schedule-overrides";

const mocks = vi.hoisted(() => {
	const orderBy = vi.fn();
	const from = vi.fn(() => ({ orderBy }));
	const select = vi.fn(() => ({ from }));
	const returning = vi.fn();
	const onConflictDoUpdate = vi.fn(() => ({ returning }));
	const values = vi.fn(() => ({ onConflictDoUpdate }));
	const insert = vi.fn(() => ({ values }));
	const where = vi.fn();
	const deleteMock = vi.fn(() => ({ where }));
	const eqMock = vi.fn((left, right) => ({ left, operator: "eq", right }));

	return {
		deleteMock,
		eqMock,
		from,
		insert,
		onConflictDoUpdate,
		orderBy,
		returning,
		select,
		values,
		where,
	};
});

vi.mock("@/db", () => ({
	db: {
		delete: mocks.deleteMock,
		insert: mocks.insert,
		select: mocks.select,
	},
}));

vi.mock("@/db/schema", () => ({
	cronScheduleOverride: {
		jobName: { name: "job_name" },
		pattern: { name: "pattern" },
		presetId: { name: "preset_id" },
		updatedBy: { name: "updated_by" },
	},
}));

vi.mock("drizzle-orm", () => ({
	eq: mocks.eqMock,
}));

describe("cron schedule override persistence", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("lists all overrides ordered by job name", async () => {
		const rows = [
			{
				id: "override-1",
				jobName: "cron:export",
				pattern: "0 * * * *",
				presetId: "hourly",
				updatedBy: "user-1",
				createdAt: new Date("2026-06-03T10:00:00.000Z"),
				updatedAt: new Date("2026-06-03T10:00:00.000Z"),
			},
		];
		mocks.orderBy.mockResolvedValue(rows);

		await expect(listCronScheduleOverrides()).resolves.toBe(rows);

		expect(db.select).toHaveBeenCalledWith();
		expect(mocks.from).toHaveBeenCalledWith(cronScheduleOverride);
		expect(mocks.orderBy).toHaveBeenCalledWith(cronScheduleOverride.jobName);
	});

	it("upserts an override by job name and returns the saved row", async () => {
		const saved = {
			id: "override-1",
			jobName: "cron:export",
			pattern: "0 * * * *",
			presetId: "hourly",
			updatedBy: "user-1",
			createdAt: new Date("2026-06-03T10:00:00.000Z"),
			updatedAt: new Date("2026-06-03T10:00:00.000Z"),
		};
		mocks.returning.mockResolvedValue([saved]);

		await expect(
			upsertCronScheduleOverride({
				jobName: "cron:export",
				pattern: "0 * * * *",
				presetId: "hourly",
				updatedBy: "user-1",
			}),
		).resolves.toBe(saved);

		expect(db.insert).toHaveBeenCalledWith(cronScheduleOverride);
		expect(mocks.values).toHaveBeenCalledWith({
			jobName: "cron:export",
			pattern: "0 * * * *",
			presetId: "hourly",
			updatedBy: "user-1",
			createdAt: expect.any(Date),
			updatedAt: expect.any(Date),
		});
		const insertValues = mocks.values.mock.calls[0]?.[0];

		expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith({
			target: cronScheduleOverride.jobName,
			set: {
				pattern: "0 * * * *",
				presetId: "hourly",
				updatedBy: "user-1",
				updatedAt: insertValues.updatedAt,
			},
		});
		expect(mocks.returning).toHaveBeenCalledWith();
	});

	it("deletes an override by job name", async () => {
		mocks.where.mockResolvedValue(undefined);

		await expect(deleteCronScheduleOverride("cron:export")).resolves.toBeUndefined();

		expect(db.delete).toHaveBeenCalledWith(cronScheduleOverride);
		expect(eq).toHaveBeenCalledWith(cronScheduleOverride.jobName, "cron:export");
		expect(mocks.where).toHaveBeenCalledWith({
			left: cronScheduleOverride.jobName,
			operator: "eq",
			right: "cron:export",
		});
	});
});
