import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { workPeriod } from "@/db/schema";
import { vehicleUseWarningBotText } from "@/lib/approvals/presentation/vehicle-use-warning-text";
import { type BotTranslateFn, getBotTranslate, getUserLocale } from "@/lib/bot-platform/i18n";
import type { BotCommandResponse } from "@/lib/bot-platform/types";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import { describeAmendmentFailure } from "@/lib/time-tracking/amend-completed-work";
import { completeClockOutVehicleUse } from "@/lib/time-tracking/vehicle-use/clock-out-completion-store";
import { loadWorkVehicleUseFormContext } from "@/lib/time-tracking/vehicle-use/form-context";
import { changeLiveWorkVehicleUse } from "@/lib/time-tracking/vehicle-use/live-vehicle-use";
import { checkWorkVehicleUsePlausibility } from "@/lib/time-tracking/vehicle-use/plausibility-check";
import {
	buildWorkVehicleUse,
	organizationVehicleIdOf,
	vehicleUseFromColumns,
	type WorkVehicleUseRefusalCode,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use";
import {
	type WorkVehicleUseChangeRefusalCode,
	workVehicleUseRefusalCodeOf,
} from "@/lib/time-tracking/vehicle-use/work-vehicle-use-eligibility";
import type { TeamsInvokeResponse } from "./approval-handler";
import type { ResolvedTeamsUser, ResolvedTenant } from "./types";
import {
	type TeamsVehicleUseEntryRejection,
	type TeamsVehicleUseInvoke,
	type TeamsVehicleUsePrompt,
	type TeamsVehicleUsePromptTarget,
	teamsVehicleUseCard,
	teamsVehicleUseOutcomeCard,
} from "./vehicle-use-card";

const logger = createLogger("TeamsVehicleUse");

/**
 * What the card asks after a committed Teams clock command (#1125), or null
 * when nothing is asked: vehicle use is off for the employee, the started work
 * already records a vehicle, or the closed work's drive already has its end.
 */
export async function loadTeamsVehicleUsePrompt(
	target: TeamsVehicleUsePromptTarget,
): Promise<TeamsVehicleUsePrompt | null> {
	const { organizationId, employeeId } = target;
	const [period] = await db
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				target.stage === "clock_in"
					? eq(workPeriod.clockInId, target.entryId)
					: eq(workPeriod.clockOutId, target.entryId),
				isNull(workPeriod.deletedAt),
			),
		)
		.limit(1);
	if (!period) return null;
	const recorded = vehicleUseFromColumns(period);
	if (target.stage === "clock_in" ? recorded !== null : recorded?.endKm != null) return null;
	if (recorded?.distanceKm != null) return null;

	const recordedVehicleId = organizationVehicleIdOf(recorded);
	const context = await loadWorkVehicleUseFormContext(db, {
		organizationId,
		employeeId,
		recordedVehicleIds: recordedVehicleId ? [recordedVehicleId] : [],
		excludeWorkPeriodId: period.id,
	});
	if (context.mode === "off") return null;

	const label = (vehicle: { name: string; licencePlate: string }) =>
		`${vehicle.name} (${vehicle.licencePlate})`;
	const suggestedVehicleId = context.suggestedVehicleIds?.[0] ?? null;
	const recordedVehicle = recordedVehicleId
		? context.vehicles.find((vehicle) => vehicle.id === recordedVehicleId)
		: undefined;
	return {
		stage: target.stage,
		workPeriodId: period.id,
		clockOutEntryId: target.stage === "clock_out" ? target.entryId : null,
		vehicles: context.vehicles
			.filter((vehicle) => !vehicle.archived)
			.map((vehicle) => ({ id: vehicle.id, label: label(vehicle) })),
		suggestedVehicleId,
		prefillStartKm: suggestedVehicleId
			? (context.lastEndKmByVehicleId?.[suggestedVehicleId] ?? null)
			: null,
		recorded: recorded
			? {
					vehicleLabel: recordedVehicle ? label(recordedVehicle) : null,
					startKm: recorded.startKm,
				}
			: null,
	};
}

