/**
 * Seeds legacy travel expense claims for PostgreSQL integration tests.
 *
 * No server action creates or submits a `travel_expense_claim` any more (#621):
 * new expenses are reports, and legacy drafts are converted rather than submitted
 * (#616). Claims submitted before that stay decidable, transferable, deliverable
 * and readable. This seeds such claims: a draft row as the retired draft action
 * stored it, and the historical submission through the real approval workflow,
 * evidence capture and delivery-intent writers in one transaction. Only used
 * against the label-owned disposable database.
 */
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { db } from "@/db";
import { employee, travelExpenseClaim } from "@/db/schema";
import { acquireApprovalWriteLock } from "@/lib/approvals/authority";
import { recordLegacyDeliveryIntent } from "@/lib/approvals/delivery/intents";
import { kickApprovalDelivery } from "@/lib/approvals/delivery/kick";
import { captureTravelExpenseSubmissionEvidence } from "@/lib/approvals/evidence";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { createTravelExpenseApprovalWorkflow } from "@/lib/approvals/server/travel-expense-approvals";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { dateFromInstant, parsePlainDate } from "@/lib/datetime/temporal-core";

type Database = typeof db;

export interface LegacyTravelExpenseDraftInput {
	organizationId: string;
	employeeId: string;
	userId: string;
	type?: "receipt" | "mileage" | "per_diem";
	tripStart?: string;
	tripEnd?: string;
	/** The zone the logical trip dates were entered in. */
	timeZone?: string;
	destinationCity?: string | null;
	destinationCountry?: string | null;
	amount?: string;
	currency?: string;
	notes?: string | null;
}

/**
 * Inserts a legacy draft with entered logical trip dates and the compatibility
 * bounds derived from them in `timeZone`, as legacy drafts were stored.
 */
export async function insertLegacyTravelExpenseDraft(
	database: Database,
	input: LegacyTravelExpenseDraftInput,
): Promise<string> {
	const timeZone = input.timeZone ?? "Europe/Berlin";
	const tripStartDate = parsePlainDate(input.tripStart ?? "2026-03-29");
	const tripEndDate = parsePlainDate(input.tripEnd ?? "2026-03-31");
	const amount = input.amount ?? "120.50";
	const currency = input.currency ?? "EUR";
	const [created] = await database
		.insert(travelExpenseClaim)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			type: input.type ?? "receipt",
			status: "draft",
			tripStart: dateFromInstant(tripStartDate.toZonedDateTime(timeZone).toInstant()),
			tripEnd: dateFromInstant(
				tripEndDate
					.add({ days: 1 })
					.toZonedDateTime(timeZone)
					.toInstant()
					.subtract({ milliseconds: 1 }),
			),
			tripStartDate: tripStartDate.toString(),
			tripEndDate: tripEndDate.toString(),
			tripDateTimeZone: timeZone,
			destinationCity: input.destinationCity === undefined ? "Hamburg" : input.destinationCity,
			destinationCountry: input.destinationCountry === undefined ? "DE" : input.destinationCountry,
			originalCurrency: currency,
			originalAmount: amount,
			calculatedCurrency: currency,
			calculatedAmount: amount,
			notes: input.notes ?? null,
			createdBy: input.userId,
			updatedBy: input.userId,
			updatedAt: new Date(),
		})
		.returning({ id: travelExpenseClaim.id });
	if (!created) throw new Error("Legacy draft insert returned no row");
	return created.id;
}

export interface LegacyTravelExpenseSubmission {
	status: "submitted" | "approved";
	approvalRequestId: string;
}

/**
 * Submits the legacy draft `claimId` as the requester did before #621: routes it
 * to the requester's primary eligible manager, captures the frozen submission
 * evidence while capture is active and commits the approver's delivery intent,
 * then kicks delivery. Throws when the claim cannot be submitted.
 */
export async function submitLegacyTravelExpenseClaim(
	database: Database,
	input: { organizationId: string; employeeId: string; userId: string; claimId: string },
): Promise<LegacyTravelExpenseSubmission> {
	const requester = await database.query.employee.findFirst({
		where: and(
			eq(employee.id, input.employeeId),
			eq(employee.organizationId, input.organizationId),
			eq(employee.isActive, true),
		),
		columns: { teamId: true },
	});
	if (!requester) throw new Error("Legacy submission needs an active requester");
	const approverId = await getPrimaryEligibleManagerIdForRequester({
		db: database,
		requesterEmployeeId: input.employeeId,
		organizationId: input.organizationId,
	});
	if (!approverId) throw new Error("Legacy submission needs an eligible manager");

	const submittedAt = new Date();
	const submission = await database.transaction(async (tx) => {
		const approvalDbService = {
			db: tx,
			query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
		} satisfies ApprovalDbService;
		await acquireApprovalWriteLock(approvalDbService, {
			organizationId: input.organizationId,
			workflowType: "travel_expense",
		});
		// The same row lock receipt finalization takes.
		const [claim] = await tx
			.select({
				id: travelExpenseClaim.id,
				employeeId: travelExpenseClaim.employeeId,
				status: travelExpenseClaim.status,
				calculatedAmount: travelExpenseClaim.calculatedAmount,
			})
			.from(travelExpenseClaim)
			.where(
				and(
					eq(travelExpenseClaim.id, input.claimId),
					eq(travelExpenseClaim.organizationId, input.organizationId),
				),
			)
			.for("update");
		if (!claim || claim.employeeId !== input.employeeId || claim.status !== "draft") {
			throw new Error("Only the requester's legacy drafts can be submitted");
		}
		await tx
			.update(travelExpenseClaim)
			.set({
				status: "submitted",
				approverId,
				submittedAt,
				updatedBy: input.userId,
				updatedAt: submittedAt,
			})
			.where(eq(travelExpenseClaim.id, claim.id));

		const routing = await Effect.runPromise(
			createTravelExpenseApprovalWorkflow(approvalDbService, {
				claim: {
					id: claim.id,
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					calculatedAmount: claim.calculatedAmount,
					employee: { teamId: requester.teamId ?? null },
				},
				defaultApproverId: approverId,
			}),
		);
		await captureTravelExpenseSubmissionEvidence(tx, {
			organizationId: input.organizationId,
			claimId: claim.id,
			submitter: { employeeId: input.employeeId, userId: input.userId },
			routing,
		});
		if (routing.kind === "auto_completed") {
			return { routing, deliveryIntent: false };
		}
		const deliveryIntent = await recordLegacyDeliveryIntent(tx, {
			organizationId: input.organizationId,
			workflowType: "travel_expense",
			sourceType: "travel_expense_claim",
			sourceId: claim.id,
			approvalRequestId: routing.approvalRequestId,
			event: "submitted",
		});
		return { routing, deliveryIntent };
	});

	if (submission.deliveryIntent) {
		kickApprovalDelivery({ organizationId: input.organizationId });
	}
	return {
		status: submission.routing.kind === "auto_completed" ? "approved" : "submitted",
		approvalRequestId: submission.routing.approvalRequestId,
	};
}
