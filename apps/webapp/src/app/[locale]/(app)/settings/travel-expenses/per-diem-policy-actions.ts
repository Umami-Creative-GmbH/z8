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

/**
 * Dated per diem policy of the organization (#609), managed by expense
 * administrators (`canManageCurrentOrganizationSettings`). Every change is a
 * new immutable version activated in one transaction; nothing is adopted
 * automatically.
 */

export interface PerDiemPolicySettings {
	timeline: TimelineEntry<PerDiemPolicyVersionView>[];
	withdrawn: PerDiemPolicyVersionView[];
	defaults: StatutoryPerDiemDefault[];
	/** The verified rule edition calculations use, for display. */
	rules: PerDiemRuleSet;
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

export async function getPerDiemPolicySettings(): Promise<
	ServerActionResult<PerDiemPolicySettings>
> {
	try {
		const access = await requireExpenseAdmin();
		if ("error" in access) return { success: false, error: access.error };
		const versions = await loadPerDiemPolicyVersions(db, access.organizationId, {
			includeWithdrawn: true,
		});
		return {
			success: true,
			data: {
				timeline: activeVersionTimeline(versions),
				withdrawn: versions
					.filter((version) => version.withdrawnAt)
					.toSorted((left, right) =>
						(left.withdrawnAt ?? "") < (right.withdrawnAt ?? "") ? 1 : -1,
					),
				defaults: [...STATUTORY_PER_DIEM_DEFAULTS],
				rules: GERMAN_DOMESTIC_PER_DIEM_RULES,
			},
		};
	} catch (error) {
		logger.error({ error }, "Failed to load the per diem policy");
		return { success: false, error: "Failed to load the per diem policy" };
	}
}

export type ActivatePerDiemPolicyOutcome =
	| { status: "activated"; versionId: string }
	| { status: "invalid"; errors: PerDiemPolicyInputErrors }
	| { status: "start_taken"; existingVersionId: string }
	| { status: "stale_replacement" };

const text = z.string().max(2000).nullable().optional();
const activateSchema = z.object({
	source: z.enum(["organization", "statutory_default"]),
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
	replacesVersionId: z.uuid().nullable().optional(),
});

export async function activatePerDiemPolicyVersionAction(
	input: PerDiemPolicyVersionFormInput,
): Promise<ServerActionResult<ActivatePerDiemPolicyOutcome>> {
	try {
		const access = await requireExpenseAdmin();
		if ("error" in access) return { success: false, error: access.error };
		const shape = activateSchema.safeParse(input);
		if (!shape.success) return { success: false, error: "Invalid per diem policy" };
		const parsed = parsePerDiemPolicyVersionInput(shape.data);
		if (!parsed.ok) return { success: true, data: { status: "invalid", errors: parsed.errors } };
		const result = await activatePerDiemPolicyVersion(
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
				kind: "per_diem",
				effectiveFrom: parsed.input.effectiveFrom,
				currency: parsed.input.currency,
				rates: parsed.input.rates,
				source: parsed.input.source,
				replacesVersionId: parsed.input.replacesVersionId,
			},
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log per diem policy activation"));
		revalidatePath("/settings/travel-expenses");
		return { success: true, data: { status: "activated", versionId: result.versionId } };
	} catch (error) {
		logger.error({ error }, "Failed to activate the per diem policy version");
		return { success: false, error: "Failed to save the per diem policy" };
	}
}

export async function withdrawPerDiemPolicyVersionAction(input: {
	versionId: string;
}): Promise<ServerActionResult<{ versionId: string }>> {
	try {
		const access = await requireExpenseAdmin();
		if ("error" in access) return { success: false, error: access.error };
		if (!z.uuid().safeParse(input.versionId).success) {
			return { success: false, error: "Per diem policy version not found" };
		}
		const result = await withdrawPerDiemPolicyVersion(
			db,
			{ organizationId: access.organizationId, userId: access.userId },
			{ versionId: input.versionId },
		);
		if (result.kind === "not_found") {
			return { success: false, error: "Per diem policy version not found" };
		}
		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_POLICY_VERSION_WITHDRAWN,
			actorId: access.userId,
			employeeId: access.employeeId ?? undefined,
			targetId: input.versionId,
			targetType: "travel_expense_policy_version",
			organizationId: access.organizationId,
			metadata: { kind: "per_diem" },
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log per diem policy withdrawal"));
		revalidatePath("/settings/travel-expenses");
		return { success: true, data: { versionId: input.versionId } };
	} catch (error) {
		logger.error({ error }, "Failed to withdraw the per diem policy version");
		return { success: false, error: "Failed to withdraw the per diem policy version" };
	}
}
