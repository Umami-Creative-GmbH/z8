"use server";

import { Effect } from "effect";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import { storeStep } from "@/lib/organization-action/store-step";
import {
	recordEmployeeStatutoryOffset,
	recordEmployeeStudyPeriod,
	voidEmployeeStatutoryOffset,
	voidEmployeeStudyPeriod,
} from "@/lib/statutory/employee-context";
import { statutoryAudienceOf } from "@/lib/statutory/redaction";
import {
	acknowledgeWorkingStudentFinding,
	listWorkingStudentReviewItems,
	loadWorkingStudentMonitor,
} from "@/lib/statutory/working-student/views";
import { workingStudentFindingKinds } from "@/lib/statutory/working-student/weeks";

// Working-student monitor (#1991). Reading the monitor card is open to scoped managers for the
// employees they manage (wage-free, redacted); recording statutory context and acknowledging
// findings is for org admins only.

const uuidSchema = z.uuid("Invalid identifier");
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date");
const reasonSchema = z.string().max(2000);

export const getWorkingStudentMonitorAction = organizationAction(
	{
		name: "contracts.getWorkingStudentMonitor",
		requires: "scopedManager",
		schema: z.strictObject({ employeeId: uuidSchema }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const scope = yield* actor.managedScope();
			yield* refuseUnless(scope.organizationWide || scope.employeeIds.has(input.employeeId), {
				userId: actor.userId,
				message: "You can only view employees you manage",
				resource: "working_student_monitor",
				action: "read",
			});
			return yield* storeStep("contracts.getWorkingStudentMonitor", (db) =>
				loadWorkingStudentMonitor(db, {
					organizationId,
					employeeId: input.employeeId,
					now: systemClock.nowInstant(),
					audience: statutoryAudienceOf(actor.settingsAccess),
				}),
			);
		}),
);

export const listWorkingStudentReviewsAction = organizationAction(
	{ name: "contracts.listWorkingStudentReviews", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		storeStep("contracts.listWorkingStudentReviews", (db) =>
			listWorkingStudentReviewItems(db, { organizationId, now: systemClock.nowInstant() }),
		),
);

export const acknowledgeWorkingStudentFindingAction = organizationAction(
	{
		name: "contracts.acknowledgeWorkingStudentFinding",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			findingKind: z.enum(workingStudentFindingKinds),
			weekStart: isoDateSchema,
			// The finding's fingerprint as the admin saw it: figures that changed since are refused.
			expectedInputFingerprint: z.string().min(1).max(200),
			reason: reasonSchema,
			legalNote: z.string().max(500).nullish(),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.acknowledgeWorkingStudentFinding", (db) =>
			acknowledgeWorkingStudentFinding(db, {
				organizationId,
				actorUserId: actor.userId,
				...input,
				now: systemClock.nowInstant(),
			}),
		),
);

export const recordWorkingStudentLectureFreePeriodAction = organizationAction(
	{
		name: "contracts.recordWorkingStudentLectureFreePeriod",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			startsOn: isoDateSchema,
			endsOn: isoDateSchema,
			note: z.string().max(500).nullish(),
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.recordWorkingStudentLectureFreePeriod", async (db) => {
			const row = await recordEmployeeStudyPeriod(db, {
				organizationId,
				actorUserId: actor.userId,
				...input,
			});
			return { id: row.id };
		}),
);

export const voidWorkingStudentLectureFreePeriodAction = organizationAction(
	{
		name: "contracts.voidWorkingStudentLectureFreePeriod",
		requires: "orgAdmin",
		schema: z.strictObject({ employeeId: uuidSchema, periodId: uuidSchema, reason: reasonSchema }),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.voidWorkingStudentLectureFreePeriod", (db) =>
			voidEmployeeStudyPeriod(db, { organizationId, actorUserId: actor.userId, ...input }),
		),
);

export const recordWorkingStudentPriorWeeksAction = organizationAction(
	{
		name: "contracts.recordWorkingStudentPriorWeeks",
		requires: "orgAdmin",
		schema: z.strictObject({
			employeeId: uuidSchema,
			firstWeekStartsOn: isoDateSchema,
			count: z.number().int(),
			sourceEmployer: z.string().max(200).nullish(),
			note: reasonSchema,
		}),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.recordWorkingStudentPriorWeeks", async (db) => {
			const row = await recordEmployeeStatutoryOffset(db, {
				organizationId,
				actorUserId: actor.userId,
				offsetKind: "prior_working_student_over_20h_weeks",
				...input,
			});
			return { id: row.id };
		}),
);

export const voidWorkingStudentPriorWeeksAction = organizationAction(
	{
		name: "contracts.voidWorkingStudentPriorWeeks",
		requires: "orgAdmin",
		schema: z.strictObject({ employeeId: uuidSchema, offsetId: uuidSchema, reason: reasonSchema }),
	},
	({ actor, organizationId, input }) =>
		storeStep("contracts.voidWorkingStudentPriorWeeks", (db) =>
			voidEmployeeStatutoryOffset(db, { organizationId, actorUserId: actor.userId, ...input }),
		),
);
