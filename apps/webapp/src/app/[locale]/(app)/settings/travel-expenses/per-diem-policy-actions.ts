"use server";

import { Effect } from "effect";
import { z } from "zod";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { NotFoundError } from "@/lib/effect/errors";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import { activeVersionTimeline, type TimelineEntry } from "@/lib/travel-expenses/allowance-policy";
import {
	type PerDiemPolicyInputErrors,
	type PerDiemPolicyVersionFormInput,
	parsePerDiemPolicyVersionInput,
} from "@/lib/travel-expenses/per-diem-policy-input";
import {
	activatePerDiemPolicyVersion,
	loadPerDiemPolicyVersions,
	type PerDiemPolicyVersionView,
	withdrawPerDiemPolicyVersion,
} from "@/lib/travel-expenses/per-diem-policy-store";
import {
	GERMAN_DOMESTIC_PER_DIEM_RULES,
	type PerDiemRuleSet,
	STATUTORY_PER_DIEM_DEFAULTS,
	type StatutoryPerDiemDefault,
} from "@/lib/travel-expenses/statutory-per-diem-defaults";
import { auditLater, revalidateExpenseSettings } from "./expense-settings-effects";

/**
 * Dated per diem policy of the organization (#609), managed by org admins.
 * Every change is a new immutable version activated in one transaction;
 * nothing is adopted automatically.
 */

export interface PerDiemPolicySettings {
	timeline: TimelineEntry<PerDiemPolicyVersionView>[];
	withdrawn: PerDiemPolicyVersionView[];
	defaults: StatutoryPerDiemDefault[];
	/** The verified rule edition calculations use, for display. */
	rules: PerDiemRuleSet;
}

export const getPerDiemPolicySettings = organizationAction(
	{ name: "travelExpenses.getPerDiemPolicy", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const versions = yield* storeStep(
				"travelExpenses.getPerDiemPolicy",
				(database) =>
					loadPerDiemPolicyVersions(database, organizationId, { includeWithdrawn: true }),
				{ failure: "Failed to load the per diem policy" },
			);
			return {
				timeline: activeVersionTimeline(versions),
				withdrawn: versions
					.filter((version) => version.withdrawnAt)
					.toSorted((left, right) =>
						(left.withdrawnAt ?? "") < (right.withdrawnAt ?? "") ? 1 : -1,
					),
				defaults: [...STATUTORY_PER_DIEM_DEFAULTS],
				rules: GERMAN_DOMESTIC_PER_DIEM_RULES,
			} satisfies PerDiemPolicySettings;
		}),
);

export type ActivatePerDiemPolicyOutcome =
	| { status: "activated"; versionId: string }
	| { status: "invalid"; errors: PerDiemPolicyInputErrors }
	| { status: "start_taken"; existingVersionId: string }
	| { status: "stale_replacement" };

const text = z.string().max(2000).nullable().optional();
const activateSchema = z.object(
	{
		source: z.enum(["organization", "statutory_default"], "Invalid per diem policy"),
		effectiveFrom: text,
		currency: text,
		rates: z
			.object({
				fullDay: text,
				partialDay: text,
				breakfastDeduction: text,
				lunchDeduction: text,
				dinnerDeduction: text,
			})
			.partial()
			.optional(),
		sourceReference: text,
		sourceVersion: text,
		defaultKey: text,
		note: text,
		replacesVersionId: z.uuid("Invalid per diem policy").nullable().optional(),
	},
	"Invalid per diem policy",
) satisfies z.ZodType<PerDiemPolicyVersionFormInput>;

export const activatePerDiemPolicyVersionAction = organizationAction(
	{ name: "travelExpenses.activatePerDiemPolicy", requires: "orgAdmin", schema: activateSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const parsed = parsePerDiemPolicyVersionInput(input);
			if (!parsed.ok) {
				return { status: "invalid", errors: parsed.errors } satisfies ActivatePerDiemPolicyOutcome;
			}
			const result = yield* storeStep(
				"travelExpenses.activatePerDiemPolicy",
				(database) =>
					activatePerDiemPolicyVersion(
						database,
						{ organizationId, userId: actor.userId },
						parsed.input,
					),
				{ failure: "Failed to save the per diem policy" },
			);
			if (result.kind !== "activated") {
				return (
					result.kind === "start_taken"
						? { status: "start_taken", existingVersionId: result.existingVersionId }
						: { status: "stale_replacement" }
				) satisfies ActivatePerDiemPolicyOutcome;
			}
			yield* auditLater(
				() =>
					logAudit({
						action: AuditAction.TRAVEL_EXPENSE_POLICY_VERSION_ACTIVATED,
						actorId: actor.userId,
						employeeId: actor.employee?.id,
						targetId: result.versionId,
						targetType: "travel_expense_policy_version",
						organizationId,
						metadata: {
							kind: "per_diem",
							effectiveFrom: parsed.input.effectiveFrom,
							currency: parsed.input.currency,
							rates: parsed.input.rates,
							source: parsed.input.source,
							replacesVersionId: parsed.input.replacesVersionId,
						},
						timestamp: new Date(),
					}),
				"Failed to log per diem policy activation",
			);
			yield* revalidateExpenseSettings();
			return {
				status: "activated",
				versionId: result.versionId,
			} satisfies ActivatePerDiemPolicyOutcome;
		}),
);

export const withdrawPerDiemPolicyVersionAction = organizationAction(
	{
		name: "travelExpenses.withdrawPerDiemPolicy",
		requires: "orgAdmin",
		schema: z.strictObject({ versionId: z.uuid("Per diem policy version not found") }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const result = yield* storeStep(
				"travelExpenses.withdrawPerDiemPolicy",
				(database) =>
					withdrawPerDiemPolicyVersion(
						database,
						{ organizationId, userId: actor.userId },
						{ versionId: input.versionId },
					),
				{ failure: "Failed to withdraw the per diem policy version" },
			);
			if (result.kind === "not_found") {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Per diem policy version not found",
						entityType: "travel_expense_policy_version",
						entityId: input.versionId,
					}),
				);
			}
			yield* auditLater(
				() =>
					logAudit({
						action: AuditAction.TRAVEL_EXPENSE_POLICY_VERSION_WITHDRAWN,
						actorId: actor.userId,
						employeeId: actor.employee?.id,
						targetId: input.versionId,
						targetType: "travel_expense_policy_version",
						organizationId,
						metadata: { kind: "per_diem" },
						timestamp: new Date(),
					}),
				"Failed to log per diem policy withdrawal",
			);
			yield* revalidateExpenseSettings();
			return { versionId: input.versionId };
		}),
);
