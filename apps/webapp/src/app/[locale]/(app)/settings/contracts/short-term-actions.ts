"use server";

import { Effect } from "effect";
import { z } from "zod";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import { storeStep } from "@/lib/organization-action/store-step";
import {
	recordEmployeeStatutoryOffset,
	voidEmployeeStatutoryOffset,
} from "@/lib/statutory/employee-context";
import { loadEmployeeInOrganization } from "@/lib/statutory/employee-scope";
import { statutoryAudienceOf } from "@/lib/statutory/redaction";
import {
	acknowledgeShortTermBerufsmaessigkeit,
	listShortTermBerufsmaessigkeitReviews,
	loadShortTermMonitor,
} from "@/lib/statutory/short-term/monitor";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { scopeReachesEmployee } from "../employees/managed-employee";

// Short-term employment monitor (#1990, § 8 Abs. 1 Nr. 2 SGB IV). Scoped managers read the
// wage-free allowance of employees they manage; prior-employer entries, Berufsmäßigkeit prompts
// (EUR earnings) and acknowledgements are for org admins only.

const uuidSchema = z.uuid("Invalid identifier");
const yearSchema = z.number().int().min(2000).max(2100);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM month");

export const getShortTermMonitorAction = organizationAction(
	{
		name: "contracts.getShortTermMonitor",
		requires: "scopedManager",
		schema: z.strictObject({ employeeId: uuidSchema, year: yearSchema.optional() }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scope = yield* actor.managedScope();
			yield* refuseUnless(scopeReachesEmployee(scope, input.employeeId), {
				userId: actor.userId,
				message: "You can only view statutory limits of employees you manage",
				resource: "statutory_short_term",
				action: "read",
			});
			return yield* storeStep("contracts.getShortTermMonitor", async (db) => {
				const timezone = await loadOrganizationTimezone(db, organizationId);
				const now = systemClock.nowInstant();
				return loadShortTermMonitor(db, {
					organizationId,
					employeeId: input.employeeId,
					timezone,
					year: input.year ?? plainDateAt(now, timezone).year,
					now,
					audience: statutoryAudienceOf(actor.settingsAccess),
				});
			});
		}),
);

export const recordShortTermPriorEmploymentAction = organizationAction(
	{
		name: "contracts.recordShortTermPriorEmployment",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			kind: z.enum(["prior_short_term_work_days", "prior_short_term_months"]),
			calendarYear: yearSchema,
			count: z.number().int().min(0).max(366),
			sourceEmployer: z.string().max(200).nullable().optional(),
			note: z.string().max(1000),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.recordShortTermPriorEmployment", async (db) => {
			const row = await recordEmployeeStatutoryOffset(db, {
				organizationId,
				employeeId: input.employeeId,
				actorUserId: actor.userId,
				offsetKind: input.kind,
				calendarYear: input.calendarYear,
				count: input.count,
				sourceEmployer: input.sourceEmployer ?? null,
				note: input.note,
			});
			return { id: row.id };
		}),
);

export const voidShortTermPriorEmploymentAction = organizationAction(
	{
		name: "contracts.voidShortTermPriorEmployment",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			offsetId: uuidSchema,
			reason: z.string().max(1000),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.voidShortTermPriorEmployment", async (db) => {
			await loadEmployeeInOrganization(db, { organizationId, employeeId: input.employeeId });
			await voidEmployeeStatutoryOffset(db, {
				organizationId,
				employeeId: input.employeeId,
				actorUserId: actor.userId,
				offsetId: input.offsetId,
				reason: input.reason,
			});
		}),
);

export const acknowledgeShortTermBerufsmaessigkeitAction = organizationAction(
	{
		name: "contracts.acknowledgeShortTermBerufsmaessigkeit",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			month: monthSchema,
			reason: z.string().max(2000),
			legalNote: z.string().max(1000).nullable().optional(),
			/** The prompt's fingerprint as the admin saw it: changed figures are refused. */
			expectedFingerprint: z.string().min(1).max(200),
			/** The month's total in EUR cents as the admin saw it: what the verification documents. */
			expectedTotalCents: z.number().int().nonnegative().max(100_000_000),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.acknowledgeShortTermBerufsmaessigkeit", async (db) => {
			const record = await acknowledgeShortTermBerufsmaessigkeit(db, {
				organizationId,
				actorUserId: actor.userId,
				employeeId: input.employeeId,
				timezone: await loadOrganizationTimezone(db, organizationId),
				month: input.month,
				reason: input.reason,
				legalNote: input.legalNote ?? null,
				expectedFingerprint: input.expectedFingerprint,
				expectedTotalCents: input.expectedTotalCents,
				now: systemClock.nowInstant(),
			});
			return { id: record.id, acknowledgedAt: record.acknowledgedAt };
		}),
);

export const listShortTermBerufsmaessigkeitReviewsAction = organizationAction(
	{
		name: "contracts.listShortTermBerufsmaessigkeitReviews",
		requires: "orgAdmin",
		schema: z.strictObject({ includeResolved: z.boolean().optional() }),
	},
	({ organizationId, input }) =>
		storeStep("contracts.listShortTermBerufsmaessigkeitReviews", async (db) =>
			listShortTermBerufsmaessigkeitReviews(db, {
				organizationId,
				timezone: await loadOrganizationTimezone(db, organizationId),
				now: systemClock.nowInstant(),
				includeResolved: input.includeResolved ?? false,
			}),
		),
);
