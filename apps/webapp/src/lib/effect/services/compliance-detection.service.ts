/**
 * Compliance Detection Service
 *
 * Computes compliance findings for a date range and organization
 * using the rule engine. Does not persist findings (caller decides).
 */

import { and, eq, gte, lte, isNull } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "@/db";
import { employee, workPeriod, userSettings } from "@/db/schema";
import {
	complianceConfig,
	workPolicy,
	workPolicyAssignment,
	workPolicyRegulation,
	workPolicyPresence,
	absenceEntry,
	holiday,
} from "@/db/schema";
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
import {
	PresenceRequirementRule,
	type PresenceRuleDetectionInput,
	type PresenceConfig,
	type WorkPeriodWithLocation,
	type AbsenceDay,
	type HolidayDay,
} from "@/lib/compliance/rules/presence-requirement-rule";
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
					const presenceDetectionEnabled = config?.detectPresenceRequirement ?? true;
					const enabledRules = getEnabledRules({
						restPeriod: config?.detectRestPeriodViolations ?? true,
						maxHoursDaily: config?.detectMaxHoursDaily ?? true,
						maxHoursWeekly: config?.detectMaxHoursWeekly ?? true,
						consecutiveDays: config?.detectConsecutiveDays ?? true,
						presenceRequirement: false, // Presence runs separately with its own schedule
					});

					if (enabledRules.length === 0 && !presenceDetectionEnabled) {
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

					// Check if today is a presence evaluation trigger day
					const now = DateTime.now();

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

						if (periods.length === 0 && !presenceDetectionEnabled) {
							continue;
						}

						// Run each enabled rule (non-presence rules)
						if (periods.length > 0) {
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

						// Run presence detection if enabled and the employee has a presence policy
						if (presenceDetectionEnabled && emp.policy?.policyId) {
							try {
								const presenceFindings = await detectPresenceForEmployee(
									emp,
									now,
									organizationId,
								);

								for (const finding of presenceFindings) {
									allFindings.push(finding);
									stats.findingsDetected++;
									stats.byType[finding.type] = (stats.byType[finding.type] ?? 0) + 1;
									stats.bySeverity[finding.severity] =
										(stats.bySeverity[finding.severity] ?? 0) + 1;
								}
							} catch (error) {
								logger.error(
									{ error, employeeId: emp.id },
									"Presence detection failed",
								);
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

					const presenceDetectionEnabled = config?.detectPresenceRequirement ?? true;
					const enabledRules = getEnabledRules({
						restPeriod: config?.detectRestPeriodViolations ?? true,
						maxHoursDaily: config?.detectMaxHoursDaily ?? true,
						maxHoursWeekly: config?.detectMaxHoursWeekly ?? true,
						consecutiveDays: config?.detectConsecutiveDays ?? true,
						presenceRequirement: false, // Presence runs separately with its own schedule
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

					const allFindings: ComplianceFindingResult[] = [];

					// Run standard rules if there are work periods
					if (periods.length > 0) {
						const ruleInput: RuleDetectionInput = {
							employee: emp,
							workPeriods: periods,
							dateRange,
							thresholdOverrides,
						};

						for (const rule of enabledRules) {
							try {
								const findings = await rule.detectViolations(ruleInput);
								allFindings.push(...findings);
							} catch (error) {
								logger.error({ error, rule: rule.name, employeeId }, "Rule detection failed");
							}
						}
					}

					// Run presence detection if enabled
					if (presenceDetectionEnabled && emp.policy?.policyId) {
						try {
							const now = DateTime.now();
							const presenceFindings = await detectPresenceForEmployee(
								emp,
								now,
								organizationId,
							);
							allFindings.push(...presenceFindings);
						} catch (error) {
							logger.error({ error, employeeId }, "Presence detection failed");
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

// ============================================
// PRESENCE DETECTION HELPERS
// ============================================

const DAY_NAME_TO_WEEKDAY: Record<string, number> = {
	monday: 1,
	tuesday: 2,
	wednesday: 3,
	thursday: 4,
	friday: 5,
	saturday: 6,
	sunday: 7,
};

/**
 * Check if today is the correct day to evaluate presence for a given evaluation period.
 * - weekly: every Monday
 * - biweekly: every other Monday (even ISO week numbers)
 * - monthly: 1st of each month
 */
function isPresenceEvaluationDay(evaluationPeriod: string, now: DateTime): boolean {
	switch (evaluationPeriod) {
		case "weekly":
			return now.weekday === 1; // Monday
		case "biweekly":
			return now.weekday === 1 && now.weekNumber % 2 === 0; // Every other Monday
		case "monthly":
			return now.day === 1; // 1st of month
		default:
			return false;
	}
}

/**
 * Get the date range to evaluate based on the evaluation period.
 * Always looks backward from "now":
 * - weekly: previous full week (Mon-Sun)
 * - biweekly: previous two full weeks
 * - monthly: previous full month
 */
function getPresenceEvaluationRange(
	evaluationPeriod: string,
	now: DateTime,
): { start: DateTime; end: DateTime } {
	switch (evaluationPeriod) {
		case "weekly":
			return {
				start: now.minus({ weeks: 1 }).startOf("week"),
				end: now.minus({ weeks: 1 }).endOf("week"),
			};
		case "biweekly":
			return {
				start: now.minus({ weeks: 2 }).startOf("week"),
				end: now.minus({ weeks: 1 }).endOf("week"),
			};
		case "monthly":
			return {
				start: now.minus({ months: 1 }).startOf("month"),
				end: now.minus({ months: 1 }).endOf("month"),
			};
		default:
			return {
				start: now.minus({ weeks: 1 }).startOf("week"),
				end: now.minus({ weeks: 1 }).endOf("week"),
			};
	}
}

/**
 * Detect presence requirement violations for a single employee.
 * Checks if the employee has a presence-enabled policy, if today is an
 * evaluation trigger day, and runs the PresenceRequirementRule.
 */
async function detectPresenceForEmployee(
	emp: EmployeeWithPolicy,
	now: DateTime,
	organizationId: string,
): Promise<ComplianceFindingResult[]> {
	if (!emp.policy?.policyId) return [];

	// Check if the policy has presence enabled
	const policyRow = await db.query.workPolicy.findFirst({
		where: and(
			eq(workPolicy.id, emp.policy.policyId),
			eq(workPolicy.presenceEnabled, true),
		),
		columns: { id: true },
	});

	if (!policyRow) return [];

	// Load the presence configuration
	const presenceRow = await db.query.workPolicyPresence.findFirst({
		where: eq(workPolicyPresence.policyId, emp.policy.policyId),
	});

	if (!presenceRow) return [];

	// Check if today is an evaluation trigger day for this evaluation period
	if (!isPresenceEvaluationDay(presenceRow.evaluationPeriod, now)) {
		return [];
	}

	const evalRange = getPresenceEvaluationRange(presenceRow.evaluationPeriod, now);

	logger.debug(
		{
			employeeId: emp.id,
			evaluationPeriod: presenceRow.evaluationPeriod,
			evalStart: evalRange.start.toISO(),
			evalEnd: evalRange.end.toISO(),
		},
		"Running presence detection for employee",
	);

	// Parse fixed days from JSON text (stored as ["monday","wednesday",...]) into weekday numbers
	let fixedDayNumbers: number[] = [];
	if (presenceRow.requiredOnsiteFixedDays) {
		try {
			const dayNames = z.array(z.string()).parse(
				JSON.parse(presenceRow.requiredOnsiteFixedDays),
			);
			fixedDayNumbers = dayNames
				.map((name) => DAY_NAME_TO_WEEKDAY[name.toLowerCase()])
				.filter((n): n is number => n !== undefined);
		} catch {
			logger.warn(
				{ policyId: emp.policy.policyId, raw: presenceRow.requiredOnsiteFixedDays },
				"Failed to parse requiredOnsiteFixedDays",
			);
		}
	}

	// Map DB enforcement values to PresenceConfig enforcement
	// DB uses "block" | "warn" | "none", PresenceConfig uses "hard" | "soft" | "none"
	const enforcementMap: Record<string, PresenceConfig["enforcement"]> = {
		block: "hard",
		warn: "soft",
		none: "none",
	};

	// Map DB evaluationPeriod values to PresenceConfig evaluationPeriod
	// DB uses "weekly" | "biweekly" | "monthly", PresenceConfig uses "week" | "month"
	const evalPeriodMap: Record<string, PresenceConfig["evaluationPeriod"]> = {
		weekly: "week",
		biweekly: "week", // biweekly still evaluates over weeks, just two of them
		monthly: "month",
	};

	const presenceConfig: PresenceConfig = {
		presenceMode: presenceRow.presenceMode as PresenceConfig["presenceMode"],
		requiredOnsiteDays: presenceRow.requiredOnsiteDays ?? 0,
		requiredOnsiteFixedDays: fixedDayNumbers,
		locationId: presenceRow.locationId,
		evaluationPeriod: evalPeriodMap[presenceRow.evaluationPeriod] ?? "week",
		enforcement: enforcementMap[presenceRow.enforcement] ?? "none",
	};

	// Skip if enforcement is disabled
	if (presenceConfig.enforcement === "none") return [];

	// Load work periods with location type for the evaluation range
	const workPeriodsWithLocation = await getWorkPeriodsWithLocationForEmployee(
		emp.id,
		evalRange.start.toJSDate(),
		evalRange.end.toJSDate(),
	);

	// Load absence entries for the evaluation range
	const absenceDays = await getAbsenceDaysForEmployee(
		emp.id,
		evalRange.start,
		evalRange.end,
	);

	// Load holidays for the organization in the evaluation range
	const holidayDays = await getHolidaysForOrganization(
		organizationId,
		evalRange.start,
		evalRange.end,
	);

	// Build the detection input and run the rule
	const presenceInput: PresenceRuleDetectionInput = {
		employee: emp,
		workPeriods: workPeriodsWithLocation,
		dateRange: evalRange,
		thresholdOverrides: null,
		presenceConfig,
		absenceDays,
		holidayDays,
	};

	const presenceRule = new PresenceRequirementRule();
	return presenceRule.detectViolations(presenceInput);
}

/**
 * Get work periods with workLocationType for presence detection
 */
async function getWorkPeriodsWithLocationForEmployee(
	employeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<WorkPeriodWithLocation[]> {
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
			workLocationType: true,
		},
		orderBy: (table, { asc }) => [asc(table.startTime)],
	});

	return periods;
}

/**
 * Get absence days for an employee within a date range.
 * Expands multi-day absences into individual day entries.
 */
async function getAbsenceDaysForEmployee(
	employeeId: string,
	start: DateTime,
	end: DateTime,
): Promise<AbsenceDay[]> {
	const absences = await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.employeeId, employeeId),
			// Overlapping range: absence starts before range end AND ends after range start
			lte(absenceEntry.startDate, end.toISODate()!),
			gte(absenceEntry.endDate, start.toISODate()!),
			// Only approved absences count
			eq(absenceEntry.status, "approved"),
		),
		with: {
			category: {
				columns: { type: true, name: true },
			},
		},
	});

	const days: AbsenceDay[] = [];

	for (const absence of absences) {
		const absStart = DateTime.fromISO(absence.startDate);
		const absEnd = DateTime.fromISO(absence.endDate);
		const rangeStart = absStart < start ? start : absStart;
		const rangeEnd = absEnd > end ? end : absEnd;

		let current = rangeStart.startOf("day");
		const lastDay = rangeEnd.startOf("day");

		while (current <= lastDay) {
			days.push({
				date: current.toISODate()!,
				reason: absence.category?.type ?? absence.category?.name ?? "absence",
			});
			current = current.plus({ days: 1 });
		}
	}

	return days;
}

/**
 * Get holidays for an organization within a date range.
 * Expands multi-day holidays into individual day entries.
 */
async function getHolidaysForOrganization(
	organizationId: string,
	start: DateTime,
	end: DateTime,
): Promise<HolidayDay[]> {
	const holidays = await db.query.holiday.findMany({
		where: and(
			eq(holiday.organizationId, organizationId),
			eq(holiday.isActive, true),
			// Overlapping range
			lte(holiday.startDate, end.toJSDate()),
			gte(holiday.endDate, start.toJSDate()),
		),
	});

	const days: HolidayDay[] = [];

	for (const h of holidays) {
		const holStart = DateTime.fromJSDate(h.startDate);
		const holEnd = DateTime.fromJSDate(h.endDate);
		const rangeStart = holStart < start ? start : holStart;
		const rangeEnd = holEnd > end ? end : holEnd;

		let current = rangeStart.startOf("day");
		const lastDay = rangeEnd.startOf("day");

		while (current <= lastDay) {
			days.push({ date: current.toISODate()! });
			current = current.plus({ days: 1 });
		}
	}

	return days;
}
