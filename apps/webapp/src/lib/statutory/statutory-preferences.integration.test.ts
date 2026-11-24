/**
 * #1988: organization statutory warning preferences (warning / critical tiers and the optional
 * JArbSchG shift-publish block) are organization-scoped, validated, and default when unset.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { ValidationError } from "@/lib/effect/errors";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import {
	loadOrganizationStatutoryPreferences,
	saveOrganizationStatutoryPreferences,
} from "./preferences";
import { loadStatutorySettingsOverview } from "./settings-overview";

describe("organization statutory preferences (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const pool = integrationAdminPool();
	const fx = statutoryFixture(pool, "t1988-prefs");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	it("defaults to 80 % warning, 95 % critical and no publish block", async () => {
		const org = await fx.organization("a");

		expect(await loadOrganizationStatutoryPreferences(db, org.id)).toEqual({
			warningThresholdPercent: 80,
			criticalThresholdPercent: 95,
			blockJarbschgShiftPublish: false,
			applyJarbschgToMinorContractors: false,
			workingStudentDaytimeStartMinute: 360,
			workingStudentDaytimeEndMinute: 1080,
			isDefault: true,
		});
	});

	it("keeps each organization's preferences to itself", async () => {
		const orgA = await fx.organization("a");
		const orgB = await fx.organization("b");
		const adminA = await fx.user("admin-a");

		await saveOrganizationStatutoryPreferences(db, {
			organizationId: orgA.id,
			actorUserId: adminA.userId,
			warningThresholdPercent: 70,
			criticalThresholdPercent: 90,
			blockJarbschgShiftPublish: true,
			applyJarbschgToMinorContractors: false,
			workingStudentDaytimeStartMinute: 360,
			workingStudentDaytimeEndMinute: 1080,
		});
		const saved = await saveOrganizationStatutoryPreferences(db, {
			organizationId: orgA.id,
			actorUserId: adminA.userId,
			warningThresholdPercent: 75,
			criticalThresholdPercent: 90,
			blockJarbschgShiftPublish: true,
			applyJarbschgToMinorContractors: false,
			workingStudentDaytimeStartMinute: 420,
			workingStudentDaytimeEndMinute: 1140,
		});

		// The audit log records what the save replaced.
		expect(saved.previous).toMatchObject({
			warningThresholdPercent: 70,
			workingStudentDaytimeStartMinute: 360,
			workingStudentDaytimeEndMinute: 1080,
			isDefault: false,
		});
		expect(await loadOrganizationStatutoryPreferences(db, orgA.id)).toEqual({
			warningThresholdPercent: 75,
			criticalThresholdPercent: 90,
			blockJarbschgShiftPublish: true,
			applyJarbschgToMinorContractors: false,
			workingStudentDaytimeStartMinute: 420,
			workingStudentDaytimeEndMinute: 1140,
			isDefault: false,
		});
		expect(await loadOrganizationStatutoryPreferences(db, orgB.id)).toMatchObject({
			warningThresholdPercent: 80,
			blockJarbschgShiftPublish: false,
			applyJarbschgToMinorContractors: false,
			workingStudentDaytimeStartMinute: 360,
			workingStudentDaytimeEndMinute: 1080,
			isDefault: true,
		});
	});

	it("stores whether minor contractors are judged under JArbSchG, per organization (#2022)", async () => {
		const orgA = await fx.organization("a");
		const orgB = await fx.organization("b");
		const admin = await fx.user("admin");

		const saved = await saveOrganizationStatutoryPreferences(db, {
			organizationId: orgA.id,
			actorUserId: admin.userId,
			warningThresholdPercent: 80,
			criticalThresholdPercent: 95,
			blockJarbschgShiftPublish: false,
			applyJarbschgToMinorContractors: true,
			workingStudentDaytimeStartMinute: 360,
			workingStudentDaytimeEndMinute: 1080,
		});

		expect(saved.previous).toMatchObject({ applyJarbschgToMinorContractors: false });
		expect(await loadOrganizationStatutoryPreferences(db, orgA.id)).toMatchObject({
			applyJarbschgToMinorContractors: true,
			isDefault: false,
		});
		expect(await loadOrganizationStatutoryPreferences(db, orgB.id)).toMatchObject({
			applyJarbschgToMinorContractors: false,
			isDefault: true,
		});
	});

	it("refuses a daytime band the database would not hold, keeping the stored one", async () => {
		const org = await fx.organization("a");
		const admin = await fx.user("admin");
		const base = {
			organizationId: org.id,
			actorUserId: admin.userId,
			warningThresholdPercent: 80,
			criticalThresholdPercent: 95,
			blockJarbschgShiftPublish: false,
			applyJarbschgToMinorContractors: false,
		};
		await saveOrganizationStatutoryPreferences(db, {
			...base,
			workingStudentDaytimeStartMinute: 420,
			workingStudentDaytimeEndMinute: 1140,
		});

		for (const [start, end, refusal] of [
			[1140, 420, "statutory_daytime_band_start_not_before_end"],
			[425, 1140, "statutory_daytime_band_out_of_range"],
			[420, 1455, "statutory_daytime_band_out_of_range"],
		] as const) {
			const attempt = saveOrganizationStatutoryPreferences(db, {
				...base,
				workingStudentDaytimeStartMinute: start,
				workingStudentDaytimeEndMinute: end,
			});
			await expect(attempt).rejects.toMatchObject({ refusal });
		}
		// The table's own check holds the same rule for writes that bypass the module.
		await expect(
			pool.query(
				`UPDATE organization_statutory_preference SET working_student_daytime_end_minute = 1081 WHERE organization_id = $1`,
				[org.id],
			),
		).rejects.toThrow(/organization_statutory_preference_daytime_band_check/);
		expect(await loadOrganizationStatutoryPreferences(db, org.id)).toMatchObject({
			workingStudentDaytimeStartMinute: 420,
			workingStudentDaytimeEndMinute: 1140,
		});
	});

	it("gives org admins every baseline marked past, current or upcoming plus the preferences", async () => {
		const org = await fx.organization("a");

		const overview = await loadStatutorySettingsOverview(db, {
			organizationId: org.id,
			today: "2026-11-23",
		});

		const caps = overview.baselines
			.filter((row) => row.key === "de_minijob_monthly_limit_cents")
			.map((row) => [row.effectiveFromDate, row.value, row.status]);
		expect(caps.slice(-3)).toEqual([
			["2025-01-01", 55_600, "past"],
			["2026-01-01", 60_300, "current"],
			["2027-01-01", 63_300, "upcoming"],
		]);
		expect(overview.baselines.find((row) => row.key === "de_jarbschg_night_start")).toMatchObject({
			domain: "youth_protection",
			value: 1200,
			unit: "minute_of_day",
			legalReference: "§ 14 Abs. 1 JArbSchG",
			status: "current",
		});
		expect(overview.preferences.isDefault).toBe(true);
	});

	it.each([
		[95, 95, "statutory_warning_not_below_critical"],
		[96, 95, "statutory_warning_not_below_critical"],
		[0, 95, "statutory_percent_out_of_range"],
		[80, 101, "statutory_percent_out_of_range"],
	])("refuses warning %i %% / critical %i %%", async (warning, critical, refusal) => {
		const org = await fx.organization("a");
		const admin = await fx.user("admin");

		const attempt = saveOrganizationStatutoryPreferences(db, {
			organizationId: org.id,
			actorUserId: admin.userId,
			warningThresholdPercent: warning,
			criticalThresholdPercent: critical,
			blockJarbschgShiftPublish: false,
			applyJarbschgToMinorContractors: false,
			workingStudentDaytimeStartMinute: 360,
			workingStudentDaytimeEndMinute: 1080,
		});

		await expect(attempt).rejects.toBeInstanceOf(ValidationError);
		await expect(attempt).rejects.toMatchObject({ refusal });
		expect((await loadOrganizationStatutoryPreferences(db, org.id)).isDefault).toBe(true);
	});
});
