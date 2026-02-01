/**
 * Compliance Detection Service
 *
 * Computes compliance findings for a date range and organization
 * using the rule engine. Does not persist findings (caller decides).
 */

import { and, eq, gte, lte, isNull } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employee, workPeriod, userSettings } from "@/db/schema";
import { complianceConfig, workPolicy, workPolicyAssignment, workPolicyRegulation } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import {
	COMPLIANCE_RULES,
	getEnabledRules,
	type ComplianceFindingResult,
	type ComplianceThresholds,
	type EmployeeWithPolicy,
	type RuleDetectionInput,
	type WorkPeriodData,
} from "@/lib/compliance/rules";
import { DatabaseError } from "../errors";

const logger = createLogger("ComplianceDetectionService");

// ============================================
// TYPES
// ============================================

export interface DetectFindingsInput {
	organizationId: string;
	dateRange: {
		start: DateTime;
		end: DateTime;
	};
	employeeIds?: string[]; // Optional filter
}

export interface DetectionResult {
	findings: ComplianceFindingResult[];
	stats: {
		employeesChecked: number;
		rulesApplied: number;
		findingsDetected: number;
		byType: Record<string, number>;
		bySeverity: Record<string, number>;
	};
}

// ============================================
// SERVICE DEFINITION
// ============================================

export class ComplianceDetectionService extends Context.Tag("ComplianceDetectionService")<
	ComplianceDetectionService,
	{
		/**
		 * Detect findings for an organization within a date range
		 */
		readonly detectFindings: (
			input: DetectFindingsInput,
		) => Effect.Effect<DetectionResult, DatabaseError>;

		/**
		 * Detect findings for a single employee
		 */
		readonly detectForEmployee: (params: {
			employeeId: string;
			organizationId: string;
			dateRange: { start: DateTime; end: DateTime };
		}) => Effect.Effect<ComplianceFindingResult[], DatabaseError>;
	}
