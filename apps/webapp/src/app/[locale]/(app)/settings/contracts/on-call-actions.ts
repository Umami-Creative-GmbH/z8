"use server";

import { Effect } from "effect";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { organizationAction } from "@/lib/organization-action/organization-action";
import type { OrganizationActor } from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import { storeStep } from "@/lib/organization-action/store-step";
import { acknowledgeOnCallShortNotice } from "@/lib/statutory/on-call/acknowledge";
import {
	calculateOnCallReferencePeriod,
	onCallReferenceMethods,
} from "@/lib/statutory/on-call/reference-period";
import {
	listOnCallPayrollReferenceRows,
	listOnCallReviewItems,
	loadOnCallEmployeeStatus,
} from "@/lib/statutory/on-call/views";
import { statutoryAudienceOf } from "@/lib/statutory/redaction";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

// § 12 TzBfG on-call monitor and reference-period calculator surfaces (#1992). Minutes and days
// only, never wages: managers and the employee see the redacted findings, org admins the full ones.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const methodSchema = z.enum(onCallReferenceMethods);

/** The employee themself, an org admin, or a manager whose scope reaches the employee. */
function authorizeEmployeeView(actor: OrganizationActor, employeeId: string) {
	return Effect.gen(function* () {
		if (actor.employee?.id === employeeId) return;
		yield* actor.require("scopedManager");
		const scope = yield* actor.managedScope();
		yield* refuseUnless(scope.organizationWide || scope.employeeIds.has(employeeId), {
			userId: actor.userId,
			message: "You can only view on-call details of employees you manage",
			resource: "employee_on_call",
			action: "read",
		});
	});
}

export const listOnCallReviewItemsAction = organizationAction(
	{ name: "contracts.onCall.listReviewItems", requires: "orgAdmin", schema: z.strictObject({}) },
	({ organizationId }) =>
		storeStep("contracts.onCall.listReviewItems", async (db) =>
			listOnCallReviewItems(db, {
				organizationId,
				timezone: await loadOrganizationTimezone(db, organizationId),
				now: systemClock.nowInstant(),
			}),
		),
);

export const acknowledgeOnCallShortNoticeAction = organizationAction(
	{
		name: "contracts.onCall.acknowledgeShortNotice",
		requires: "orgAdmin",
		schema: z.strictObject({
			shiftId: z.uuid(),
			/** The finding's fingerprint as shown: a precondition, never recorded from the client. */
			expectedFingerprint: z.string().min(1).max(200),
			reason: z.string().trim().min(1).max(2000),
			legalNote: z.string().trim().max(2000).optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.onCall.acknowledgeShortNotice", async (db) =>
			acknowledgeOnCallShortNotice(db, {
				organizationId,
				timezone: await loadOrganizationTimezone(db, organizationId),
				actorUserId: actor.userId,
				shiftId: input.shiftId,
				expectedFingerprint: input.expectedFingerprint,
				reason: input.reason,
				legalNote: input.legalNote ?? null,
				now: systemClock.nowInstant(),
			}).then((record) => ({ id: record.id, acknowledgedAt: record.acknowledgedAt })),
		),
);

export const getEmployeeOnCallStatusAction = organizationAction(
	{
		name: "contracts.onCall.getEmployeeStatus",
		requires: "member",
		schema: z.strictObject({ employeeId: z.uuid(), method: methodSchema.optional() }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* authorizeEmployeeView(actor, input.employeeId);
			return yield* storeStep("contracts.onCall.getEmployeeStatus", async (db) =>
				loadOnCallEmployeeStatus(db, {
					organizationId,
					employeeId: input.employeeId,
					timezone: await loadOrganizationTimezone(db, organizationId),
					now: systemClock.nowInstant(),
					audience: statutoryAudienceOf(actor.settingsAccess),
					selfView: actor.employee?.id === input.employeeId,
					method: input.method ?? "three_months",
				}),
			);
		}),
);

export const getOnCallReferencePeriodAction = organizationAction(
	{
		name: "contracts.onCall.getReferencePeriod",
		requires: "member",
		schema: z.strictObject({
			employeeId: z.uuid(),
			eventDate: isoDate,
			method: methodSchema,
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* authorizeEmployeeView(actor, input.employeeId);
			return yield* storeStep("contracts.onCall.getReferencePeriod", (db) =>
				calculateOnCallReferencePeriod(db, { organizationId, ...input }),
			);
		}),
);

export const listOnCallPayrollReferenceRowsAction = organizationAction(
	{
		name: "contracts.onCall.listPayrollReferenceRows",
		// Payroll preparation: org admins (the reference hours are wage-free, but the list spans the
		// whole organization).
		requires: "orgAdmin",
		schema: z
			.strictObject({ startDate: isoDate, endDate: isoDate, method: methodSchema })
			.refine((input) => input.startDate <= input.endDate, { path: ["endDate"] }),
	},
	({ organizationId, input }) =>
		storeStep("contracts.onCall.listPayrollReferenceRows", (db) =>
			listOnCallPayrollReferenceRows(db, { organizationId, ...input }),
		),
);
