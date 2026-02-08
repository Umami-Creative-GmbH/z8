import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member as authMember, user as authUser } from "@/db/auth-schema";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeVacationAllowance,
	holiday,
	holidayCategory,
	surchargeModel,
	surchargeRule,
	team,
	timeEntry,
	workCategory,
	workCategorySet,
	workCategorySetCategory,
	workPeriod,
	workPolicy,
	workPolicyAssignment,
	workPolicySchedule,
	workPolicyScheduleDay,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { ClockodoClient } from "./client";
import {
	getAbsenceCategoryInfo,
	mapAbsenceToZ8,
	mapEntryToWorkPeriod,
	mapHolidayQuotaToVacationAllowance,
	mapNonBusinessDayToHoliday,
	mapServiceToWorkCategory,
	mapSurchargeToZ8,
	mapTargetHoursToWorkPolicy,
	mapTeamToZ8,
	mapUserToEmployee,
} from "./mapper";
import type {
	DateRangeFilter,
	EntityImportResult,
	IdMappings,
	ImportResult,
	ImportSelections,
	UserMappingType,
} from "./types";

const logger = createLogger("ClockodoImport");

function emptyResult(): EntityImportResult {
	return { imported: 0, skipped: 0, errors: [] };
}

/** Serialized user mapping passed from server action */
export interface ImportUserMapping {
	clockodoUserId: number;
	employeeId: string | null;
	userId: string | null;
	mappingType: UserMappingType;
}

/** Resolve a DateRangeFilter preset into concrete start/end ISO strings */
function resolveDateRange(dateRange: DateRangeFilter): { startDate: string; endDate: string } {
	const now = new Date();
	const endDate = `${now.toISOString().slice(0, 19)}Z`;

	if (dateRange.preset === "custom" && dateRange.startDate && dateRange.endDate) {
		return {
			startDate: `${new Date(dateRange.startDate).toISOString().slice(0, 19)}Z`,
			endDate: `${new Date(dateRange.endDate).toISOString().slice(0, 19)}Z`,
		};
	}

	const since = new Date();
	switch (dateRange.preset) {
		case "this_year":
			since.setMonth(0, 1);
			since.setHours(0, 0, 0, 0);
			break;
		case "this_year_and_last":
			since.setFullYear(since.getFullYear() - 1, 0, 1);
			since.setHours(0, 0, 0, 0);
			break;
		case "last_6_months":
			since.setMonth(since.getMonth() - 6);
			break;
		case "last_12_months":
			since.setFullYear(since.getFullYear() - 1);
			break;
		default:
			// all_data: 10 years back
			since.setFullYear(since.getFullYear() - 10);
			break;
	}

	return {
		startDate: `${since.toISOString().slice(0, 19)}Z`,
		endDate,
	};
}

/** Resolve a DateRangeFilter to a year range for the absences API */
function resolveYearRange(dateRange: DateRangeFilter): { startYear: number; endYear: number } {
	const currentYear = new Date().getFullYear();

	if (dateRange.preset === "custom" && dateRange.startDate && dateRange.endDate) {
		return {
			startYear: new Date(dateRange.startDate).getFullYear(),
			endYear: new Date(dateRange.endDate).getFullYear(),
		};
	}

	switch (dateRange.preset) {
		case "this_year":
			return { startYear: currentYear, endYear: currentYear };
		case "this_year_and_last":
			return { startYear: currentYear - 1, endYear: currentYear };
		case "last_6_months": {
			const sixMonthsAgo = new Date();
			sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
			return { startYear: sixMonthsAgo.getFullYear(), endYear: currentYear };
		}
		case "last_12_months":
			return { startYear: currentYear - 1, endYear: currentYear };
		default:
			// all_data
			return { startYear: currentYear - 10, endYear: currentYear };
	}
}

