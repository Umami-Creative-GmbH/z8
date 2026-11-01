import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
	discordBotConfig,
	employee,
	holiday,
	holidayAssignment,
	holidayPresetAssignment,
	notificationPreference,
	slackWorkspaceConfig,
	teamsTenantConfig,
	telegramBotConfig,
	webhookEndpoint,
} from "@/db/schema";
import { env } from "@/env";
import { organizationSettingsForDisplay } from "@/lib/auth/organization-display";
import type { AuthContext } from "@/lib/auth-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import { loadManualConfirmations } from "@/lib/implementation-checklist/confirmation/load";
import {
	IMPLEMENTATION_CHECKLIST_ITEMS,
	type ImplementationChecklistItemId,
} from "@/lib/implementation-checklist/definition";
import { goLiveFixLinks } from "@/lib/implementation-checklist/go-live/fix-links";
import { resolveGoLiveReadiness } from "@/lib/implementation-checklist/go-live/readiness";
import {
	type GoLiveRun,
	goLiveAsOf,
	runGoLiveChecks,
	unavailableGoLiveRun,
} from "@/lib/implementation-checklist/go-live/run";
import type { GoLiveReadiness } from "@/lib/implementation-checklist/go-live/types";
import {
	type ResolvedImplementationChecklistItem,
	resolveImplementationChecklistItems,
	summarizeImplementationChecklist,
} from "@/lib/implementation-checklist/status";
import { createLogger } from "@/lib/logger";
import { resolveOrganizationTimezone } from "@/lib/timezone/resolve-timezone";

const logger = createLogger("ImplementationChecklist");

export interface ImplementationChecklistViewModel {
	items: ResolvedImplementationChecklistItem[];
	completedCount: number;
	totalCount: number;
	goLive: {
		readiness: GoLiveReadiness;
		/** When the go-live checks ran, as an ISO instant. */
		checkedAt: string;
		/** The organization's timezone, for showing `checkedAt`. */
		timezone: string;
		/** How many members the go-live group has; null when it could not be resolved. */
		memberCount: number | null;
	};
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
		// A go-live check, never a presence detector: settings alone don't verify it.
		"work-policies": null,
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

export async function loadImplementationChecklistForContext({
	authContext,
	organizationId,
}: ImplementationChecklistLoaderContext): Promise<
	ImplementationChecklistActionResult<ImplementationChecklistViewModel>
> {
	const [detectedCompleteIds, { manualCompleteIds, manualConfirmations }, goLive] =
		await Promise.all([
			detectCompleteIds(organizationId, authContext.user.id),
			loadManualConfirmations(db, organizationId),
			runGoLive(organizationId),
		]);
	const items = resolveImplementationChecklistItems({
		detectedCompleteIds,
		manualCompleteIds,
		manualConfirmations,
		goLiveResults: goLive.run.results,
	});

	return {
		success: true,
		data: {
			items,
			...summarizeImplementationChecklist(items),
			goLive: {
				readiness: resolveGoLiveReadiness(goLive.run.results),
				checkedAt: goLive.checkedAt,
				timezone: goLive.timezone,
				memberCount: goLive.run.memberCount,
			},
		},
	};
}

/**
 * The go-live checks, worked out live for the organization as of now. Callers
 * have already authorized an org admin, so fix links are gated for that tier
 * and the organization's feature flags. A failed lookup is unavailable, never a pass.
 */
async function runGoLive(
	organizationId: string,
): Promise<{ run: GoLiveRun; checkedAt: string; timezone: string }> {
	const instant = systemClock.nowInstant();
	let settings: ReturnType<typeof organizationSettingsForDisplay>;
	try {
		const record = await db.query.organization.findFirst({
			where: (organization, { eq: equals }) => equals(organization.id, organizationId),
		});
		if (!record) throw new Error("Organization not found");
		settings = organizationSettingsForDisplay(record);
	} catch (error) {
		logger.error({ organizationId, error }, "Go-live checks could not load the organization");
		return { run: unavailableGoLiveRun(), checkedAt: instant.toString(), timezone: "UTC" };
	}

	const {
		organizationId: _id,
		timezone: storedTimezone,
		deletedAt: _deletedAt,
		...featureFlags
	} = settings;
	const { timezone } = resolveOrganizationTimezone(storedTimezone);
	const run = await runGoLiveChecks({
		db,
		organizationId,
		asOf: goLiveAsOf(instant, timezone),
		fixLink: goLiveFixLinks({
			accessTier: "orgAdmin",
			billingEnabled: env.BILLING_ENABLED === "true",
			featureFlags,
		}),
	});
	return { run, checkedAt: instant.toString(), timezone };
}
