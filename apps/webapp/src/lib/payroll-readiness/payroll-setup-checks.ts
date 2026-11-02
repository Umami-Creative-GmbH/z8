import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { type db as database, payrollExportConfig, payrollWageTypeMapping } from "@/db";
import { employeeEmploymentHistory } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { PersonnelIdentifierClash } from "@/lib/payroll-export/personnel-identifier";
import type {
	PayrollReadinessAffectedEmployee,
	PayrollReadinessCheck,
} from "./get-payroll-readiness";

const logger = createLogger("PayrollReadiness");

type Database = typeof database;
type PayrollExportConfigRow = typeof payrollExportConfig.$inferSelect;

/** An employee whose payroll setup is checked, with what readiness names them by. */
export type PayrollSetupEmployee = {
	id: string;
	employeeNumber?: string | null;
	user?: { name?: string | null; email?: string | null } | null;
};

/**
 * Payroll readiness's setup checks: the ones about how payroll is set up rather
 * than about one pay period's time. Payroll readiness shows them for a period;
 * the payroll setup go-live check reuses them for today.
 */
export type PayrollSetupChecks = {
	/** Active payroll export configurations: what "an active payroll export target" means. */
	exportTargetCount: number;
	employmentHistory: PayrollReadinessCheck;
	exportTargets: PayrollReadinessCheck;
	wageTypeMappings: PayrollReadinessCheck;
	personnelIdentifiers: PayrollReadinessCheck;
	/** The clashes behind `personnelIdentifiers`, named; empty when the lookup failed. */
	identifierClashes: PersonnelIdentifierClash[];
};

export type LoadPayrollSetupChecksInput = {
	organizationId: string;
	/** The employees whose confirmed employment terms are checked. */
	employees: readonly PayrollSetupEmployee[];
	/** Confirmed terms must overlap `[start, end]`. */
	termsWindow: { start: Date; end: Date };
	/**
	 * The employees the active configurations would write under one personnel
	 * identifier. The caller picks who is compared; a rejection makes the check
	 * unavailable, never passing.
	 */
	findIdentifierClashes: (
		configs: readonly PayrollExportConfigRow[],
	) => Promise<PersonnelIdentifierClash[]>;
};

