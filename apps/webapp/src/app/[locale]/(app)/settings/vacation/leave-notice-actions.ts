"use server";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	documentLeaveOpportunity as documentLeaveOpportunityInStore,
	LeaveNoticeRefused,
	loadEmployeeLeaveNotices,
	recordExternalLeaveNotice as recordExternalLeaveNoticeInStore,
} from "@/lib/absences/leave-notice-store";
import { storeStep } from "@/lib/organization-action/store-step";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { findManagedEmployee } from "./managed-employee";

const plainDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = z.string().max(2000).nullable();

const externalNoticeSchema = z.object({
	employeeId: z.string().uuid(),
	leaveYear: z.number().int().min(2000).max(2100),
	days: z.number().positive().max(366),
	deliveredOn: plainDate,
	deliveryMethod: z.enum(["in_person", "letter", "email", "other"]),
	deliveryDetails: optionalText,
	deadline: plainDate,
	requestedToTakeLeave: z.boolean(),
	warnedOfLapse: z.boolean(),
	supportingDocuments: optionalText,
});

const opportunitySchema = z.object({
	noticeId: z.string().uuid(),
	basis: z.string().max(4000),
});

function revalidateLeaveNoticeViews() {
	revalidatePath("/[locale]/(app)/settings/vacation", "layout");
}

/**
 * HR records a dated attestation of a leave notice given outside Z8 to an employee of the active
 * organization (#2082). Like the employee's vacation settings page it needs an org admin; the
 * attestation is final.
 */
export const recordExternalLeaveNotice = organizationAction(
	{
		name: "vacation.recordExternalLeaveNotice",
		requires: "orgAdmin",
		schema: externalNoticeSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* findManagedEmployee(
				actor,
				organizationId,
				input.employeeId,
				"vacation_leave_notice",
				"create",
			);
			const recorded = yield* storeStep(
				"vacation.recordExternalLeaveNotice",
				async (db) =>
					recordExternalLeaveNoticeInStore(db, {
						organizationId,
						...input,
						timezone: await loadOrganizationTimezone(db, organizationId),
						attestedBy: actor.userId,
						attestedAt: new Date(),
					}),
				{ refusal: LeaveNoticeRefused },
			);
			revalidateLeaveNoticeViews();
			return recorded;
		}),
);

/**
 * HR documents why the employee had a real opportunity to take the days an external leave notice
 * of the active organization covers by its deadline (#2082). Org admin; once per notice.
 */
export const documentLeaveOpportunity = organizationAction(
	{
		name: "vacation.documentLeaveOpportunity",
		requires: "orgAdmin",
		schema: opportunitySchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const assessed = yield* storeStep(
				"vacation.documentLeaveOpportunity",
				(db) =>
					documentLeaveOpportunityInStore(db, {
						organizationId,
						noticeId: input.noticeId,
						basis: input.basis,
						assessedBy: actor.userId,
						assessedAt: new Date(),
					}),
				{ refusal: LeaveNoticeRefused },
			);
			revalidateLeaveNoticeViews();
			return assessed;
		}),
);

/** An employee's external leave notices and which outstanding days they cover (#2082). */
export const getEmployeeLeaveNotices = organizationAction(
	{
		name: "vacation.employeeLeaveNotices",
		requires: "orgAdmin",
		schema: z.string().uuid(),
	},
	({ actor, organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			yield* findManagedEmployee(
				actor,
				organizationId,
				employeeId,
				"vacation_leave_notice",
				"read",
			);
			return yield* storeStep("vacation.employeeLeaveNotices", async (db) =>
				loadEmployeeLeaveNotices(db, {
					organizationId,
					employeeId,
					timezone: await loadOrganizationTimezone(db, organizationId),
					currentDate: new Date(),
				}),
			);
		}),
);