/**
 * Main import orchestrator. Executes imports in dependency order:
 * 1. Teams (no dependencies)
 * 2. Users → Employees (depends on teams for assignment)
 * 3. Services → Work Categories (no dependencies)
 * 4. Target Hours → Work Policies (depends on employees for assignment)
 * 5. Holiday Quotas → Vacation Allowances (depends on employees)
 * 6. Non-Business Days → Holidays (no dependencies)
 * 7. Surcharges (no dependencies)
 * 8. Absences (depends on employees)
 * 9. Time Entries → Work Periods (depends on employees, work categories)
 */
export async function orchestrateImport(
	client: ClockodoClient,
	organizationId: string,
	userId: string,
	selections: ImportSelections,
	userMappings?: ImportUserMapping[],
	onlyImportMapped?: boolean,
): Promise<ImportResult> {
	const startTime = Date.now();
	const idMappings: IdMappings = {
		users: new Map(),
		teams: new Map(),
		services: new Map(),
	};

	const result: ImportResult = {
		users: emptyResult(),
		teams: emptyResult(),
		services: emptyResult(),
		entries: emptyResult(),
		absences: emptyResult(),
		targetHours: emptyResult(),
		holidayQuotas: emptyResult(),
		nonBusinessDays: emptyResult(),
		surcharges: emptyResult(),
		status: "success",
		durationMs: 0,
	};

	try {
		// Phase 1: Teams
		if (selections.teams) {
			result.teams = await importTeams(client, organizationId, idMappings);
		}

		// Phase 2: Users → Employees
		if (selections.users) {
			result.users = await importUsers(
				client,
				organizationId,
				userId,
				idMappings,
				userMappings,
				onlyImportMapped,
			);
		}

		// Phase 3: Services → Work Categories
		if (selections.services) {
			result.services = await importServices(client, organizationId, userId, idMappings);
		}

		// Phase 4: Target Hours → Work Policies
		if (selections.targetHours) {
			result.targetHours = await importTargetHours(client, organizationId, userId, idMappings);
		}

		// Phase 5: Holiday Quotas → Vacation Allowances
		if (selections.holidayQuotas) {
			result.holidayQuotas = await importHolidayQuotas(client, organizationId, idMappings);
		}

		// Phase 6: Non-Business Days → Holidays
		if (selections.nonBusinessDays) {
			result.nonBusinessDays = await importNonBusinessDays(client, organizationId, userId);
		}

		// Phase 7: Surcharges
		if (selections.surcharges) {
			result.surcharges = await importSurcharges(client, organizationId, userId);
		}

		// Phase 8: Absences
		if (selections.absences) {
			result.absences = await importAbsences(
				client,
				organizationId,
				idMappings,
				selections.dateRange,
			);
		}

		// Phase 9: Time Entries
		if (selections.entries) {
			result.entries = await importEntries(
				client,
				organizationId,
				userId,
				idMappings,
				selections.dateRange,
			);
		}

		// Determine overall status
		const hasErrors = Object.values(result)
			.filter((v): v is EntityImportResult => typeof v === "object" && "errors" in v)
			.some((r) => r.errors.length > 0);
		const hasImports = Object.values(result)
			.filter((v): v is EntityImportResult => typeof v === "object" && "imported" in v)
			.some((r) => r.imported > 0);

		result.status = hasErrors ? (hasImports ? "partial" : "failed") : "success";
	} catch (error) {
		logger.error({ error }, "Import orchestration failed");
		result.status = "failed";
		result.errorMessage = error instanceof Error ? error.message : "Unknown error";
	}

	result.durationMs = Date.now() - startTime;
	return result;
}

// ============================================
// TEAM IMPORT
// ============================================

