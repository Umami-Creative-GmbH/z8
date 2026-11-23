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

describe("organization statutory preferences (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const fx = statutoryFixture(integrationAdminPool(), "t1988-prefs");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	it("defaults to 80 % warning, 95 % critical and no publish block", async () => {
		const org = await fx.organization("a");

		expect(await loadOrganizationStatutoryPreferences(db, org.id)).toEqual({
			warningThresholdPercent: 80,
			criticalThresholdPercent: 95,
			blockJarbschgShiftPublish: false,
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
		});
		await saveOrganizationStatutoryPreferences(db, {
			organizationId: orgA.id,
			actorUserId: adminA.userId,
			warningThresholdPercent: 75,
			criticalThresholdPercent: 90,
			blockJarbschgShiftPublish: true,
		});

		expect(await loadOrganizationStatutoryPreferences(db, orgA.id)).toEqual({
			warningThresholdPercent: 75,
			criticalThresholdPercent: 90,
			blockJarbschgShiftPublish: true,
			isDefault: false,
		});
		expect(await loadOrganizationStatutoryPreferences(db, orgB.id)).toMatchObject({
			warningThresholdPercent: 80,
			blockJarbschgShiftPublish: false,
			isDefault: true,
		});
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
		});

		await expect(attempt).rejects.toBeInstanceOf(ValidationError);
		await expect(attempt).rejects.toMatchObject({ refusal });
		expect((await loadOrganizationStatutoryPreferences(db, org.id)).isDefault).toBe(true);
	});
});
