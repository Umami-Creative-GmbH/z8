import { describe, expect, it } from "vitest";
import {
	buildScheduledJobRows,
	CRON_SCHEDULE_PRESETS,
	getPresetById,
	isHighRiskCronJob,
	resolveEffectiveCronSchedules,
} from "./schedules";

describe("cron schedule presets", () => {
	it("contains stable preset IDs for supported intervals", () => {
		expect(CRON_SCHEDULE_PRESETS.map((preset) => preset.id)).toEqual([
			"every-minute",
			"every-5-minutes",
			"every-15-minutes",
			"every-30-minutes",
			"hourly",
			"every-3-hours",
			"daily-midnight",
			"daily-1am",
			"daily-230am",
			"weekly-sunday-midnight",
		]);
		expect(getPresetById("hourly")?.pattern).toBe("0 * * * *");
	});

	it("marks operationally high-risk jobs", () => {
		expect(isHighRiskCronJob("cron:billing-seat-reconciliation")).toBe(true);
		expect(isHighRiskCronJob("cron:execution-cleanup")).toBe(true);
		expect(isHighRiskCronJob("cron:export")).toBe(false);
	});

	it("resolves overrides over registry defaults", () => {
		const schedules = resolveEffectiveCronSchedules({
			overrides: [
				{
					jobName: "cron:export",
					presetId: "hourly",
					pattern: "0 * * * *",
				},
			],
		});

		expect(schedules["cron:export"]).toMatchObject({
			jobName: "cron:export",
			defaultPattern: "*/5 * * * *",
			effectivePattern: "0 * * * *",
			presetId: "hourly",
			isOverridden: true,
		});
		expect(schedules["cron:vacation"].isOverridden).toBe(false);
	});

	it("builds rows with mismatch status from BullMQ repeatables", () => {
		const rows = buildScheduledJobRows({
			overrides: [
				{
					jobName: "cron:export",
					presetId: "hourly",
					pattern: "0 * * * *",
				},
			],
			repeatableJobs: [
				{
					name: "cron:export",
					pattern: "*/5 * * * *",
					next: "2026-06-03T12:05:00.000Z",
				},
			],
		});

		const exportRow = rows.find((row) => row.name === "cron:export");
		expect(exportRow).toMatchObject({
			name: "cron:export",
			effectivePattern: "0 * * * *",
			currentBullMqPattern: "*/5 * * * *",
			hasScheduleMismatch: true,
			canEdit: true,
		});
	});

	it("marks duplicate repeatables as mismatched when matching and stale schedules coexist", () => {
		const rows = buildScheduledJobRows({
			overrides: [
				{
					jobName: "cron:export",
					presetId: "hourly",
					pattern: "0 * * * *",
				},
			],
			repeatableJobs: [
				{
					name: "cron:export",
					pattern: "*/5 * * * *",
					next: "2026-06-03T12:05:00.000Z",
				},
				{
					name: "cron:export",
					pattern: "0 * * * *",
					next: "2026-06-03T13:00:00.000Z",
				},
			],
		});

		const exportRow = rows.find((row) => row.name === "cron:export");
		expect(exportRow).toMatchObject({
			name: "cron:export",
			effectivePattern: "0 * * * *",
			currentBullMqPattern: "0 * * * *",
			next: "2026-06-03T13:00:00.000Z",
			hasScheduleMismatch: true,
		});
	});

	it("marks missing repeatables as mismatched", () => {
		const rows = buildScheduledJobRows({
			overrides: [],
			repeatableJobs: [],
		});

		const exportRow = rows.find((row) => row.name === "cron:export");
		expect(exportRow).toMatchObject({
			name: "cron:export",
			currentBullMqPattern: null,
			next: null,
			hasScheduleMismatch: true,
		});
	});
});
