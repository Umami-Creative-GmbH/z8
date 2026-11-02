import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { member } from "@/db/auth-schema";
import {
	absenceCategory,
	approvalPolicy,
	approvalPolicyCondition,
	approvalPolicyStage,
	changePolicy,
	changePolicyAssignment,
	customRole,
	employee,
	employeeCustomRole,
	employeeGroup,
	employeeGroupMember,
	employeeManagers,
	payrollExpenseWageTypeMapping,
	payrollExportConfig,
	payrollWageTypeMapping,
	team,
	teamMembership,
} from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { ImplementationChecklistCoveredConfiguration } from "../definition";

/**
 * Configuration fingerprints for manual checklist confirmations (#1516,
 * Organization ADR 0007). A fingerprint is a SHA-256 over the organization's
 * current rows of the covered configuration, so it changes when a row is added,
 * changed or removed, including hard deletes that leave no timestamp behind.
 *
 * Only business columns count: never timestamps or who saved, so a save that
 * changes nothing keeps the fingerprint. Rows that settings pages replace on
 * save (routing stages and conditions) are compared by content, not id. Every
 * query is scoped to the organization; tables without an organization column
 * are scoped through their parent.
 */

/** Bump when the fingerprinted columns change: every stored fingerprint then reads as stale. */
const FINGERPRINT_VERSION = 1;

type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
/** A database or a transaction to read the configuration in. */
export type FingerprintReader = Pick<DatabaseClient | Transaction, "select">;

/** Lazy row queries by section name; each runs when awaited. */
type Sections = Record<string, PromiseLike<readonly Record<string, unknown>[]>>;

function organizationStructure(database: FingerprintReader, organizationId: string): Sections {
	return {
		teams: database
			.select({ id: team.id, name: team.name, primaryManagerId: team.primaryManagerId })
			.from(team)
			.where(eq(team.organizationId, organizationId)),
		memberships: database
			.select({ teamId: teamMembership.teamId, employeeId: teamMembership.employeeId })
			.from(teamMembership)
			.where(eq(teamMembership.organizationId, organizationId)),
		// Primary team and role of every employee, so a joining member counts too.
		employees: database
			.select({ id: employee.id, teamId: employee.teamId, role: employee.role })
			.from(employee)
			.where(eq(employee.organizationId, organizationId)),
		managerLinks: database
			.select({
				employeeId: employeeManagers.employeeId,
				managerId: employeeManagers.managerId,
				isPrimary: employeeManagers.isPrimary,
			})
			.from(employeeManagers)
			.innerJoin(employee, eq(employee.id, employeeManagers.employeeId))
			.where(eq(employee.organizationId, organizationId)),
		memberRoles: database
			.select({ userId: member.userId, role: member.role, status: member.status })
			.from(member)
			.where(eq(member.organizationId, organizationId)),
		customRoleAssignments: database
			.select({
				employeeId: employeeCustomRole.employeeId,
				customRoleId: employeeCustomRole.customRoleId,
			})
			.from(employeeCustomRole)
			.innerJoin(customRole, eq(customRole.id, employeeCustomRole.customRoleId))
			.where(eq(customRole.organizationId, organizationId)),
	};
}

function approvalRules(database: FingerprintReader, organizationId: string): Sections {
	return {
		changePolicies: database
			.select({
				id: changePolicy.id,
				selfServiceDays: changePolicy.selfServiceDays,
				approvalDays: changePolicy.approvalDays,
				noApprovalRequired: changePolicy.noApprovalRequired,
				notifyAllManagers: changePolicy.notifyAllManagers,
				isActive: changePolicy.isActive,
			})
			.from(changePolicy)
			.where(eq(changePolicy.organizationId, organizationId)),
		changePolicyAssignments: database
			.select({
				policyId: changePolicyAssignment.policyId,
				assignmentType: changePolicyAssignment.assignmentType,
				teamId: changePolicyAssignment.teamId,
				employeeId: changePolicyAssignment.employeeId,
				priority: changePolicyAssignment.priority,
				effectiveFrom: changePolicyAssignment.effectiveFrom,
				effectiveUntil: changePolicyAssignment.effectiveUntil,
				isActive: changePolicyAssignment.isActive,
			})
			.from(changePolicyAssignment)
			.where(eq(changePolicyAssignment.organizationId, organizationId)),
		routingPolicies: database
			.select({
				id: approvalPolicy.id,
				isActive: approvalPolicy.isActive,
				priority: approvalPolicy.priority,
			})
			.from(approvalPolicy)
			.where(eq(approvalPolicy.organizationId, organizationId)),
		routingConditions: database
			.select({
				policyId: approvalPolicyCondition.policyId,
				conditionType: approvalPolicyCondition.conditionType,
				operator: approvalPolicyCondition.operator,
				valueJson: approvalPolicyCondition.valueJson,
				amountMin: approvalPolicyCondition.amountMin,
				amountMax: approvalPolicyCondition.amountMax,
				overtimeRisk: approvalPolicyCondition.overtimeRisk,
				teamId: approvalPolicyCondition.teamId,
				locationId: approvalPolicyCondition.locationId,
				absenceCategoryId: approvalPolicyCondition.absenceCategoryId,
				employeeGroupId: approvalPolicyCondition.employeeGroupId,
			})
			.from(approvalPolicyCondition)
			.where(eq(approvalPolicyCondition.organizationId, organizationId)),
		routingStages: database
			.select({
				policyId: approvalPolicyStage.policyId,
				stepOrder: approvalPolicyStage.stepOrder,
				approverType: approvalPolicyStage.approverType,
				approverEmployeeId: approvalPolicyStage.approverEmployeeId,
				fallbackBehavior: approvalPolicyStage.fallbackBehavior,
			})
			.from(approvalPolicyStage)
			.where(eq(approvalPolicyStage.organizationId, organizationId)),
		// Routing conditions can name employee groups; who is in them changes routing.
		employeeGroups: database
			.select({ id: employeeGroup.id, isActive: employeeGroup.isActive })
			.from(employeeGroup)
			.where(eq(employeeGroup.organizationId, organizationId)),
		employeeGroupMembers: database
			.select({
				groupId: employeeGroupMember.groupId,
				employeeId: employeeGroupMember.employeeId,
			})
			.from(employeeGroupMember)
			.where(eq(employeeGroupMember.organizationId, organizationId)),
		absenceCategories: database
			.select({
				id: absenceCategory.id,
				requiresApproval: absenceCategory.requiresApproval,
				isActive: absenceCategory.isActive,
			})
			.from(absenceCategory)
			.where(eq(absenceCategory.organizationId, organizationId)),
	};
}

