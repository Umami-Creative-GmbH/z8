"use server";

import { Effect } from "effect";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { NotFoundError } from "@/lib/effect/errors";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import { storeStep } from "@/lib/organization-action/store-step";
import {
	recordEmployeeStatutoryOffset,
	statutoryAudienceOf,
	voidEmployeeStatutoryOffset,
} from "@/lib/statutory";
import {
	listMinijobExternalOffsets,
	loadEmployeeMinijobMonitor,
} from "@/lib/statutory/minijob/minijob-monitor-view";
import { addMonths } from "@/lib/statutory/minijob/minijob-months";
import { scopeReachesEmployee } from "./managed-employee";

// Minijob earnings monitor on Employee Detail (#1989). Scoped managers read the wage-free tiers
// of the employees they manage; only org admins see EUR amounts and edit external offsets.

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month");

const employeeInputSchema = z.strictObject({ employeeId: z.uuid() });

const recordOffsetSchema = z
	.strictObject({
		employeeId: z.uuid(),
		fromMonth: monthSchema,
		/** Last covered month (inclusive); null while the other Minijob continues. */
		lastMonth: monthSchema.nullable(),
		amountCents: z.number().int().min(0).max(100_000_000),
		sourceEmployer: z.string().trim().max(200).nullable(),
		note: z.string().trim().min(1, "Record where the earnings come from").max(2000),
	})
	.refine((input) => input.lastMonth === null || input.lastMonth >= input.fromMonth, {
		message: "The last month must not be before the first month",
		path: ["lastMonth"],
	});

const voidOffsetSchema = z.strictObject({
	employeeId: z.uuid(),
	offsetId: z.uuid(),
	reason: z.string().trim().min(1, "Record why the earnings are voided").max(2000),
});

export const getEmployeeMinijobMonitorAction = organizationAction(
	{ name: "employees.getMinijobMonitor", requires: "scopedManager", schema: employeeInputSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scope = yield* actor.managedScope();
			yield* refuseUnless(scopeReachesEmployee(scope, input.employeeId), {
				userId: actor.userId,
				message: "You can only view employees you manage",
				resource: "minijob_monitor",
				action: "read",
			});
			return yield* storeStep("employees.getMinijobMonitor", (db) =>
				loadEmployeeMinijobMonitor(db, {
					organizationId,
					employeeId: input.employeeId,
					audience: statutoryAudienceOf(actor.settingsAccess),
					now: systemClock.nowInstant(),
				}),
			);
		}),
);

export const recordMinijobExternalOffsetAction = organizationAction(
	{
		name: "employees.recordMinijobExternalOffset",
		requires: "orgAdmin",
		schema: recordOffsetSchema,
	},
	({ actor, organizationId, input }) =>
		storeStep("employees.recordMinijobExternalOffset", async (db) => {
			const row = await recordEmployeeStatutoryOffset(db, {
				organizationId,
				employeeId: input.employeeId,
				actorUserId: actor.userId,
				offsetKind: "external_minijob_monthly_earnings",
				validFromDate: `${input.fromMonth}-01`,
				validUntilDate: input.lastMonth ? `${addMonths(input.lastMonth, 1)}-01` : null,
				amountCents: input.amountCents,
				sourceEmployer: input.sourceEmployer,
				note: input.note,
			});
			return { id: row.id };
		}),
);

export const voidMinijobExternalOffsetAction = organizationAction(
	{ name: "employees.voidMinijobExternalOffset", requires: "orgAdmin", schema: voidOffsetSchema },
	({ actor, organizationId, input }) =>
		storeStep("employees.voidMinijobExternalOffset", async (db) => {
			const offsets = await listMinijobExternalOffsets(db, {
				organizationId,
				employeeId: input.employeeId,
			});
			if (!offsets.some((offset) => offset.id === input.offsetId)) {
				throw new NotFoundError({
					message: "External Minijob earnings not found",
					entityType: "employee_statutory_offset",
					entityId: input.offsetId,
				});
			}
			await voidEmployeeStatutoryOffset(db, {
				organizationId,
				employeeId: input.employeeId,
				actorUserId: actor.userId,
				offsetId: input.offsetId,
				reason: input.reason,
			});
			return { voided: true as const };
		}),
);
