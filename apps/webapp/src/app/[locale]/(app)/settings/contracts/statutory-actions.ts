"use server";

import { Effect } from "effect";
import { z } from "zod";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import { isWorkingStudentDaytimeMinute } from "@/lib/statutory/daytime-band";
import {
	type StatutoryPreferences,
	saveOrganizationStatutoryPreferences,
} from "@/lib/statutory/preferences";
import { loadStatutorySettingsOverview } from "@/lib/statutory/settings-overview";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

// German statutory baselines (read-only) and organization warning settings (#1988), with the
// working-student weekday daytime band (#2017) and whether minor contractors are judged under
// JArbSchG (#2022).
// Org admins only: the overview includes EUR baselines such as the Minijob cap.

const percentSchema = z.number().int().min(1).max(100);
const daytimeMinuteSchema = z.number().refine(isWorkingStudentDaytimeMinute, {
	message: "Use whole quarter hours from 00:00 to 24:00",
});

const updateStatutoryPreferencesSchema = z
	.strictObject({
		warningThresholdPercent: percentSchema,
		criticalThresholdPercent: percentSchema,
		blockJarbschgShiftPublish: z.boolean(),
		applyJarbschgToMinorContractors: z.boolean(),
		workingStudentDaytimeStartMinute: daytimeMinuteSchema,
		workingStudentDaytimeEndMinute: daytimeMinuteSchema,
	})
	.refine((input) => input.warningThresholdPercent < input.criticalThresholdPercent, {
		message: "The warning percentage must be below the critical percentage",
		path: ["warningThresholdPercent"],
	})
	.refine(
		(input) => input.workingStudentDaytimeStartMinute < input.workingStudentDaytimeEndMinute,
		{
			message: "The daytime band must start before it ends",
			path: ["workingStudentDaytimeStartMinute"],
		},
	);

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

function preferenceFields(preferences: StatutoryPreferences): StatutoryPreferences {
	return {
		warningThresholdPercent: preferences.warningThresholdPercent,
		criticalThresholdPercent: preferences.criticalThresholdPercent,
		blockJarbschgShiftPublish: preferences.blockJarbschgShiftPublish,
		applyJarbschgToMinorContractors: preferences.applyJarbschgToMinorContractors,
		workingStudentDaytimeStartMinute: preferences.workingStudentDaytimeStartMinute,
		workingStudentDaytimeEndMinute: preferences.workingStudentDaytimeEndMinute,
	};
}

export const updateStatutoryPreferencesAction = organizationAction(
	{
		name: "contracts.updateStatutoryPreferences",
		requires: "orgAdmin",
		schema: updateStatutoryPreferencesSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { previous, ...saved } = yield* storeStep(
				"contracts.updateStatutoryPreferences",
				(db) =>
					saveOrganizationStatutoryPreferences(db, {
						organizationId,
						actorUserId: actor.userId,
						...input,
					}),
			);
			// Every change is audited with what it replaced; `logAudit` never throws.
			yield* Effect.promise(() =>
				logAudit({
					action: AuditAction.STATUTORY_PREFERENCES_UPDATED,
					actorId: actor.userId,
					employeeId: actor.employee?.id,
					targetId: organizationId,
					targetType: "organization",
					organizationId,
					changes: { before: preferenceFields(previous), after: preferenceFields(saved) },
					metadata: { setting: "statutory_preferences", previousWasDefault: previous.isDefault },
					timestamp: new Date(),
				}),
			);
			return saved;
		}),
);
