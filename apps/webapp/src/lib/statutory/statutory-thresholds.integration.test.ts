/**
 * #1988: platform-managed German statutory baselines in `statutory_threshold`.
 * Effective-dated resolution on any plain calendar date and across rolling ranges
 * that span a statutory change, against the rows the migration seeds.
 */
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { statutoryThreshold } from "@/db/schema";
import {
	STATUTORY_ON_CALL_MIN_DAILY_MINUTES,
	STATUTORY_ON_CALL_WEEKLY_FALLBACK_MINUTES,
} from "@/lib/contracts/contract-validation";
import { loadStatutoryThresholds, resolveStatutoryThreshold } from "./thresholds";

describe("statutory threshold lookup (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	it("resolves the Minijob cap in force on each side of the October 2022 change", async () => {
		const before = await resolveStatutoryThreshold(
			db,
			"de_minijob_monthly_limit_cents",
			"2022-09-30",
		);
		const after = await resolveStatutoryThreshold(
			db,
			"de_minijob_monthly_limit_cents",
			"2022-10-01",
		);

		expect(before).toMatchObject({ value: 45_000, unit: "cents", currency: "EUR" });
		expect(after).toMatchObject({
			value: 52_000,
			effectiveFromDate: "2022-10-01",
			effectiveUntilDate: "2024-01-01",
		});
	});

	it("splits a rolling range into the baselines in force across a statutory change", async () => {
		const table = await loadStatutoryThresholds(db, {
			keys: ["de_minijob_monthly_limit_cents"],
			from: "2025-11-01",
			until: "2026-03-01",
		});

		expect(table.segments("de_minijob_monthly_limit_cents", "2025-11-01", "2026-03-01")).toEqual([
			{ from: "2025-11-01", until: "2026-01-01", value: 55_600 },
			{ from: "2026-01-01", until: "2026-03-01", value: 60_300 },
		]);
		expect(table.valueOn("de_minijob_monthly_limit_cents", "2026-02-28")).toBe(60_300);
	});

	it("returns no baseline before the first seeded effective date", async () => {
		expect(
			await resolveStatutoryThreshold(db, "de_minijob_monthly_limit_cents", "2012-12-31"),
		).toBeNull();
	});

	it("refuses application writes to platform-managed baselines", async () => {
		const cap = statutoryThreshold.thresholdKey;
		await expect(
			db
				.update(statutoryThreshold)
				.set({ integerValue: 99_900 })
				.where(
					and(eq(cap, "de_minijob_monthly_limit_cents"), isNull(statutoryThreshold.organizationId)),
				),
		).rejects.toThrow();
		await expect(
			db.insert(statutoryThreshold).values({
				countryCode: "DE",
				thresholdKey: "de_minijob_monthly_limit_cents",
				effectiveFromDate: "2030-01-01",
				integerValue: 1,
			}),
		).rejects.toThrow();
		await expect(
			db.delete(statutoryThreshold).where(eq(cap, "de_on_call_notice_full_days")),
		).rejects.toThrow();

		expect(
			(await resolveStatutoryThreshold(db, "de_minijob_monthly_limit_cents", "2026-06-15"))?.value,
		).toBe(60_300);
		expect(
			await resolveStatutoryThreshold(db, "de_on_call_notice_full_days", "2026-06-15"),
		).not.toBeNull();
	});

	it("agrees with the on-call fallbacks the Milestone 1 contract preview still hardcodes", async () => {
		// The resolver's preview constants must not drift from the baselines monitors evaluate.
		const on = "2026-06-15";
		expect(
			(await resolveStatutoryThreshold(db, "de_on_call_default_weekly_minutes", on))?.value,
		).toBe(STATUTORY_ON_CALL_WEEKLY_FALLBACK_MINUTES);
		expect((await resolveStatutoryThreshold(db, "de_on_call_min_call_minutes", on))?.value).toBe(
			STATUTORY_ON_CALL_MIN_DAILY_MINUTES,
		);
	});

	it("seeds every German statutory baseline the Milestone 2 monitors read", async () => {
		const on = "2026-06-15";
		const values = Object.fromEntries(
			await Promise.all(
				(
					[
						"de_minijob_max_unforeseeable_months_per_12m",
						"de_minijob_unforeseeable_multiplier",
						"de_short_term_max_work_days_per_year",
						"de_short_term_max_months_per_year",
						"de_working_student_weekly_minutes",
						"de_working_student_max_over_20h_weeks_per_12m",
						"de_working_student_max_over_20h_days_per_12m",
						"de_on_call_notice_full_days",
						"de_on_call_min_call_minutes",
						"de_on_call_default_weekly_minutes",
						"de_on_call_min_band_plus_pct",
						"de_on_call_max_band_minus_pct",
						"de_jarbschg_max_daily_minutes",
						"de_jarbschg_max_daily_compensatory_minutes",
						"de_jarbschg_max_weekly_minutes",
						"de_jarbschg_max_days_per_week",
						"de_jarbschg_min_rest_minutes",
						"de_jarbschg_break_after_270_minutes",
						"de_jarbschg_break_after_360_minutes",
						"de_jarbschg_night_start",
						"de_jarbschg_night_end",
					] as const
				).map(async (key) => [key, (await resolveStatutoryThreshold(db, key, on))?.value]),
			),
		);

		expect(values).toEqual({
			de_minijob_max_unforeseeable_months_per_12m: 2,
			de_minijob_unforeseeable_multiplier: 2,
			de_short_term_max_work_days_per_year: 70,
			de_short_term_max_months_per_year: 3,
			de_working_student_weekly_minutes: 1200,
			de_working_student_max_over_20h_weeks_per_12m: 26,
			de_working_student_max_over_20h_days_per_12m: 182,
			de_on_call_notice_full_days: 4,
			de_on_call_min_call_minutes: 180,
			de_on_call_default_weekly_minutes: 1200,
			de_on_call_min_band_plus_pct: 25,
			de_on_call_max_band_minus_pct: 20,
			de_jarbschg_max_daily_minutes: 480,
			de_jarbschg_max_daily_compensatory_minutes: 510,
			de_jarbschg_max_weekly_minutes: 2400,
			de_jarbschg_max_days_per_week: 5,
			de_jarbschg_min_rest_minutes: 720,
			de_jarbschg_break_after_270_minutes: 30,
			de_jarbschg_break_after_360_minutes: 60,
			de_jarbschg_night_start: 1200,
			de_jarbschg_night_end: 360,
		});
	});
});