/**
 * A committed Teams clock command's reply with the vehicle use card, when the
 * card asks anything. The caller (`commands/vehicle-use-reply.ts`) keeps the
 * committed reply when building the card fails.
 */
export async function withTeamsVehicleUsePrompt(
	reply: BotCommandResponse,
	target: TeamsVehicleUsePromptTarget,
	t: BotTranslateFn,
): Promise<BotCommandResponse> {
	const prompt = await loadTeamsVehicleUsePrompt(target);
	if (!prompt) return reply;
	return { type: "card", text: reply.text, card: teamsVehicleUseCard(prompt, t) };
}

function replaceCard(
	text: string,
	warnings?: Parameters<typeof teamsVehicleUseOutcomeCard>[1],
): TeamsInvokeResponse {
	return {
		status: 200,
		body: {
			statusCode: 200,
			type: "application/vnd.microsoft.card.adaptive",
			value: teamsVehicleUseOutcomeCard(text, warnings),
		},
	};
}

/**
 * The plausibility warnings (#1121) of the vehicle use the work records after a
 * save, as the web shows them on entry. Reading them never undoes the save: a
 * failure only loses the warnings.
 */
async function savedVehicleUseWarnings(
	scope: { organizationId: string; employeeId: string; workPeriodId: string },
	t: BotTranslateFn,
	locale: string,
): Promise<string[]> {
	try {
		const [period] = await db
			.select()
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, scope.workPeriodId),
					eq(workPeriod.organizationId, scope.organizationId),
					eq(workPeriod.employeeId, scope.employeeId),
					isNull(workPeriod.deletedAt),
				),
			)
			.limit(1);
		const use = period ? vehicleUseFromColumns(period) : null;
		if (!period || !use) return [];
		const warnings = await checkWorkVehicleUsePlausibility(db, {
			organizationId: scope.organizationId,
			employeeId: scope.employeeId,
			use,
			start: instantFromDate(period.startTime),
			end: period.endTime ? instantFromDate(period.endTime) : null,
			excludeWorkPeriodId: period.id,
		});
		return warnings.map((warning) => vehicleUseWarningBotText(t, warning, locale));
	} catch (error) {
		logger.error({ error }, "Failed to check the saved vehicle use");
		return [];
	}
}

/** An entry to fix: Teams shows the message and keeps the card. */
function keepCard(code: string, message: string): TeamsInvokeResponse {
	return {
		status: 200,
		body: { statusCode: 400, type: "application/vnd.microsoft.error", value: { code, message } },
	};
}

function entryMessage(
	code: TeamsVehicleUseEntryRejection | WorkVehicleUseRefusalCode | WorkVehicleUseChangeRefusalCode,
	t: BotTranslateFn,
): string | null {
	switch (code) {
		case "invalid_reading":
		case "invalid_distance":
			return t("bot.vehicleUse.invalidReading", "Readings must be whole kilometres.");
		case "end_before_start":
			return t(
				"bot.vehicleUse.endBeforeStart",
				"The end reading cannot be below the start reading.",
			);
		case "vehicle_required":
		case "invalid_vehicle":
			return t("bot.vehicleUse.vehicleRequired", "Choose a vehicle.");
		case "reading_required":
			return t("bot.vehicleUse.readingRequired", "Enter the kilometres.");
		case "vehicle_not_found":
		case "vehicle_archived":
			return t(
				"bot.vehicleUse.vehicleUnavailable",
				"This vehicle can no longer be picked. Choose another one.",
			);
		default:
			return null;
	}
}

/**
 * A press on a vehicle use card (#1125). The work is scoped to the pressing
 * employee in the tenant's organization; the stores re-check every rule under
 * their locks. Saving after clock-in changes the live work's vehicle use;
 * saving after clock-out completes the closed work. Skipping writes nothing.
 * An entry to fix keeps the card; any other outcome replaces it.
 */