>() {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const ComplianceDetectionServiceLive = Layer.succeed(
	ComplianceDetectionService,
	ComplianceDetectionService.of({
		detectFindings: (input) =>
			Effect.tryPromise({
				try: async () => {
					const { organizationId, dateRange, employeeIds } = input;

					logger.info(
						{
							organizationId,
							startDate: dateRange.start.toISO(),
							endDate: dateRange.end.toISO(),
							employeeFilter: employeeIds?.length ?? "all",
						},
						"Starting compliance detection",
					);

					// 1. Get compliance config for the organization
					const config = await db.query.complianceConfig.findFirst({
						where: eq(complianceConfig.organizationId, organizationId),
					});

					// If no config, use defaults (all rules enabled)
					const enabledRules = getEnabledRules({
						restPeriod: config?.detectRestPeriodViolations ?? true,
						maxHoursDaily: config?.detectMaxHoursDaily ?? true,
						maxHoursWeekly: config?.detectMaxHoursWeekly ?? true,
						consecutiveDays: config?.detectConsecutiveDays ?? true,
					});

					if (enabledRules.length === 0) {
						logger.info({ organizationId }, "No rules enabled, skipping detection");
						return {
							findings: [],
							stats: {
								employeesChecked: 0,
								rulesApplied: 0,
								findingsDetected: 0,
								byType: {},
								bySeverity: {},
							},
						};
					}

					// Threshold overrides from config
					const thresholdOverrides: ComplianceThresholds | null = config
						? {
								restPeriodMinutes: config.restPeriodMinutes,
								maxDailyMinutes: config.maxDailyMinutes,
								maxWeeklyMinutes: config.maxWeeklyMinutes,
								maxConsecutiveDays: config.maxConsecutiveDays,
							}
						: null;

					// 2. Get employees with their policies
					const employees = await getEmployeesWithPolicies(organizationId, employeeIds);

					logger.debug(
						{ organizationId, employeeCount: employees.length },
						"Loaded employees with policies",
					);

					// 3. For each employee, get work periods and run detection
					const allFindings: ComplianceFindingResult[] = [];
					const stats = {
						employeesChecked: 0,
						rulesApplied: enabledRules.length,
						findingsDetected: 0,
						byType: {} as Record<string, number>,
						bySeverity: {} as Record<string, number>,
					};

					for (const emp of employees) {
						stats.employeesChecked++;

						// Get work periods for this employee in the date range
						// Expand date range slightly to catch rest period violations
						const expandedStart = dateRange.start.minus({ days: 1 });
						const expandedEnd = dateRange.end.plus({ days: 1 });

						const periods = await getWorkPeriodsForEmployee(
							emp.id,
							expandedStart.toJSDate(),
							expandedEnd.toJSDate(),
						);

						if (periods.length === 0) {
							continue;
						}

						// Run each enabled rule
						const ruleInput: RuleDetectionInput = {
							employee: emp,
							workPeriods: periods,
							dateRange,
							thresholdOverrides,
						};

						for (const rule of enabledRules) {
							try {
								const findings = await rule.detectViolations(ruleInput);

								for (const finding of findings) {
									allFindings.push(finding);
									stats.findingsDetected++;
									stats.byType[finding.type] = (stats.byType[finding.type] ?? 0) + 1;
									stats.bySeverity[finding.severity] =
										(stats.bySeverity[finding.severity] ?? 0) + 1;
								}
							} catch (error) {
								logger.error(
									{ error, rule: rule.name, employeeId: emp.id },
									"Rule detection failed",
								);
								// Continue with other rules
							}
						}
					}

					logger.info(
						{
							organizationId,
							stats,
						},
						"Compliance detection completed",
					);

					return { findings: allFindings, stats };
				},
				catch: (error) =>
					new DatabaseError({
						message: `Failed to detect compliance findings: ${error instanceof Error ? error.message : String(error)}`,
						operation: "detectComplianceFindings",
						cause: error instanceof Error ? error : undefined,
					}),
			}),

		detectForEmployee: (params) =>
			Effect.tryPromise({
				try: async () => {
					const { employeeId, organizationId, dateRange } = params;

					// Get employee with policy
					const employees = await getEmployeesWithPolicies(organizationId, [employeeId]);
					if (employees.length === 0) {
						return [];
					}

					const emp = employees[0];

					// Get config
					const config = await db.query.complianceConfig.findFirst({
						where: eq(complianceConfig.organizationId, organizationId),
					});

					const enabledRules = getEnabledRules({
						restPeriod: config?.detectRestPeriodViolations ?? true,
						maxHoursDaily: config?.detectMaxHoursDaily ?? true,
						maxHoursWeekly: config?.detectMaxHoursWeekly ?? true,
						consecutiveDays: config?.detectConsecutiveDays ?? true,
					});

					const thresholdOverrides: ComplianceThresholds | null = config
						? {
								restPeriodMinutes: config.restPeriodMinutes,
								maxDailyMinutes: config.maxDailyMinutes,
								maxWeeklyMinutes: config.maxWeeklyMinutes,
								maxConsecutiveDays: config.maxConsecutiveDays,
							}
						: null;

					// Get work periods
					const expandedStart = dateRange.start.minus({ days: 1 });
					const expandedEnd = dateRange.end.plus({ days: 1 });

					const periods = await getWorkPeriodsForEmployee(
						employeeId,
						expandedStart.toJSDate(),
						expandedEnd.toJSDate(),
					);

					if (periods.length === 0) {
						return [];
					}

					// Run rules
					const ruleInput: RuleDetectionInput = {
						employee: emp,
						workPeriods: periods,
						dateRange,
						thresholdOverrides,
					};

					const allFindings: ComplianceFindingResult[] = [];

					for (const rule of enabledRules) {
						try {
							const findings = await rule.detectViolations(ruleInput);
							allFindings.push(...findings);
						} catch (error) {
							logger.error({ error, rule: rule.name, employeeId }, "Rule detection failed");
						}
					}

					return allFindings;
				},
				catch: (error) =>
					new DatabaseError({
						message: `Failed to detect findings for employee: ${error instanceof Error ? error.message : String(error)}`,
						operation: "detectForEmployee",
						cause: error instanceof Error ? error : undefined,
					}),
			}),
	}),
);

// ============================================
// HELPER FUNCTIONS
// ============================================

async function getEmployeesWithPolicies(
	organizationId: string,
	employeeIds?: string[],
): Promise<EmployeeWithPolicy[]> {
	// Query employees
	const conditions = [eq(employee.organizationId, organizationId), eq(employee.isActive, true)];

	if (employeeIds && employeeIds.length > 0) {
		// Filter by specific employees
		// Note: For proper IN clause, would need to use inArray from drizzle
		// For now, we'll handle this in JavaScript
	}

	const employees = await db.query.employee.findMany({
		where: and(...conditions),
		columns: {
			id: true,
			organizationId: true,
			firstName: true,
			lastName: true,
			userId: true,
		},
	});

	// Filter by employeeIds if provided
	const filteredEmployees = employeeIds
		? employees.filter((e) => employeeIds.includes(e.id))
		: employees;

	// Get user settings for timezone
	const userIds = filteredEmployees.map((e) => e.userId).filter(Boolean) as string[];
	const settings = await db.query.userSettings.findMany({
		where: userIds.length > 0 ? undefined : undefined, // Would use inArray(userSettings.userId, userIds)
	});

	const settingsMap = new Map(settings.map((s) => [s.userId, s]));

	// Get effective policies for employees
	const result: EmployeeWithPolicy[] = [];

	for (const emp of filteredEmployees) {
		// Get effective policy (employee > team > org hierarchy)
		const policy = await getEffectivePolicyForEmployee(emp.id, organizationId);

		const userSetting = emp.userId ? settingsMap.get(emp.userId) : null;
		const timezone = userSetting?.timezone ?? "Europe/Berlin"; // Default to German timezone

		result.push({
			id: emp.id,
			organizationId: emp.organizationId,
			firstName: emp.firstName,
			lastName: emp.lastName,
			timezone,
			policy,
		});
	}

	return result;
}

async function getEffectivePolicyForEmployee(
	employeeId: string,
	organizationId: string,
): Promise<EmployeeWithPolicy["policy"]> {
	// Find assignments ordered by priority (employee=2 > team=1 > org=0)
	const assignments = await db.query.workPolicyAssignment.findMany({
		where: and(
			eq(workPolicyAssignment.organizationId, organizationId),
			eq(workPolicyAssignment.isActive, true),
		),
		with: {
			policy: {
				with: {
					regulation: true,
				},
			},
		},
		orderBy: (table, { desc }) => [desc(table.priority)],
	});

	// Find best matching assignment
	for (const assignment of assignments) {
		if (!assignment.policy?.isActive || !assignment.policy.regulationEnabled) {
			continue;
		}

		// Check if this assignment applies to the employee
		if (assignment.assignmentType === "employee" && assignment.employeeId === employeeId) {
			return extractPolicyData(assignment);
		}

		// For team assignments, would need to check team membership
		// For org assignments, all employees match
		if (assignment.assignmentType === "organization") {
			return extractPolicyData(assignment);
		}
	}

	return null;
}

function extractPolicyData(
	assignment: Awaited<ReturnType<typeof db.query.workPolicyAssignment.findMany>>[0] & {
		policy: { id: string; name: string; regulation: unknown } | null;
	},
): EmployeeWithPolicy["policy"] {
	const policy = assignment.policy;
	if (!policy) return null;

	const regulation = policy.regulation as {
		maxDailyMinutes: number | null;
		maxWeeklyMinutes: number | null;
		minRestPeriodMinutes: number | null;
	} | null;

	return {
		policyId: policy.id,
		policyName: policy.name,
		maxDailyMinutes: regulation?.maxDailyMinutes ?? null,
		maxWeeklyMinutes: regulation?.maxWeeklyMinutes ?? null,
		minRestPeriodMinutes: regulation?.minRestPeriodMinutes ?? null,
		maxConsecutiveDays: null, // Not in standard regulation, comes from complianceConfig
	};
}

async function getWorkPeriodsForEmployee(
	employeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<WorkPeriodData[]> {
	const periods = await db.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.employeeId, employeeId),
			gte(workPeriod.startTime, startDate),
			lte(workPeriod.startTime, endDate),
		),
		columns: {
			id: true,
			employeeId: true,
			startTime: true,
			endTime: true,
			durationMinutes: true,
			isActive: true,
		},
		orderBy: (table, { asc }) => [asc(table.startTime)],
	});

	return periods;
}
