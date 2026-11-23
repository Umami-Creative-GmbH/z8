"use server";

import { z } from "zod";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import { saveOrganizationStatutoryPreferences } from "@/lib/statutory/preferences";
import { loadStatutorySettingsOverview } from "@/lib/statutory/settings-overview";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

// German statutory baselines (read-only) and organization warning settings (#1988).
// Org admins only: the overview includes EUR baselines such as the Minijob cap.

const percentSchema = z.number().int().min(1).max(100);

const updateStatutoryPreferencesSchema = z
	.strictObject({
		warningThresholdPercent: percentSchema,
		criticalThresholdPercent: percentSchema,
		blockJarbschgShiftPublish: z.boolean(),
	})
	.refine((input) => input.warningThresholdPercent < input.criticalThresholdPercent, {
		message: "The warning percentage must be below the critical percentage",
		path: ["warningThresholdPercent"],
	});

export const getStatutorySettingsAction = organizationAction(
	{ name: "contracts.getStatutorySettings", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		storeStep("contracts.getStatutorySettings", async (db) => {
			const timezone = await loadOrganizationTimezone(db, organizationId);
			return loadStatutorySettingsOverview(db, {
				organizationId,
				today: plainDateAt(systemClock.nowInstant(), timezone).toString(),
			});
		}),
);

export const updateStatutoryPreferencesAction = organizationAction(
	{
		name: "contracts.updateStatutoryPreferences",
		requires: "orgAdmin",
		schema: updateStatutoryPreferencesSchema,
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.updateStatutoryPreferences", (db) =>
			saveOrganizationStatutoryPreferences(db, {
				organizationId,
				actorUserId: actor.userId,
				...input,
			}),
		),
);