export async function handleTeamsVehicleUseInvoke(
	invoke: Exclude<TeamsVehicleUseInvoke, { kind: "none" }>,
	user: ResolvedTeamsUser,
	tenant: ResolvedTenant,
): Promise<TeamsInvokeResponse> {
	const locale = await getUserLocale(user.userId);
	const t = await getBotTranslate(locale);
	const saved = (warnings: readonly string[] = []) =>
		replaceCard(t("bot.vehicleUse.saved", "Vehicle use saved."), {
			title: t("bot.vehicleUse.warning.title", "Please check the vehicle use:"),
			lines: warnings,
		});
	const addInZ8 = t(
		"bot.vehicleUse.addInZ8",
		"This card has expired. Add vehicle use to this work in Z8.",
	);
	if (invoke.kind === "invalid" || user.organizationId !== tenant.organizationId) {
		return keepCard(
			"BadRequest",
			t("bot.vehicleUse.unavailable", "This card is no longer available."),
		);
	}
	if (invoke.kind === "rejected") {
		return keepCard("BadRequest", entryMessage(invoke.code, t) ?? addInZ8);
	}
	if (invoke.kind === "skip") {
		return replaceCard(t("bot.vehicleUse.skipped", "No vehicle use recorded for this work."));
	}

	const scope = {
		organizationId: tenant.organizationId,
		employeeId: user.employeeId,
		actorUserId: user.userId,
		workPeriodId: invoke.workPeriodId,
	};
	try {
		if (invoke.stage === "clock_in") {
			const built = buildWorkVehicleUse({
				vehicle: invoke.supplied.vehicle,
				startKm: invoke.supplied.startKm,
			});
			if (!built.ok) return keepCard("BadRequest", entryMessage(built.code, t) ?? addInZ8);
			await changeLiveWorkVehicleUse({ ...scope, vehicleUse: built.use });
		} else {
			await completeClockOutVehicleUse({
				...scope,
				clockOutId: invoke.clockOutId,
				supplied: invoke.supplied,
				now: systemClock.nowInstant(),
			});
		}
		return saved(await savedVehicleUseWarnings(scope, t, locale));
	} catch (error) {
		// A repeated press of what is already recorded.
		if (
			(error instanceof ConflictError && error.conflictType === "vehicle_use_unchanged") ||
			(error instanceof ValidationError && error.field === "correction")
		) {
			return saved();
		}
		const refusal = workVehicleUseRefusalCodeOf(error);
		if (refusal === "vehicle_use_off") {
			return replaceCard(
				t("bot.vehicleUse.off", "Vehicle use is no longer recorded for you. Nothing was saved."),
			);
		}
		const entry = refusal ? entryMessage(refusal, t) : null;
		if (entry) return keepCard("BadRequest", entry);
		if (error instanceof NotFoundError) {
			return replaceCard(
				invoke.stage === "clock_in"
					? t(
							"bot.vehicleUse.notClockedIn",
							"You are no longer clocked in. Add vehicle use to this work in Z8.",
						)
					: addInZ8,
			);
		}
		if (error instanceof ConflictError && error.conflictType === "vehicle_use_completion_closed") {
			return replaceCard(addInZ8);
		}
		if (describeAmendmentFailure(error) || error instanceof ConflictError) {
			return replaceCard(
				t("bot.vehicleUse.notSaved", "Vehicle use could not be saved for this work. Add it in Z8."),
			);
		}
		logger.error({ error, stage: invoke.stage }, "Failed to save vehicle use from Teams");
		return {
			status: 200,
			body: {
				statusCode: 500,
				type: "application/vnd.microsoft.error",
				value: {
					code: "SaveFailed",
					message: t("bot.vehicleUse.failed", "Vehicle use could not be saved. Please try again."),
				},
			},
		};
	}
}
