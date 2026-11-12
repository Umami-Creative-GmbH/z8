"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { project } from "@/db/schema";
import {
	type BulkBillabilityRequest,
	type BulkBillabilitySummary,
	parseBulkBillabilityRequest,
} from "@/lib/billable-time/bulk-billability";
import {
	applyBulkBillability as applyBulkBillabilityChange,
	planBulkBillability,
} from "@/lib/billable-time/bulk-billability-work";
import { activeProjectCustomerIdSql } from "@/lib/billable-time/project-customer";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { billableTimeOff } from "./module-guard";

export interface BulkBillabilityPreview {
	summary: BulkBillabilitySummary;
	/** Pass back to `applyBulkBillability` to apply exactly this preview. */
	fingerprint: string;
}

/**
 * The checked request: Billable Time on, and the project the organization's
 * with an active customer. `parseBulkBillabilityRequest` reads the request, so
 * its refusals keep their wording.
 */
function checkedRequest(organizationId: string, input: unknown) {
	return Effect.gen(function* () {
		const parsed = parseBulkBillabilityRequest(input);
		if (!parsed.ok) {
			return yield* Effect.fail(
				new ValidationError({ message: parsed.message, field: parsed.field }),
			);
		}
		const request: BulkBillabilityRequest = parsed.request;
		const dbService = yield* DatabaseService;
		const settings = yield* dbService.query("billableTime.bulk.settings", () =>
			getBillableTimeSettings(organizationId, dbService.db),
		);
		if (!settings.enabled) {
			return yield* Effect.fail(billableTimeOff());
		}
		const [target] = yield* dbService.query("billableTime.bulk.project", () =>
			dbService.db
				.select({ customerId: activeProjectCustomerIdSql() })
				.from(project)
				.where(and(eq(project.id, request.projectId), eq(project.organizationId, organizationId)))
				.limit(1),
		);
		if (!target) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Project not found",
					entityType: "project",
					entityId: request.projectId,
				}),
			);
		}
		// Bulk billability is for a customer's project (#901), in either direction. A
		// deleted customer leaves the project without customer (#768).
		if (target.customerId === null) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Only a customer's project can have its work marked billable or non-billable",
					field: "projectId",
				}),
			);
		}
		return { request, dbService };
	});
}

const requestShape = {
	projectId: z.string().max(255),
	fromDay: z.string().max(32),
	toDay: z.string().max(32),
	billable: z.boolean(),
};

/**
 * Previews marking a project's completed work in a date range (employee-local
 * day of each work period's start) billable or non-billable: how many work
 * periods and hours change, are already in that state, or are skipped and why.
 * Org admins of the active organization only.
 */
export const previewBulkBillability = organizationAction(
	{ name: "billableTime.bulk.preview", requires: "orgAdmin", schema: z.strictObject(requestShape) },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const { request, dbService } = yield* checkedRequest(organizationId, input);
			const plan = yield* dbService.query("billableTime.bulk.preview", () =>
				planBulkBillability(dbService.db, organizationId, request),
			);
			return {
				summary: plan.summary,
				fingerprint: plan.fingerprint,
			} satisfies BulkBillabilityPreview;
		}),
);

/**
 * Applies a preview. When the work no longer matches it, nothing changes and
 * the result carries a fresh preview (`status: "stale"`). Each change is an
 * ordinary attribution amendment; re-running the same apply changes nothing more.
 */
export const applyBulkBillability = organizationAction(
	{
		name: "billableTime.bulk.apply",
		requires: "orgAdmin",
		schema: z.strictObject({
			...requestShape,
			fingerprint: z.string().regex(/^[0-9a-f]{64}$/, { error: "Preview the change first" }),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { request, dbService } = yield* checkedRequest(organizationId, input);
			const billing = yield* Effect.promise(() => requireBillingForMutation(organizationId));
			if (!isBillingMutationAllowed(billing)) {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "billing_required",
						userId: actor.userId,
						resource: "billableTime",
						action: "applyBulkBillability",
					}),
				);
			}
			return yield* dbService.query("billableTime.bulk.apply", () =>
				applyBulkBillabilityChange(dbService.db, {
					organizationId,
					actorUserId: actor.userId,
					request,
					fingerprint: input.fingerprint,
				}),
			);
		}),
);