/** Loads payroll readiness's setup checks for one organization. Read-only. */
export async function loadPayrollSetupChecks(
	reader: Database,
	input: LoadPayrollSetupChecksInput,
): Promise<PayrollSetupChecks> {
	const { organizationId } = input;
	const [employmentHistoryRows, exportConfigs] = await Promise.all([
		reader.query.employeeEmploymentHistory.findMany({
			where: and(
				eq(employeeEmploymentHistory.organizationId, organizationId),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				lte(employeeEmploymentHistory.validFrom, input.termsWindow.end),
				or(
					isNull(employeeEmploymentHistory.validUntil),
					gt(employeeEmploymentHistory.validUntil, input.termsWindow.start),
				),
			),
		}),
		reader.query.payrollExportConfig.findMany({
			where: and(
				eq(payrollExportConfig.organizationId, organizationId),
				eq(payrollExportConfig.isActive, true),
			),
		}),
	]);

	const [wageMappings, identifierClashLookup] = await Promise.all([
		exportConfigs.length > 0
			? reader.query.payrollWageTypeMapping.findMany({
					where: and(
						eq(payrollWageTypeMapping.isActive, true),
						eq(payrollWageTypeMapping.organizationId, organizationId),
					),
				})
			: [],
		// Employees an export would merge under one personnel identifier (#1198); a failed
		// lookup must surface as unavailable, never as ready.
		input.findIdentifierClashes(exportConfigs).then(
			(clashes) => ({ available: true as const, clashes }),
			(error: unknown) => {
				logger.error(
					{ organizationId, error },
					"Payroll readiness could not check for shared personnel identifiers",
				);
				return { available: false as const, clashes: [] };
			},
		),
	]);

	const employeesWithEmploymentHistory = new Set(
		employmentHistoryRows.map((row) => row.employeeId),
	);
	const missingEmploymentHistory = input.employees.filter(
		(employee) => !employeesWithEmploymentHistory.has(employee.id),
	);
	const employeesById = new Map(input.employees.map((employee) => [employee.id, employee]));

	// One row per clashing employee, with the identifier the export writes for them.
	const identifierClashEmployees = new Map<string, PayrollReadinessAffectedEmployee>();
	for (const clash of identifierClashLookup.clashes) {
		for (const holder of clash.employees) {
			if (identifierClashEmployees.has(holder.employeeId)) continue;
			const known = employeesById.get(holder.employeeId);
			identifierClashEmployees.set(holder.employeeId, {
				id: holder.employeeId,
				name: holder.name ?? known?.user?.name,
				email: known?.user?.email,
				employeeNumber: known?.employeeNumber ?? null,
				personnelIdentifier: holder.identifier,
			});
		}
	}

	return {
		exportTargetCount: exportConfigs.length,
		employmentHistory: {
			id: "missing-employment-history",
			group: "payrollSetup",
			title: "Employment history coverage",
			titleKey: "settings.payrollReadiness.checks.missingEmploymentHistory.title",
			...(missingEmploymentHistory.length > 0
				? {
						description:
							"Some active employees do not have confirmed employment history for this payroll period.",
						descriptionKey:
							"settings.payrollReadiness.checks.missingEmploymentHistory.descriptionWarning",
					}
				: {
						description:
							"All active employees have confirmed employment history for this payroll period.",
						descriptionKey:
							"settings.payrollReadiness.checks.missingEmploymentHistory.descriptionPass",
					}),
			status: missingEmploymentHistory.length > 0 ? "warning" : "pass",
			severity: "warning",
			required: false,
			count: missingEmploymentHistory.length,
			actionHref: "/settings/employees",
			actionLabel: "Review employees",
			affectedEmployees: missingEmploymentHistory.map((employee) => ({
				id: employee.id,
				name: employee.user?.name,
				email: employee.user?.email,
				employeeNumber: employee.employeeNumber ?? null,
			})),
		},
		exportTargets: {
			id: "payroll-export-targets",
			group: "payrollSetup",
			title: "Payroll export targets",
			titleKey: "settings.payrollReadiness.checks.payrollExportTargets.title",
			description: "At least one active payroll export target must be configured.",
			descriptionKey: "settings.payrollReadiness.checks.payrollExportTargets.description",
			status: exportConfigs.length > 0 ? "pass" : "fail",
			severity: "blocker",
			required: true,
			count: exportConfigs.length,
			actionHref: "/settings/payroll-export",
			affectedEmployees: [],
		},
		wageTypeMappings: {
			id: "wage-type-mappings",
			group: "payrollSetup",
			title: "Wage type mappings",
			titleKey: "settings.payrollReadiness.checks.wageTypeMappings.title",
			description: "Active payroll wage type mappings must exist for export classification.",
			descriptionKey: "settings.payrollReadiness.checks.wageTypeMappings.description",
			status: wageMappings.length > 0 ? "pass" : "fail",
			severity: "blocker",
			required: true,
			count: wageMappings.length,
			actionHref: "/settings/payroll-export",
			affectedEmployees: [],
		},
		personnelIdentifiers: {
			id: "duplicate-personnel-identifiers",
			group: "exports",
			title: "Shared personnel identifiers",
			titleKey: "settings.payrollReadiness.checks.duplicatePersonnelIdentifiers.title",
			description:
				"Employees a payroll export would write under the same personnel identifier. The payroll system would merge them, so the export is refused until each employee has their own.",
			descriptionKey: "settings.payrollReadiness.checks.duplicatePersonnelIdentifiers.description",
			status: !identifierClashLookup.available
				? "unavailable"
				: identifierClashEmployees.size > 0
					? "fail"
					: "pass",
			severity: "blocker",
			required: true,
			count: identifierClashEmployees.size,
			actionHref: "/settings/employees",
			affectedEmployees: [...identifierClashEmployees.values()],
		},
		identifierClashes: identifierClashLookup.clashes,
	};
}
