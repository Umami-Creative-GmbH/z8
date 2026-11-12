"use server";

import { Effect } from "effect";
import { z } from "zod";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { NotFoundError } from "@/lib/effect/errors";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import { activeVersionTimeline, type TimelineEntry } from "@/lib/travel-expenses/allowance-policy";
import {
	activateMileagePolicyVersion,
	loadMileagePolicyVersions,
	type MileagePolicyVersionView,
	withdrawMileagePolicyVersion,
} from "@/lib/travel-expenses/allowance-policy-store";
import {
	type MileagePolicyInputErrors,
	type MileagePolicyVersionFormInput,
	parseMileagePolicyVersionInput,
} from "@/lib/travel-expenses/mileage-policy-input";
import {
	STATUTORY_MILEAGE_DEFAULTS,
	type StatutoryMileageDefault,
} from "@/lib/travel-expenses/statutory-allowance-defaults";
import { auditLater, revalidateExpenseSettings } from "./expense-settings-effects";

/**
 * Dated mileage policy of the organization (#606), managed by org admins.
 * Every change is a new immutable version activated in one transaction.
 */

export interface MileagePolicySettings {
	/** Active versions, latest first, with the exclusive end of their coverage. */
	timeline: TimelineEntry<MileagePolicyVersionView>[];
	/** Withdrawn or replaced versions, kept for history. */
	withdrawn: MileagePolicyVersionView[];
	/** Verified statutory defaults that can be adopted. */
	defaults: StatutoryMileageDefault[];
}

export const getMileagePolicySettings = organizationAction(
	{ name: "travelExpenses.getMileagePolicy", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const versions = yield* storeStep(
				"travelExpenses.getMileagePolicy",
				(database) =>
					loadMileagePolicyVersions(database, organizationId, { includeWithdrawn: true }),
				{ failure: "Failed to load the mileage policy" },
			);
			return {
				timeline: activeVersionTimeline(versions),
				withdrawn: versions
					.filter((version) => version.withdrawnAt)
					.toSorted((left, right) =>
						(left.withdrawnAt ?? "") < (right.withdrawnAt ?? "") ? 1 : -1,
					),
				defaults: [...STATUTORY_MILEAGE_DEFAULTS],
			} satisfies MileagePolicySettings;
		}),
);

export type ActivateMileagePolicyOutcome =
	| { status: "activated"; versionId: string }
	| { status: "invalid"; errors: MileagePolicyInputErrors }
	/** Another active version starts that day; the administrator must confirm replacing it. */
	| { status: "start_taken"; existingVersionId: string }
	/** The version to replace changed meanwhile; reload and try again. */
	| { status: "stale_replacement" };

const text = z.string().max(2000).nullable().optional();
const activateSchema = z.object(
	{
		source: z.enum(["organization", "statutory_default"], "Invalid mileage policy"),
		effectiveFrom: text,
		currency: text,
		ratesPerKm: z.object({ car: text, other_motor_vehicle: text }).partial().optional(),
		sourceReference: text,
		sourceVersion: text,
		defaultKey: text,
		note: text,
		replacesVersionId: z.uuid("Invalid mileage policy").nullable().optional(),
	},
	"Invalid mileage policy",
) satisfies z.ZodType<MileagePolicyVersionFormInput>;

export const activateMileagePolicyVersionAction = organizationAction(
	{ name: "travelExpenses.activateMileagePolicy", requires: "orgAdmin", schema: activateSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const parsed = parseMileagePolicyVersionInput(input);
			if (!parsed.ok) {
				return { status: "invalid", errors: parsed.errors } satisfies ActivateMileagePolicyOutcome;
			}
			const result = yield* storeStep(
				"travelExpenses.activateMileagePolicy",
				(database) =>
					activateMileagePolicyVersion(
						database,
						{ organizationId, userId: actor.userId },
						parsed.input,
					),
				{ failure: "Failed to save the mileage policy" },
			);
			if (result.kind !== "activated") {
				return (
					result.kind === "start_taken"
						? { status: "start_taken", existingVersionId: result.existingVersionId }
						: { status: "stale_replacement" }
				) satisfies ActivateMileagePolicyOutcome;
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
							kind: "mileage",
							effectiveFrom: parsed.input.effectiveFrom,
							currency: parsed.input.currency,
							ratesPerKm: parsed.input.ratesPerKm,
							source: parsed.input.source,
							replacesVersionId: parsed.input.replacesVersionId,
						},
						timestamp: new Date(),
					}),
				"Failed to log mileage policy activation",
			);
			yield* revalidateExpenseSettings();
			return {
				status: "activated",
				versionId: result.versionId,
			} satisfies ActivateMileagePolicyOutcome;
		}),
);

export const withdrawMileagePolicyVersionAction = organizationAction(
	{
		name: "travelExpenses.withdrawMileagePolicy",
		requires: "orgAdmin",
		schema: z.strictObject({ versionId: z.uuid("Mileage policy version not found") }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const result = yield* storeStep(
				"travelExpenses.withdrawMileagePolicy",
				(database) =>
					withdrawMileagePolicyVersion(
						database,
						{ organizationId, userId: actor.userId },
						{ versionId: input.versionId },
					),
				{ failure: "Failed to withdraw the mileage policy version" },
			);
			if (result.kind === "not_found") {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Mileage policy version not found",
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
						metadata: { kind: "mileage" },
						timestamp: new Date(),
					}),
				"Failed to log mileage policy withdrawal",
			);
			yield* revalidateExpenseSettings();
			return { versionId: input.versionId };
		}),
);