function payrollExport(database: FingerprintReader, organizationId: string): Sections {
	return {
		// The config may hold credentials: it only ever enters the hash, never storage.
		exportConfigs: database
			.select({
				id: payrollExportConfig.id,
				formatId: payrollExportConfig.formatId,
				config: payrollExportConfig.config,
				isActive: payrollExportConfig.isActive,
			})
			.from(payrollExportConfig)
			.where(eq(payrollExportConfig.organizationId, organizationId)),
		wageTypeMappings: database
			.select({
				workCategoryId: payrollWageTypeMapping.workCategoryId,
				absenceCategoryId: payrollWageTypeMapping.absenceCategoryId,
				specialCategory: payrollWageTypeMapping.specialCategory,
				wageTypeCode: payrollWageTypeMapping.wageTypeCode,
				wageTypeName: payrollWageTypeMapping.wageTypeName,
				datevWageTypeCode: payrollWageTypeMapping.datevWageTypeCode,
				datevWageTypeName: payrollWageTypeMapping.datevWageTypeName,
				lexwareWageTypeCode: payrollWageTypeMapping.lexwareWageTypeCode,
				lexwareWageTypeName: payrollWageTypeMapping.lexwareWageTypeName,
				sageWageTypeCode: payrollWageTypeMapping.sageWageTypeCode,
				sageWageTypeName: payrollWageTypeMapping.sageWageTypeName,
				successFactorsTimeTypeCode: payrollWageTypeMapping.successFactorsTimeTypeCode,
				successFactorsTimeTypeName: payrollWageTypeMapping.successFactorsTimeTypeName,
				factor: payrollWageTypeMapping.factor,
				isActive: payrollWageTypeMapping.isActive,
			})
			.from(payrollWageTypeMapping)
			.where(eq(payrollWageTypeMapping.organizationId, organizationId)),
		expenseWageTypeMappings: database
			.select({
				payrollLineKind: payrollExpenseWageTypeMapping.payrollLineKind,
				datevWageTypeCode: payrollExpenseWageTypeMapping.datevWageTypeCode,
				lexwareWageTypeCode: payrollExpenseWageTypeMapping.lexwareWageTypeCode,
				sageWageTypeCode: payrollExpenseWageTypeMapping.sageWageTypeCode,
				successFactorsWageTypeCode: payrollExpenseWageTypeMapping.successFactorsWageTypeCode,
			})
			.from(payrollExpenseWageTypeMapping)
			.where(eq(payrollExpenseWageTypeMapping.organizationId, organizationId)),
	};
}

const COVERED_SECTIONS: Record<
	ImplementationChecklistCoveredConfiguration,
	(database: FingerprintReader, organizationId: string) => Sections
> = {
	"organization-structure": organizationStructure,
	"approval-rules": approvalRules,
	"payroll-export": payrollExport,
};

/** JSON-ready value with object keys sorted, so equal rows always serialize the same. */
function canonical(value: unknown): unknown {
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(canonical);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
		);
	}
	return value ?? null;
}

/**
 * The fingerprint of the organization's current configuration that `covers`
 * names, as 64 hex characters. Pass a transaction to read it in the same
 * snapshot as a write.
 */
export async function computeConfirmationFingerprint(
	database: FingerprintReader,
	organizationId: string,
	covers: ImplementationChecklistCoveredConfiguration,
): Promise<string> {
	const sections = COVERED_SECTIONS[covers](database, organizationId);
	const content: [string, string[]][] = [];
	// One query at a time: a transaction's client runs them in sequence anyway.
	for (const name of Object.keys(sections).sort()) {
		const rows = await sections[name];
		content.push([name, (rows ?? []).map((row) => JSON.stringify(canonical(row))).sort()]);
	}

	return createHash("sha256")
		.update(JSON.stringify([FINGERPRINT_VERSION, covers, content]))
		.digest("hex");
}
