import "server-only";

import { and, eq } from "drizzle-orm";
import { expenseOfficerGrant, payrollAccessGrant, personnelFileOfficerGrant } from "@/db/schema";
import { revokePayrollAccessGrantHeldBy } from "@/lib/payroll-access/grant-store";
import { revokePersonnelFileOfficerGrantHeldBy } from "@/lib/personnel-file/officer-grant-store";
import { revokeExpenseOfficerGrantHeldBy } from "@/lib/travel-expenses/expense-officer-grant-store";
import { grantChecklistItem } from "../reactivation-checklist";
import { employmentEndingAuditMetadata } from "./cause";
import type { EmploymentEndingParticipant } from "./types";

export type OfficerGrantKind = "expense_officer" | "payroll_access" | "personnel_file_officer";
export type OfficerGrant = { kind: OfficerGrantKind; grantId: string };
export type OfficerGrantsEndingPlan = { grants: OfficerGrant[] };
export type OfficerGrantsEndingApplied = { grants: OfficerGrant[] };

/**
 * The expense officer, payroll access and personnel file officer grants the
 * employee holds end (#750, #866). Grants of other officers that name the
 * employee in their scope stay, so their last reports can still be reimbursed
 * and their file stays managed. Equipment officer and driving licence verifier
 * grants end with their own participants.
 */
export const officerGrantsEndingParticipant: EmploymentEndingParticipant<
	OfficerGrantsEndingPlan,
	OfficerGrantsEndingApplied,
	"officerGrants"
> = {
	key: "officerGrants",
	async plan(reader, ctx) {
		// One after another: inside the transaction the reader is a single connection.
		const expense = await reader
			.select({ id: expenseOfficerGrant.id })
			.from(expenseOfficerGrant)
			.where(
				and(
					eq(expenseOfficerGrant.organizationId, ctx.organizationId),
					eq(expenseOfficerGrant.officerEmployeeId, ctx.employeeId),
					eq(expenseOfficerGrant.isActive, true),
				),
			);
		const payroll = await reader
			.select({ id: payrollAccessGrant.id })
			.from(payrollAccessGrant)
			.where(
				and(
					eq(payrollAccessGrant.organizationId, ctx.organizationId),
					eq(payrollAccessGrant.payrollEmployeeId, ctx.employeeId),
					eq(payrollAccessGrant.isActive, true),
				),
			);
		const personnelFile = await reader
			.select({ id: personnelFileOfficerGrant.id })
			.from(personnelFileOfficerGrant)
			.where(
				and(
					eq(personnelFileOfficerGrant.organizationId, ctx.organizationId),
					eq(personnelFileOfficerGrant.officerEmployeeId, ctx.employeeId),
					eq(personnelFileOfficerGrant.isActive, true),
				),
			);
		const grant = (kind: OfficerGrantKind) => (row: { id: string }) => ({
			kind,
			grantId: row.id,
		});
		return {
			grants: [
				...expense.map(grant("expense_officer")),
				...payroll.map(grant("payroll_access")),
				...personnelFile.map(grant("personnel_file_officer")),
			],
		};
	},
	async apply(tx, _plan, ctx) {
		// Each revocation re-reads under its lock; null when nothing was held any more.
		const held = {
			organizationId: ctx.organizationId,
			actorUserId: ctx.actorUserId,
			auditMetadata: employmentEndingAuditMetadata(ctx),
		};
		const expense = await revokeExpenseOfficerGrantHeldBy(tx, {
			...held,
			officerEmployeeId: ctx.employeeId,
		});
		const payroll = await revokePayrollAccessGrantHeldBy(tx, {
			...held,
			payrollEmployeeId: ctx.employeeId,
		});
		const personnelFile = await revokePersonnelFileOfficerGrantHeldBy(tx, {
			...held,
			officerEmployeeId: ctx.employeeId,
		});
		const grants: OfficerGrant[] = [];
		if (expense) grants.push({ kind: "expense_officer", grantId: expense });
		if (payroll) grants.push({ kind: "payroll_access", grantId: payroll });
		if (personnelFile) grants.push({ kind: "personnel_file_officer", grantId: personnelFile });
		return { applied: { grants } };
	},
	reactivationItems: (applied) => applied.grants.map((grant) => grantChecklistItem(grant.kind)),
};
