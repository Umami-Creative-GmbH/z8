"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { canManageCurrentOrganizationSettings, getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
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

/**
 * Dated mileage policy of the organization (#606), managed by expense
 * administrators (`canManageCurrentOrganizationSettings`). Every change is a
 * new immutable version activated in one transaction.
 */

export interface MileagePolicySettings {
	/** Active versions, latest first, with the exclusive end of their coverage. */
	timeline: TimelineEntry<MileagePolicyVersionView>[];
	/** Withdrawn or replaced versions, kept for history. */
	withdrawn: MileagePolicyVersionView[];
	/** Verified statutory defaults that can be adopted. */
	defaults: StatutoryMileageDefault[];
}

async function requireExpenseAdmin(): Promise<
	{ error: string } | { organizationId: string; userId: string; employeeId: string | null }
> {
	const authContext = await getAuthContext();
	const organizationId = authContext?.session.activeOrganizationId;
	if (!authContext) return { error: "Unauthorized: Admin access required" };
	if (!organizationId) return { error: "No organization selected" };
	if (!(await canManageCurrentOrganizationSettings())) {
		return { error: "Unauthorized: Admin access required" };
	}
	return {
		organizationId,
		userId: authContext.user.id,
		employeeId: authContext.employee?.id ?? null,
	};
}

export async function getMileagePolicySettings(): Promise<
	ServerActionResult<MileagePolicySettings>
> {
	try {
		const access = await requireExpenseAdmin();
		if ("error" in access) return { success: false, error: access.error };
		const versions = await loadMileagePolicyVersions(db, access.organizationId, {
			includeWithdrawn: true,
		});
		return {
			success: true,
			data: {
				timeline: activeVersionTimeline(versions),
				withdrawn: versions
					.filter((version) => version.withdrawnAt)
					.toSorted((left, right) => (left.withdrawnAt ?? "") < (right.withdrawnAt ?? "") ? 1 : -1),
				defaults: [...STATUTORY_MILEAGE_DEFAULTS],
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to load the mileage policy");
		return { success: false, error: "Failed to load the mileage policy" };
	}
}

export type ActivateMileagePolicyOutcome =
	| { status: "activated"; versionId: string }
	| { status: "invalid"; errors: MileagePolicyInputErrors }
	/** Another active version starts that day; the administrator must confirm replacing it. */
	| { status: "start_taken"; existingVersionId: string }
	/** The version to replace changed meanwhile; reload and try again. */
	| { status: "stale_replacement" };

const text = z.string().max(2000).nullable().optional();
const activateSchema = z.object({
	source: z.enum(["organization", "statutory_default"]),
	effectiveFrom: text,
	currency: text,
	ratesPerKm: z.object({ car: text, other_motor_vehicle: text }).partial().optional(),
	sourceReference: text,
	sourceVersion: text,
	defaultKey: text,
	note: text,
	replacesVersionId: z.uuid().nullable().optional(),
});

export async function activateMileagePolicyVersionAction(
	input: MileagePolicyVersionFormInput,
): Promise<ServerActionResult<ActivateMileagePolicyOutcome>> {
	try {
		const access = await requireExpenseAdmin();
		if ("error" in access) return { success: false, error: access.error };
		const shape = activateSchema.safeParse(input);
		if (!shape.success) return { success: false, error: "Invalid mileage policy" };
		const parsed = parseMileagePolicyVersionInput(shape.data);
		if (!parsed.ok) return { success: true, data: { status: "invalid", errors: parsed.errors } };
		const result = await activateMileagePolicyVersion(
			db,
			{ organizationId: access.organizationId, userId: access.userId },
			parsed.input,
		);
		if (result.kind !== "activated") {
			return {
				success: true,
				data:
					result.kind === "start_taken"
						? { status: "start_taken", existingVersionId: result.existingVersionId }
						: { status: "stale_replacement" },
			};
		}
		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_POLICY_VERSION_ACTIVATED,
			actorId: access.userId,
			employeeId: access.employeeId ?? undefined,
			targetId: result.versionId,
			targetType: "travel_expense_policy_version",
			organizationId: access.organizationId,
			metadata: {
				kind: "mileage",
				effectiveFrom: parsed.input.effectiveFrom,
				currency: parsed.input.currency,
				ratesPerKm: parsed.input.ratesPerKm,
				source: parsed.input.source,
				replacesVersionId: parsed.input.replacesVersionId,
			},
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log mileage policy activation"));
		revalidatePath("/settings/travel-expenses");
		return { success: true, data: { status: "activated", versionId: result.versionId } };
	} catch (error) {
		logger.error({ error }, "Failed to activate the mileage policy version");
		return { success: false, error: "Failed to save the mileage policy" };
	}
}

export async function withdrawMileagePolicyVersionAction(input: {
	versionId: string;
}): Promise<ServerActionResult<{ versionId: string }>> {
	try {
		const access = await requireExpenseAdmin();
		if ("error" in access) return { success: false, error: access.error };
		if (!z.uuid().safeParse(input.versionId).success) {
			return { success: false, error: "Mileage policy version not found" };
		}
		const result = await withdrawMileagePolicyVersion(
			db,
			{ organizationId: access.organizationId, userId: access.userId },
			{ versionId: input.versionId },
		);
		if (result.kind === "not_found") {
			return { success: false, error: "Mileage policy version not found" };
		}
		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_POLICY_VERSION_WITHDRAWN,
			actorId: access.userId,
			employeeId: access.employeeId ?? undefined,
			targetId: input.versionId,
			targetType: "travel_expense_policy_version",
			organizationId: access.organizationId,
			metadata: { kind: "mileage" },
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log mileage policy withdrawal"));
		revalidatePath("/settings/travel-expenses");
		return { success: true, data: { versionId: input.versionId } };
	} catch (error) {
		logger.error({ error }, "Failed to withdraw the mileage policy version");
		return { success: false, error: "Failed to withdraw the mileage policy version" };
	}
}
