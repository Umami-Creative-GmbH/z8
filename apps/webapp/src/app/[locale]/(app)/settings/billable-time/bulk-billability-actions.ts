"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { project } from "@/db/schema";
import {
	type BulkBillabilityRequest,
	type BulkBillabilitySummary,
	parseBulkBillabilityRequest,
} from "@/lib/billable-time/bulk-billability";
import {
	applyBulkBillability as applyBulkBillabilityChange,
	type BulkBillabilityApplyOutcome,
	planBulkBillability,
} from "@/lib/billable-time/bulk-billability-work";
import { activeProjectCustomerIdSql } from "@/lib/billable-time/project-customer";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { activeOrganizationActor } from "./action-actor";
import { billableTimeOff } from "./module-guard";

export interface BulkBillabilityPreview {
	summary: BulkBillabilitySummary;
	/** Pass back to `applyBulkBillability` to apply exactly this preview. */
	fingerprint: string;
}

const ADMIN_ONLY = "Only owners and admins can mark a project's work billable or non-billable";

/**
 * The checked request of the active organization's admin or owner: Billable
 * Time on, and the project the organization's with an active customer.
 */
function authorizedRequest(input: unknown, action: string) {
	return Effect.gen(function* () {
		const actor = yield* activeOrganizationActor({
			requiredRole: "admin",
			message: ADMIN_ONLY,
			action,
		});
		const parsed = parseBulkBillabilityRequest(input);
		if (!parsed.ok) {
			return yield* Effect.fail(
				new ValidationError({ message: parsed.message, field: parsed.field }),
			);
		}
		const request: BulkBillabilityRequest = parsed.request;
		const dbService = yield* DatabaseService;
		const settings = yield* dbService.query("billableTime.bulk.settings", () =>
			getBillableTimeSettings(actor.organizationId, dbService.db),
		);
		if (!settings.enabled) {
			return yield* Effect.fail(billableTimeOff());
		}
		const [target] = yield* dbService.query("billableTime.bulk.project", () =>
			dbService.db
				.select({ customerId: activeProjectCustomerIdSql() })
				.from(project)
				.where(
					and(eq(project.id, request.projectId), eq(project.organizationId, actor.organizationId)),
				)
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
		return { actor, request, dbService };
	});
}

/**
 * Previews marking a project's completed work in a date range (employee-local
 * day of each work period's start) billable or non-billable: how many work
 * periods and hours change, are already in that state, or are skipped and why.
 * Owners and admins of the active organization only.
 */
export async function previewBulkBillability(input: {
	projectId: string;
	fromDay: string;
	toDay: string;
	billable: boolean;
}): Promise<ServerActionResult<BulkBillabilityPreview>> {
	const effect = Effect.gen(function* () {
		const { actor, request, dbService } = yield* authorizedRequest(input, "previewBulkBillability");
		const plan = yield* dbService.query("billableTime.bulk.preview", () =>
			planBulkBillability(dbService.db, actor.organizationId, request),
		);
		return { summary: plan.summary, fingerprint: plan.fingerprint };
	});
	return runServerActionSafe(effect);
}

/**
 * Applies a preview. When the work no longer matches it, nothing changes and
 * the result carries a fresh preview (`status: "stale"`). Each change is an
 * ordinary attribution amendment; re-running the same apply changes nothing more.
 */
export async function applyBulkBillability(input: {
	projectId: string;
	fromDay: string;
	toDay: string;
	billable: boolean;
	fingerprint: string;
}): Promise<ServerActionResult<BulkBillabilityApplyOutcome>> {
	const effect = Effect.gen(function* () {
		const { actor, request, dbService } = yield* authorizedRequest(input, "applyBulkBillability");
		if (typeof input.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(input.fingerprint)) {
			return yield* Effect.fail(
				new ValidationError({ message: "Preview the change first", field: "fingerprint" }),
			);
		}
		const billing = yield* Effect.promise(() => requireBillingForMutation(actor.organizationId));
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
				organizationId: actor.organizationId,
				actorUserId: actor.userId,
				request,
				fingerprint: input.fingerprint,
			}),
		);
	});
	return runServerActionSafe(effect);
}