async function importTeams(
	client: ClockodoClient,
	organizationId: string,
	idMappings: IdMappings,
): Promise<EntityImportResult> {
	const result = emptyResult();

	try {
		const clockodoTeams = await client.getTeams();

		for (const ct of clockodoTeams) {
			try {
				// Check for duplicate by name
				const existing = await db.query.team.findFirst({
					where: and(eq(team.organizationId, organizationId), eq(team.name, ct.name)),
				});

				if (existing) {
					idMappings.teams.set(ct.id, existing.id);
					result.skipped++;
					continue;
				}

				const mapped = mapTeamToZ8(ct, organizationId);
				const [inserted] = await db.insert(team).values(mapped).returning({ id: team.id });
				idMappings.teams.set(ct.id, inserted.id);
				result.imported++;
			} catch (error) {
				result.errors.push(
					`Team "${ct.name}": ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}
	} catch (error) {
		result.errors.push(
			`Failed to fetch teams: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return result;
}

// ============================================
// USER/EMPLOYEE IMPORT
// ============================================

async function importUsers(
	client: ClockodoClient,
	organizationId: string,
	_currentUserId: string,
	idMappings: IdMappings,
	userMappings?: ImportUserMapping[],
	onlyImportMapped?: boolean,
): Promise<EntityImportResult> {
	const result = emptyResult();

	// Build a lookup map from Clockodo user ID → mapping
	const mappingByClockodoId = new Map<number, ImportUserMapping>();
	if (userMappings) {
		for (const m of userMappings) {
			mappingByClockodoId.set(m.clockodoUserId, m);
		}
	}

	try {
		const clockodoUsers = await client.getUsers();

		for (const cu of clockodoUsers) {
			try {
				const mapping = mappingByClockodoId.get(cu.id);

				// If user was explicitly skipped, skip
				if (mapping?.mappingType === "skipped") {
					result.skipped++;
					continue;
				}

				// If onlyImportMapped is set and no mapping exists, skip
				if (onlyImportMapped && !mapping) {
					result.skipped++;
					continue;
				}

				// If mapping is "manual" and has an existing employeeId + userId, use that directly
				if (mapping?.mappingType === "manual" && mapping.employeeId && mapping.userId) {
					idMappings.users.set(cu.id, {
						employeeId: mapping.employeeId,
						userId: mapping.userId,
					});
					result.skipped++;
					continue;
				}

				// If mapping is "auto_email" and has an existing employeeId + userId, use that
				if (mapping?.mappingType === "auto_email" && mapping.employeeId && mapping.userId) {
					idMappings.users.set(cu.id, {
						employeeId: mapping.employeeId,
						userId: mapping.userId,
					});
					result.skipped++;
					continue;
				}

				// Otherwise: create user (new_employee or no mapping = original flow)
				// Validate email format
				if (!cu.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cu.email)) {
					result.errors.push(`User "${cu.name}": invalid email "${cu.email}"`);
					continue;
				}

				const normalizedEmail = cu.email.toLowerCase().trim();

				// Check if a user with this email already exists in Better Auth
				const existingUser = await db.query.user.findFirst({
					where: eq(authUser.email, normalizedEmail),
				});

				let authUserId: string;

				if (existingUser) {
					authUserId = existingUser.id;
				} else {
					// Create a Better Auth user (no password = can't login, admin sends reset)
					const userId = `clockodo_${randomBytes(16).toString("hex")}`;
					try {
						await db.insert(authUser).values({
							id: userId,
							name: cu.name,
							email: normalizedEmail,
							emailVerified: true,
							createdAt: new Date(),
							updatedAt: new Date(),
						});
						authUserId = userId;
					} catch {
						// Handle race condition: email may have been inserted concurrently
						const retryUser = await db.query.user.findFirst({
							where: eq(authUser.email, normalizedEmail),
						});
						if (retryUser) {
							authUserId = retryUser.id;
						} else {
							throw new Error("Failed to create or find auth user");
						}
					}
				}

				// Ensure member record exists for this org
				const existingMember = await db.query.member.findFirst({
					where: and(
						eq(authMember.userId, authUserId),
						eq(authMember.organizationId, organizationId),
					),
				});

				if (!existingMember) {
					const memberId = `clockodo_member_${randomBytes(16).toString("hex")}`;
					await db.insert(authMember).values({
						id: memberId,
						organizationId,
						userId: authUserId,
						role: "member",
						createdAt: new Date(),
						status: "approved",
					});
				}

				// Check if employee already exists for this user in this org
				const existingEmployee = await db.query.employee.findFirst({
					where: and(eq(employee.userId, authUserId), eq(employee.organizationId, organizationId)),
				});

				if (existingEmployee) {
					idMappings.users.set(cu.id, {
						employeeId: existingEmployee.id,
						userId: authUserId,
					});
					result.skipped++;
					continue;
				}

				// Map and insert employee
				const mapped = mapUserToEmployee(cu, organizationId, authUserId);

				// Assign team if available
				if (cu.teams_id && idMappings.teams.has(cu.teams_id)) {
					(mapped as Record<string, unknown>).teamId = idMappings.teams.get(cu.teams_id);
				}

				const [inserted] = await db.insert(employee).values(mapped).returning({ id: employee.id });

				idMappings.users.set(cu.id, {
					employeeId: inserted.id,
					userId: authUserId,
				});
				result.imported++;
			} catch (error) {
				result.errors.push(
					`User "${cu.name}" (${cu.email}): ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}
	} catch (error) {
		result.errors.push(
			`Failed to fetch users: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return result;
}

// ============================================
// SERVICE → WORK CATEGORY IMPORT
// ============================================

async function importServices(
	client: ClockodoClient,
	organizationId: string,
	userId: string,
	idMappings: IdMappings,
): Promise<EntityImportResult> {
	const result = emptyResult();

	try {
		const clockodoServices = await client.getServices();

		// Create a work category set for imported categories
		let setCategorySetId: string | null = null;
		const existingSet = await db.query.workCategorySet.findFirst({
			where: and(
				eq(workCategorySet.organizationId, organizationId),
				eq(workCategorySet.name, "Imported from Clockodo"),
			),
		});

		if (existingSet) {
			setCategorySetId = existingSet.id;
		} else {
			const [newSet] = await db
				.insert(workCategorySet)
				.values({
					organizationId,
					name: "Imported from Clockodo",
					description: "Work categories imported from Clockodo",
					createdBy: userId,
				})
				.returning({ id: workCategorySet.id });
			setCategorySetId = newSet.id;
		}

		for (let i = 0; i < clockodoServices.length; i++) {
			const cs = clockodoServices[i];
			try {
				// Check for duplicate by name
				const existing = await db.query.workCategory.findFirst({
					where: and(
						eq(workCategory.organizationId, organizationId),
						eq(workCategory.name, cs.name),
					),
				});

				if (existing) {
					idMappings.services.set(cs.id, existing.id);
					result.skipped++;
					continue;
				}

				const mapped = mapServiceToWorkCategory(cs, organizationId, userId);
				const [inserted] = await db
					.insert(workCategory)
					.values(mapped)
					.returning({ id: workCategory.id });

				idMappings.services.set(cs.id, inserted.id);

				// Add to the imported set
				if (setCategorySetId) {
					await db.insert(workCategorySetCategory).values({
						setId: setCategorySetId,
						categoryId: inserted.id,
						sortOrder: i,
					});
				}

				result.imported++;
			} catch (error) {
				result.errors.push(
					`Service "${cs.name}": ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}
	} catch (error) {
		result.errors.push(
			`Failed to fetch services: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return result;
}

// ============================================
// TARGET HOURS → WORK POLICY IMPORT
// ============================================

async function importTargetHours(
	client: ClockodoClient,
	organizationId: string,
	userId: string,
	idMappings: IdMappings,
): Promise<EntityImportResult> {
	const result = emptyResult();

	try {
		const targetHours = await client.getTargetHours();

		for (const th of targetHours) {
			try {
				const mapped = mapTargetHoursToWorkPolicy(th, organizationId, userId);

				// Check for duplicate by name
				const existing = await db.query.workPolicy.findFirst({
					where: and(
						eq(workPolicy.organizationId, organizationId),
						eq(workPolicy.name, mapped.policy.name),
					),
				});

				if (existing) {
					result.skipped++;
					continue;
				}

				// Insert policy
				const [insertedPolicy] = await db
					.insert(workPolicy)
					.values(mapped.policy)
					.returning({ id: workPolicy.id });

				// Insert schedule
				const [insertedSchedule] = await db
					.insert(workPolicySchedule)
					.values({
						policyId: insertedPolicy.id,
						...mapped.schedule,
					})
					.returning({ id: workPolicySchedule.id });

				// Insert schedule days
				if (mapped.days.length > 0) {
					await db.insert(workPolicyScheduleDay).values(
						mapped.days.map((day) => ({
							scheduleId: insertedSchedule.id,
							...day,
						})),
					);
				}

				// Assign to employee if we have a mapping
				const employeeMapping = idMappings.users.get(mapped.clockodoUserId);
				if (employeeMapping) {
					await db.insert(workPolicyAssignment).values({
						policyId: insertedPolicy.id,
						organizationId,
						assignmentType: "employee",
						employeeId: employeeMapping.employeeId,
						priority: 2,
						effectiveFrom: mapped.dateSince ? new Date(mapped.dateSince) : undefined,
						effectiveUntil: mapped.dateUntil ? new Date(mapped.dateUntil) : undefined,
						createdBy: userId,
					});
				}

				result.imported++;
			} catch (error) {
				result.errors.push(
					`Target hours (user ${th.users_id}): ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}
	} catch (error) {
		result.errors.push(
			`Failed to fetch target hours: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return result;
}

// ============================================
// HOLIDAY QUOTA → VACATION ALLOWANCE IMPORT
// ============================================

async function importHolidayQuotas(
	client: ClockodoClient,
	_organizationId: string,
	idMappings: IdMappings,
): Promise<EntityImportResult> {
	const result = emptyResult();

	try {
		const quotas = await client.getHolidayQuotas();

		for (const quota of quotas) {
			try {
				const employeeMapping = idMappings.users.get(quota.users_id);
				if (!employeeMapping) {
					result.errors.push(
						`Holiday quota for user ${quota.users_id}: no matching employee found`,
					);
					continue;
				}

				// Check for duplicate
				const existing = await db.query.employeeVacationAllowance.findFirst({
					where: and(
						eq(employeeVacationAllowance.employeeId, employeeMapping.employeeId),
						eq(employeeVacationAllowance.year, quota.year_since),
					),
				});

				if (existing) {
					result.skipped++;
					continue;
				}

				const mapped = mapHolidayQuotaToVacationAllowance(quota, employeeMapping.employeeId);
				await db.insert(employeeVacationAllowance).values(mapped);
				result.imported++;
			} catch (error) {
				result.errors.push(
					`Holiday quota (user ${quota.users_id}, year ${quota.year_since}): ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}
	} catch (error) {
		result.errors.push(
			`Failed to fetch holiday quotas: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return result;
}

// ============================================
// NON-BUSINESS DAYS → HOLIDAYS IMPORT
// ============================================

async function importNonBusinessDays(
	client: ClockodoClient,
	organizationId: string,
	userId: string,
): Promise<EntityImportResult> {
	const result = emptyResult();

	try {
		const currentYear = new Date().getFullYear();
		const nonBusinessDays = await client.getNonBusinessDays(currentYear);

		// Find or create a "Public Holiday" category
		let categoryId: string;
		const existingCategory = await db.query.holidayCategory.findFirst({
			where: and(
				eq(holidayCategory.organizationId, organizationId),
				eq(holidayCategory.type, "public_holiday"),
			),
		});

		if (existingCategory) {
			categoryId = existingCategory.id;
		} else {
			const [newCategory] = await db
				.insert(holidayCategory)
				.values({
					organizationId,
					type: "public_holiday",
					name: "Public Holiday",
					blocksTimeEntry: true,
					excludeFromCalculations: true,
				})
				.returning({ id: holidayCategory.id });
			categoryId = newCategory.id;
		}

		for (const nbd of nonBusinessDays) {
			try {
				// Check for duplicate by name and date
				const date = new Date(nbd.date);
				const existing = await db.query.holiday.findFirst({
					where: and(
						eq(holiday.organizationId, organizationId),
						eq(holiday.name, nbd.name),
						eq(holiday.startDate, date),
					),
				});

				if (existing) {
					result.skipped++;
					continue;
				}

				const mapped = mapNonBusinessDayToHoliday(nbd, organizationId, categoryId, userId);
				await db.insert(holiday).values(mapped);
				result.imported++;
			} catch (error) {
				result.errors.push(
					`Non-business day "${nbd.name}": ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}
	} catch (error) {
		result.errors.push(
			`Failed to fetch non-business days: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return result;
}

// ============================================
// SURCHARGE IMPORT
// ============================================

async function importSurcharges(
	client: ClockodoClient,
	organizationId: string,
	userId: string,
): Promise<EntityImportResult> {
	const result = emptyResult();

	try {
		const surcharges = await client.getSurcharges();

		for (const cs of surcharges) {
			try {
				// Check for duplicate by name
				const existing = await db.query.surchargeModel.findFirst({
					where: and(
						eq(surchargeModel.organizationId, organizationId),
						eq(surchargeModel.name, cs.name),
					),
				});

				if (existing) {
					result.skipped++;
					continue;
				}

				const mapped = mapSurchargeToZ8(cs, organizationId, userId);

				// Insert model
				const [insertedModel] = await db
					.insert(surchargeModel)
					.values(mapped.model)
					.returning({ id: surchargeModel.id });

				// Insert rules
				for (const rule of mapped.rules) {
					await db.insert(surchargeRule).values({
						modelId: insertedModel.id,
						...rule,
					});
				}

				result.imported++;
			} catch (error) {
				result.errors.push(
					`Surcharge "${cs.name}": ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}
	} catch (error) {
		result.errors.push(
			`Failed to fetch surcharges: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return result;
}

// ============================================
// ABSENCE IMPORT
// ============================================

async function importAbsences(
	client: ClockodoClient,
	organizationId: string,
	idMappings: IdMappings,
	dateRange?: DateRangeFilter,
): Promise<EntityImportResult> {
	const result = emptyResult();

	try {
		let absences: Awaited<ReturnType<typeof client.getAbsences>>;

		if (dateRange && dateRange.preset !== "all_data") {
			const { startYear, endYear } = resolveYearRange(dateRange);
			const allAbsences = [];
			for (let y = startYear; y <= endYear; y++) {
				const yearAbsences = await client.getAbsences(y);
				allAbsences.push(...yearAbsences);
			}

			// Filter by exact date range if custom or preset
			const resolved = resolveDateRange(dateRange);
			const rangeStart = resolved.startDate.slice(0, 10); // YYYY-MM-DD
			const rangeEnd = resolved.endDate.slice(0, 10);

			absences = allAbsences.filter((a) => a.date_until >= rangeStart && a.date_since <= rangeEnd);
		} else {
			absences = await client.getAbsences();
		}

		// Build absence category cache (type → categoryId)
		const categoryCache = new Map<number, string>();

		for (const absence of absences) {
			try {
				const employeeMapping = idMappings.users.get(absence.users_id);
				if (!employeeMapping) {
					result.errors.push(
						`Absence ${absence.id}: no matching employee for user ${absence.users_id}`,
					);
					continue;
				}

				// Find or create absence category for this type
				let categoryId = categoryCache.get(absence.type);
				if (!categoryId) {
					const catInfo = getAbsenceCategoryInfo(absence.type);

					// Look for existing category with this type
					const existing = await db.query.absenceCategory.findFirst({
						where: and(
							eq(absenceCategory.organizationId, organizationId),
							eq(absenceCategory.type, catInfo.type),
							eq(absenceCategory.name, catInfo.name),
						),
					});

					if (existing) {
						categoryId = existing.id;
					} else {
						const [newCat] = await db
							.insert(absenceCategory)
							.values({
								organizationId,
								type: catInfo.type,
								name: catInfo.name,
								requiresApproval: true,
								countsAgainstVacation: catInfo.type === "vacation",
							})
							.returning({ id: absenceCategory.id });
						categoryId = newCat.id;
					}
					categoryCache.set(absence.type, categoryId);
				}

				// Check for duplicate
				const existing = await db.query.absenceEntry.findFirst({
					where: and(
						eq(absenceEntry.employeeId, employeeMapping.employeeId),
						eq(absenceEntry.startDate, absence.date_since),
						eq(absenceEntry.endDate, absence.date_until),
					),
				});

				if (existing) {
					result.skipped++;
					continue;
				}

				const mapped = mapAbsenceToZ8(absence, employeeMapping.employeeId, categoryId);
				await db.insert(absenceEntry).values(mapped);
				result.imported++;
			} catch (error) {
				result.errors.push(
					`Absence ${absence.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}
	} catch (error) {
		result.errors.push(
			`Failed to fetch absences: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return result;
}

// ============================================
// TIME ENTRY → WORK PERIOD IMPORT
// ============================================

async function importEntries(
	client: ClockodoClient,
	organizationId: string,
	_userId: string,
	idMappings: IdMappings,
	dateRange?: DateRangeFilter,
): Promise<EntityImportResult> {
	const result = emptyResult();

	try {
		let timeSince: string | undefined;
		let timeUntil: string | undefined;

		if (dateRange && dateRange.preset !== "all_data") {
			const resolved = resolveDateRange(dateRange);
			timeSince = resolved.startDate;
			timeUntil = resolved.endDate;
		}

		const entries = await client.getEntries(timeSince, timeUntil);

		// Filter to only type=1 (time entries), skip lump sums
		const timeEntries = entries.filter((e) => e.type === 1);

		// Process in batches
		for (let i = 0; i < timeEntries.length; i++) {
			const entry = timeEntries[i];
			try {
				// Only import entries with a time_until (completed entries)
				if (!entry.time_until) {
					result.skipped++;
					continue;
				}

				const employeeMapping = idMappings.users.get(entry.users_id);
				if (!employeeMapping) {
					result.errors.push(`Entry ${entry.id}: no matching employee for user ${entry.users_id}`);
					continue;
				}

				// Check for duplicate by employee + start time
				const startTime = new Date(entry.time_since);
				const existingWp = await db.query.workPeriod.findFirst({
					where: and(
						eq(workPeriod.employeeId, employeeMapping.employeeId),
						eq(workPeriod.organizationId, organizationId),
						eq(workPeriod.startTime, startTime),
					),
				});

				if (existingWp) {
					result.skipped++;
					continue;
				}

				// Resolve work category
				const workCategoryId = entry.services_id
					? (idMappings.services.get(entry.services_id) ?? null)
					: null;

				const mapped = mapEntryToWorkPeriod(
					entry,
					employeeMapping.employeeId,
					organizationId,
					employeeMapping.userId,
					workCategoryId,
				);

				// Insert clock-in, clock-out, and work period in a transaction
				await db.transaction(async (tx) => {
					const [clockInRecord] = await tx
						.insert(timeEntry)
						.values(mapped.clockIn)
						.returning({ id: timeEntry.id });

					let clockOutId: string | null = null;
					if (mapped.clockOut) {
						const [clockOutRecord] = await tx
							.insert(timeEntry)
							.values({
								...mapped.clockOut,
								previousEntryId: clockInRecord.id,
							})
							.returning({ id: timeEntry.id });
						clockOutId = clockOutRecord.id;
					}

					await tx.insert(workPeriod).values({
						...mapped.workPeriod,
						clockInId: clockInRecord.id,
						clockOutId,
					});
				});

				result.imported++;
			} catch (error) {
				result.errors.push(
					`Entry ${entry.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
				);
			}
		}
	} catch (error) {
		result.errors.push(
			`Failed to fetch entries: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}

	return result;
}
