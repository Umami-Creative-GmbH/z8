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
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { loadManualConfirmations } from "@/lib/implementation-checklist/confirmation/load";
import {
	IMPLEMENTATION_CHECKLIST_ITEMS,
	type ImplementationChecklistItemId,
} from "@/lib/implementation-checklist/definition";
import {
	type FirstWorkflowEvidence,
	UNAVAILABLE_FIRST_WORKFLOW_EVIDENCE,
} from "@/lib/implementation-checklist/go-live/first-workflows";
import { loadFirstWorkflowEvidence } from "@/lib/implementation-checklist/go-live/first-workflows-evidence";
import { goLiveFixLinks } from "@/lib/implementation-checklist/go-live/fix-links";
import {
	type GoLiveGroupSettings,
	loadGoLiveGroupSettings,
} from "@/lib/implementation-checklist/go-live/group-settings";
import { resolveGoLiveReadiness } from "@/lib/implementation-checklist/go-live/readiness";
import {
	type GoLiveRehearsalCandidate,
	goLiveRehearsalCandidates,
} from "@/lib/implementation-checklist/go-live/rehearsal-types";
import {
	type GoLiveRun,
	goLiveAsOf,
	runGoLiveChecks,
	unavailableGoLiveRun,
} from "@/lib/implementation-checklist/go-live/run";
import type {
	GoLiveAsOf,
	GoLiveFixLinkResolver,
	GoLiveReadiness,
} from "@/lib/implementation-checklist/go-live/types";
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
		/** Chosen teams and exclusions; null when they could not be loaded. */
		group: GoLiveGroupSettings | null;
		/** Who a go-live rehearsal can be run for: the members checked; empty without a group. */
		rehearsalCandidates: GoLiveRehearsalCandidate[];
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
		// First-workflow evidence, never a presence detector.
		"first-workflows": null,
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
	const [
		detectedCompleteIds,
		{ manualCompleteIds, manualConfirmations },
		{ goLive, firstWorkflows },
	] = await Promise.all([
		detectCompleteIds(organizationId, authContext.user.id),
		loadManualConfirmations(db, organizationId),
		runGoLive(organizationId).then(async (goLive) => ({
			goLive,
			firstWorkflows: await loadFirstWorkflows(organizationId, goLive),
		})),
	]);
	const items = resolveImplementationChecklistItems({
		detectedCompleteIds,
		manualCompleteIds,
		manualConfirmations,
		goLiveResults: goLive.run.results,
		firstWorkflows,
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
				group: goLive.group,
				rehearsalCandidates: goLiveRehearsalCandidates(goLive.run.group?.members ?? []),
			},
		},
	};
}

/**
 * The go-live checks, worked out live for the organization as of now. Callers
 * have already authorized an org admin, so fix links are gated for that tier
 * and the organization's feature flags. A failed lookup is unavailable, never a pass.
 */
async function runGoLive(organizationId: string): Promise<{
	run: GoLiveRun;
	group: GoLiveGroupSettings | null;
	checkedAt: string;
	timezone: string;
	/** Null when the organization could not be loaded. */
	asOf: GoLiveAsOf | null;
}> {
	const instant = systemClock.nowInstant();
	let viewer: GoLiveViewer;
	try {
		viewer = await loadGoLiveViewer(organizationId, instant);
	} catch (error) {
		logger.error({ organizationId, error }, "Go-live checks could not load the organization");
		return {
			run: unavailableGoLiveRun(),
			group: null,
			checkedAt: instant.toString(),
			timezone: "UTC",
			asOf: null,
		};
	}

	const { asOf, fixLink } = viewer;
	const [run, group] = await Promise.all([
		runGoLiveChecks({ db, organizationId, asOf, fixLink }),
		loadGoLiveGroupSettings(db, organizationId, asOf).catch((error: unknown) => {
			logger.error({ organizationId, error }, "Go-live group settings could not be loaded");
			return null;
		}),
	]);
	return { run, group, checkedAt: instant.toString(), timezone: asOf.timezone, asOf };
}

export interface GoLiveViewer {
	asOf: GoLiveAsOf;
	fixLink: GoLiveFixLinkResolver;
}

/**
 * The moment go-live work is done for ("today" in the organization's timezone) and fix links
 * gated for an org admin and the organization's feature flags. Callers have already authorized
 * an org admin. Throws when the organization can't be loaded.
 */
export async function loadGoLiveViewer(
	organizationId: string,
	instant: Instant,
): Promise<GoLiveViewer> {
	const record = await db.query.organization.findFirst({
		where: (organization, { eq: equals }) => equals(organization.id, organizationId),
	});
	if (!record) throw new Error("Organization not found");
	const {
		organizationId: _id,
		timezone: storedTimezone,
		deletedAt: _deletedAt,
		...featureFlags
	} = organizationSettingsForDisplay(record);
	const { timezone } = resolveOrganizationTimezone(storedTimezone);
	return {
		asOf: goLiveAsOf(instant, timezone),
		fixLink: goLiveFixLinks({
			accessTier: "orgAdmin",
			billingEnabled: env.BILLING_ENABLED === "true",
			featureFlags,
		}),
	};
}

/**
 * First-workflow evidence over the same go-live group the checks ran over. It
 * is informational: it never feeds go-live readiness. Without a group there is
 * nothing to look at, so every line is unavailable rather than "not yet".
 */
async function loadFirstWorkflows(
	organizationId: string,
	{ run, asOf }: Awaited<ReturnType<typeof runGoLive>>,
): Promise<FirstWorkflowEvidence> {
	if (!run.group || !asOf) return UNAVAILABLE_FIRST_WORKFLOW_EVIDENCE;
	return loadFirstWorkflowEvidence({ db, organizationId, group: run.group, asOf });
}
