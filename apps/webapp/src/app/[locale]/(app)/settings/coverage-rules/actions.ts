"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import { dateFromInstant } from "@/lib/datetime/temporal-core";
import { CoverageService } from "@/lib/effect/services/coverage.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { resolveScheduleDateRange } from "@/lib/scheduling/schedule-local-input";
import { createCoverageRuleSchema, updateCoverageRuleSchema } from "@/lib/validations/coverage";
import {
	coverageRuleSubareaScope,
	inSubareaScope,
	loadCoverageRuleTarget,
	withinSubareaScope,
} from "./coverage-rule-scope";

function revalidateCoverageRulePages() {
	revalidatePath("/settings/coverage-rules");
	revalidatePath("/settings/shifts");
}

function organizationTimezone(organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const currentOrganization = yield* dbService.query("coverageRules.organizationTimezone", () =>
			dbService.db.query.organization.findFirst({
				where: (table, { eq }) => eq(table.id, organizationId),
				columns: { timezone: true },
			}),
		);
		return currentOrganization?.timezone ?? "UTC";
	});
}

const ruleIdSchema = z.strictObject({ ruleId: z.string().min(1, "Invalid coverage rule ID") });

// ============================================
// COVERAGE RULE CRUD
// ============================================

/** The organization's coverage rules, limited to a scoped manager's subareas. */
export const getCoverageRules = organizationAction(
	{
		name: "coverageRules.list",
		requires: "scopedManager",
		schema: z.strictObject({ subareaId: z.uuid("Invalid subarea ID").optional() }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scope = yield* coverageRuleSubareaScope(actor);
			if (input.subareaId) yield* withinSubareaScope(actor, scope, input.subareaId);
			const coverageService = yield* CoverageService;
			const rules = yield* coverageService.getCoverageRules(organizationId, input.subareaId);
			return rules.filter((rule) => inSubareaScope(scope, rule.subareaId));
		}),
);

/** One coverage rule of the organization. */
export const getCoverageRule = organizationAction(
	{ name: "coverageRules.get", requires: "scopedManager", schema: ruleIdSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scope = yield* coverageRuleSubareaScope(actor);
			const target = yield* loadCoverageRuleTarget(organizationId, input.ruleId);
			yield* withinSubareaScope(actor, scope, target.subareaId);
			const coverageService = yield* CoverageService;
			return yield* coverageService.getCoverageRuleById(target.id);
		}),
);

export const createCoverageRule = organizationAction(
	{ name: "coverageRules.create", requires: "scopedManager", schema: createCoverageRuleSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scope = yield* coverageRuleSubareaScope(actor);
			yield* withinSubareaScope(actor, scope, input.subareaId);
			const coverageService = yield* CoverageService;
			const rule = yield* coverageService.createCoverageRule({
				organizationId,
				subareaId: input.subareaId,
				dayOfWeek: input.dayOfWeek,
				startTime: input.startTime,
				endTime: input.endTime,
				minimumStaffCount: input.minimumStaffCount,
				priority: input.priority ?? 0,
				createdBy: actor.userId,
			});
			revalidateCoverageRulePages();
			return rule;
		}),
);

export const updateCoverageRule = organizationAction(
	{
		name: "coverageRules.update",
		requires: "scopedManager",
		schema: z.strictObject({
			ruleId: z.string().min(1, "Invalid coverage rule ID"),
			data: updateCoverageRuleSchema,
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scope = yield* coverageRuleSubareaScope(actor);
			const target = yield* loadCoverageRuleTarget(organizationId, input.ruleId);
			yield* withinSubareaScope(actor, scope, target.subareaId);
			yield* withinSubareaScope(actor, scope, input.data.subareaId ?? target.subareaId);
			const coverageService = yield* CoverageService;
			const rule = yield* coverageService.updateCoverageRule(target.id, {
				...input.data,
				updatedBy: actor.userId,
			});
			revalidateCoverageRulePages();
			return rule;
		}),
);

export const deleteCoverageRule = organizationAction(
	{ name: "coverageRules.delete", requires: "scopedManager", schema: ruleIdSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scope = yield* coverageRuleSubareaScope(actor);
			const target = yield* loadCoverageRuleTarget(organizationId, input.ruleId);
			yield* withinSubareaScope(actor, scope, target.subareaId);
			const coverageService = yield* CoverageService;
			yield* coverageService.deleteCoverageRule(target.id);
			revalidateCoverageRulePages();
		}),
);

// ============================================
// COVERAGE CALCULATION
// ============================================

/** Heatmap data for the scheduler, limited to a scoped manager's subareas. */
export const getTargetHeatmapData = organizationAction(
	{
		name: "coverageRules.targetHeatmap",
		requires: "scopedManager",
		schema: z.strictObject({
			startDate: z.string().min(1),
			endDateExclusive: z.string().min(1),
			subareaIds: z.array(z.uuid()).optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scope = yield* coverageRuleSubareaScope(actor);
			const timezone = yield* organizationTimezone(organizationId);
			const range = resolveScheduleDateRange(
				{ startDate: input.startDate, endDateExclusive: input.endDateExclusive },
				timezone,
			);
			const subareaIds = scope
				? (input.subareaIds?.filter((subareaId) => scope.has(subareaId)) ?? [...scope])
				: input.subareaIds;
			const coverageService = yield* CoverageService;
			return yield* coverageService.getTargetHeatmapData({
				organizationId,
				startDate: dateFromInstant(range.start),
				endDate: dateFromInstant(range.endExclusive),
				timezone,
				subareaIds,
			});
		}),
);

/** Whether a schedule can be published (checks for coverage gaps). */
export const validateScheduleForPublish = organizationAction(
	{
		name: "coverageRules.validateScheduleForPublish",
		requires: "orgAdmin",
		schema: z.strictObject({ startDate: z.date(), endDate: z.date() }),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const timezone = yield* organizationTimezone(organizationId);
			const coverageService = yield* CoverageService;
			return yield* coverageService.validateScheduleCanPublish({
				organizationId,
				startDate: input.startDate,
				endDate: input.endDate,
				timezone,
			});
		}),
);

// ============================================
// COVERAGE SETTINGS
// ============================================

export const getCoverageSettings = organizationAction(
	{ name: "coverageRules.getSettings", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const coverageService = yield* CoverageService;
			return yield* coverageService.getCoverageSettings(organizationId);
		}),
);

export const updateCoverageSettings = organizationAction(
	{
		name: "coverageRules.updateSettings",
		requires: "orgAdmin",
		schema: z.strictObject({ allowPublishWithGaps: z.boolean() }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const coverageService = yield* CoverageService;
			const settings = yield* coverageService.updateCoverageSettings(organizationId, {
				allowPublishWithGaps: input.allowPublishWithGaps,
				updatedBy: actor.userId,
			});
			revalidateCoverageRulePages();
			return settings;
		}),
);
