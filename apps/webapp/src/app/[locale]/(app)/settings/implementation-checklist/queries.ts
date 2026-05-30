import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
	discordBotConfig,
	employee,
	holiday,
	holidayAssignment,
	holidayPresetAssignment,
	implementationChecklistManualState,
	notificationPreference,
	slackWorkspaceConfig,
	teamsTenantConfig,
	telegramBotConfig,
	webhookEndpoint,
	workPolicy,
	workPolicyAssignment,
} from "@/db/schema";
import type { AuthContext } from "@/lib/auth-helpers";
import {
	IMPLEMENTATION_CHECKLIST_ITEMS,
	type ImplementationChecklistItemId,
} from "@/lib/implementation-checklist/definition";
import {
	type ResolvedImplementationChecklistItem,
	resolveImplementationChecklistItems,
} from "@/lib/implementation-checklist/status";

export interface ImplementationChecklistViewModel {
	items: ResolvedImplementationChecklistItem[];
	completedCount: number;
	totalCount: number;
}

type ImplementationChecklistActionFailure = { success: false; error: string };
type ImplementationChecklistMutationSuccess = { success: true };
type ImplementationChecklistQuerySuccess<T> = { success: true; data: T };

export type ImplementationChecklistActionResult<T = void> = [T] extends [undefined]
	? ImplementationChecklistMutationSuccess | ImplementationChecklistActionFailure
	: ImplementationChecklistQuerySuccess<T> | ImplementationChecklistActionFailure;

type Detector = () => Promise<boolean>;

export interface ImplementationChecklistLoaderContext {
	authContext: AuthContext;
	organizationId: string;
}

async function detectorComplete(detector: Detector): Promise<boolean> {
	try {
		return await detector();
	} catch {
		return false;
	}
}

async function hasActiveIntegration(organizationId: string): Promise<boolean> {
	return detectorComplete(async () => {
		const [slack, discord, teams, telegram, webhook] = await Promise.all([
			db.query.slackWorkspaceConfig.findFirst({
				where: and(
					eq(slackWorkspaceConfig.organizationId, organizationId),
					eq(slackWorkspaceConfig.setupStatus, "active"),
				),
			}),
			db.query.discordBotConfig.findFirst({
				where: and(
					eq(discordBotConfig.organizationId, organizationId),
					eq(discordBotConfig.setupStatus, "active"),
				),
			}),
			db.query.teamsTenantConfig.findFirst({
				where: and(
					eq(teamsTenantConfig.organizationId, organizationId),
					eq(teamsTenantConfig.setupStatus, "active"),
				),
			}),
			db.query.telegramBotConfig.findFirst({
				where: and(
					eq(telegramBotConfig.organizationId, organizationId),
					eq(telegramBotConfig.setupStatus, "active"),
				),
			}),
			db.query.webhookEndpoint.findFirst({
				where: and(
					eq(webhookEndpoint.organizationId, organizationId),
					eq(webhookEndpoint.isActive, true),
				),
			}),
		]);

		return Boolean(slack || discord || teams || telegram || webhook);
	});
}

async function detectCompleteIds(
	organizationId: string,
	currentUserId: string,
): Promise<Set<ImplementationChecklistItemId>> {
	const detectedCompleteIds = new Set<ImplementationChecklistItemId>();
	const activeIntegration = hasActiveIntegration(organizationId);

	const detectors: Record<ImplementationChecklistItemId, Promise<boolean> | null> = {
		"organization-structure": null,
		holidays: detectorComplete(async () => {
			const [customHoliday, holidayPreset, assignedHoliday] = await Promise.all([
				db.query.holiday.findFirst({
					where: and(eq(holiday.organizationId, organizationId), eq(holiday.isActive, true)),
				}),
				db.query.holidayPresetAssignment.findFirst({
					where: and(
						eq(holidayPresetAssignment.organizationId, organizationId),
						eq(holidayPresetAssignment.isActive, true),
					),
				}),
				db.query.holidayAssignment.findFirst({
					where: and(
						eq(holidayAssignment.organizationId, organizationId),
						eq(holidayAssignment.isActive, true),
					),
				}),
			]);

			return Boolean(customHoliday || holidayPreset || assignedHoliday);
		}),
		"work-policies": detectorComplete(async () => {
			const [policy, assignment] = await Promise.all([
				db.query.workPolicy.findFirst({
					where: and(eq(workPolicy.organizationId, organizationId), eq(workPolicy.isActive, true)),
				}),
				db.query.workPolicyAssignment.findFirst({
					where: and(
						eq(workPolicyAssignment.organizationId, organizationId),
						eq(workPolicyAssignment.isActive, true),
					),
				}),
			]);

			return Boolean(policy || assignment);
		}),
		"approval-rules": null,
		"payroll-readiness": null,
		integrations: activeIntegration,
		notifications: detectorComplete(async () => {
			const preference = await db.query.notificationPreference.findFirst({
				where: and(
					eq(notificationPreference.organizationId, organizationId),
					eq(notificationPreference.enabled, true),
				),
			});

			return Boolean(preference || (await activeIntegration));
		}),
		"employee-import": detectorComplete(async () => {
			const activeImportedEmployee = await db.query.employee.findFirst({
				where: and(
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
					ne(employee.userId, currentUserId),
				),
			});

			return Boolean(activeImportedEmployee);
		}),
	};

	await Promise.all(
		IMPLEMENTATION_CHECKLIST_ITEMS.map(async (item) => {
			if (item.detector !== "automatic") {
				return;
			}

			const detector = detectors[item.id];

			if (detector && (await detector)) {
				detectedCompleteIds.add(item.id);
			}
		}),
	);

	return detectedCompleteIds;
}

async function loadManualCompleteIds(
	organizationId: string,
): Promise<Set<ImplementationChecklistItemId>> {
	const manualCompleteIds = new Set<ImplementationChecklistItemId>();
	await Promise.all(
		IMPLEMENTATION_CHECKLIST_ITEMS.map(async (item) => {
			if (!item.canManualComplete) {
				return;
			}

			const manualState = await db.query.implementationChecklistManualState.findFirst({
				where: and(
					eq(implementationChecklistManualState.organizationId, organizationId),
					eq(implementationChecklistManualState.itemId, item.id),
					eq(implementationChecklistManualState.status, "complete"),
				),
			});

			if (manualState) {
				manualCompleteIds.add(item.id);
			}
		}),
	);

	return manualCompleteIds;
}

export async function loadImplementationChecklistForContext({
	authContext,
	organizationId,
}: ImplementationChecklistLoaderContext): Promise<
	ImplementationChecklistActionResult<ImplementationChecklistViewModel>
> {
	const [detectedCompleteIds, manualCompleteIds] = await Promise.all([
		detectCompleteIds(organizationId, authContext.user.id),
		loadManualCompleteIds(organizationId),
	]);
	const items = resolveImplementationChecklistItems({ detectedCompleteIds, manualCompleteIds });

	return {
		success: true,
		data: {
			items,
			completedCount: items.filter((item) => item.status === "complete").length,
			totalCount: items.length,
		},
	};
}
