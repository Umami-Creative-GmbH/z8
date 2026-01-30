"use server";

import { faker } from "@faker-js/faker";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	changePolicy,
	changePolicyAssignment,
	employee,
	employeeManagers,
	employeeVacationAllowance,
	location,
	locationEmployee,
	locationSubarea,
	project,
	shift,
	shiftRecurrence,
	shiftRequest,
	shiftTemplate,
	subareaEmployee,
	team,
	timeEntry,
	workCategory,
	workCategorySet,
	workCategorySetAssignment,
	workCategorySetCategory,
	workPeriod,
} from "@/db/schema";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { calculateHash } from "@/lib/time-tracking/blockchain";

/**
 * Generate realistic work descriptions using faker
 */
const workDescriptionGenerators = [
	() => `Working on ${faker.company.buzzPhrase().toLowerCase()}`,
	() => `Meeting with ${faker.company.name()}`,
	() => `Code review for ${faker.git.branch()}`,
	() => "Sprint planning session",
	() => "Documentation updates",
	() => `Bug fix: ${faker.hacker.phrase().toLowerCase()}`,
	() => `Feature: ${faker.hacker.verb()} ${faker.hacker.noun()}`,
	() => `Email correspondence with ${faker.person.fullName()}`,
	() => "Team standup and planning",
	() => `Reviewing ${faker.commerce.productName()} requirements`,
	() => `Testing ${faker.commerce.productAdjective().toLowerCase()} functionality`,
	() => "Database optimization work",
	() => `Client call: ${faker.company.name()}`,
	() => "Infrastructure monitoring",
	() => `Research: ${faker.company.buzzNoun()}`,
];

function generateWorkDescription(): string {
	const generator = faker.helpers.arrayElement(workDescriptionGenerators);
	return generator();
}

function generateMorningWorkDescription(): string {
	const morningTasks = [
		() => generateWorkDescription(),
		() => "Morning standup and task review",
		() => `Planning ${faker.hacker.verb()} tasks`,
		() => "Email and message catch-up",
		() => `Research: ${faker.company.buzzPhrase().toLowerCase()}`,
	];
	return faker.helpers.arrayElement(morningTasks)();
}

function generateAfternoonWorkDescription(): string {
	const afternoonTasks = [
		() => generateWorkDescription(),
		() => "Afternoon project work",
		() => `Implementing ${faker.hacker.noun()} feature`,
		() => "Code review and feedback",
		() => `Testing ${faker.commerce.productAdjective().toLowerCase()} changes`,
	];
	return faker.helpers.arrayElement(afternoonTasks)();
}

function generateEndOfDayDescription(): string {
	const eodTasks = [
		() => generateWorkDescription(),
		() => "Wrapping up daily tasks",
		() => "Preparing tomorrow's priorities",
		() => `Completed ${faker.hacker.verb()} tasks`,
		() => "Final code review and commits",
		() => `Finished ${faker.commerce.productAdjective().toLowerCase()} feature work`,
	];
	return faker.helpers.arrayElement(eodTasks)();
}

export interface DemoDataOptions {
	organizationId: string;
	dateRange: {
		start: Date;
		end: Date;
	};
	includeTimeEntries: boolean;
	includeAbsences: boolean;
	includeTeams: boolean;
	teamCount?: number; // Number of teams to create (default: 3-5)
	includeProjects: boolean;
	projectCount?: number; // Number of projects to create (default: 5-8)
	employeeIds?: string[];
	createdBy: string;
	// NEW: Location options
	includeLocations?: boolean;
	locationCount?: number;
	subareasPerLocation?: number;
	// NEW: Work category options
	includeWorkCategories?: boolean;
	workCategorySetCount?: number;
	workCategoryCount?: number;
	assignWorkCategoriesToPeriods?: boolean;
	// NEW: Change policy options
	includeChangePolicies?: boolean;
	changePolicyCount?: number;
	// NEW: Shift scheduling options
	includeShifts?: boolean;
	shiftTemplateCount?: number;
	generateShiftInstances?: boolean;
}

export interface DemoDataResult {
	timeEntriesCreated: number;
	workPeriodsCreated: number;
	absencesCreated: number;
	teamsCreated: number;
	employeesAssignedToTeams: number;
	projectsCreated: number;
	managerAssignmentsCreated: number;
	// NEW: Location results
	locationsCreated: number;
	subareasCreated: number;
	locationSupervisorsAssigned: number;
	// NEW: Work category results
	workCategorySetsCreated: number;
	workCategoriesCreated: number;
	workCategoryAssignmentsCreated: number;
	workCategoriesAssignedToPeriods: number;
	// NEW: Change policy results
	changePoliciesCreated: number;
	changePolicyAssignmentsCreated: number;
	// NEW: Shift scheduling results
	shiftTemplatesCreated: number;
	shiftRecurrencesCreated: number;
	shiftsCreated: number;
	shiftRequestsCreated: number;
}

export interface ClearDataResult {
	timeEntriesDeleted: number;
	workPeriodsDeleted: number;
	absencesDeleted: number;
	vacationAllowancesReset: number;
	teamsDeleted: number;
	employeesUnassignedFromTeams: number;
	projectsDeleted: number;
	managerAssignmentsDeleted: number;
	// NEW: Location cleanup
	locationsDeleted: number;
	subareasDeleted: number;
	// NEW: Work category cleanup
	workCategorySetsDeleted: number;
	workCategoriesDeleted: number;
	workCategoryAssignmentsRemoved: number;
	// NEW: Change policy cleanup
	changePoliciesDeleted: number;
	// NEW: Shift scheduling cleanup
	shiftTemplatesDeleted: number;
	shiftRecurrencesDeleted: number;
	shiftsDeleted: number;
	shiftRequestsDeleted: number;
}

/**
 * Generate random time between two hours (returns minutes from midnight)
 */
function randomTimeBetween(
	minHour: number,
	maxHour: number,
	minMinute = 0,
	maxMinute = 59,
): number {
	const hour = Math.floor(Math.random() * (maxHour - minHour + 1)) + minHour;
	const minute = Math.floor(Math.random() * (maxMinute - minMinute + 1)) + minMinute;
	return hour * 60 + minute;
}

/**
 * Check if a Luxon DateTime is a weekend
 */
function isWeekend(dt: DateTime): boolean {
	// Luxon weekday: 1=Monday, 7=Sunday
	return dt.weekday === 6 || dt.weekday === 7;
}

/**
 * Add minutes to a DateTime
 */
function addMinutesToDT(dt: DateTime, minutes: number): DateTime {
	return dt.plus({ minutes });
}

/**
 * Set time on a DateTime (hours and minutes)
 */
function setTimeOnDT(dt: DateTime, hours: number, minutes: number): DateTime {
	return dt.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
}

/**
 * Generate demo time entries with realistic work patterns including breaks
 * Uses Luxon DateTime in UTC for consistent date handling
 */
export async function generateDemoTimeEntries(
	options: DemoDataOptions,
): Promise<{ timeEntriesCreated: number; workPeriodsCreated: number }> {
	if (!options.includeTimeEntries) {
		return { timeEntriesCreated: 0, workPeriodsCreated: 0 };
	}

	// Get employees for the organization
	const employees = await db.query.employee.findMany({
		where: options.employeeIds?.length
			? and(
					eq(employee.organizationId, options.organizationId),
					inArray(employee.id, options.employeeIds),
				)
			: eq(employee.organizationId, options.organizationId),
	});

	if (employees.length === 0) {
		return { timeEntriesCreated: 0, workPeriodsCreated: 0 };
	}

	let timeEntriesCreated = 0;
	let workPeriodsCreated = 0;

	// Convert date range to Luxon DateTime in UTC
	const startDT = DateTime.fromJSDate(options.dateRange.start, { zone: "utc" }).startOf("day");
	const endDT = DateTime.fromJSDate(options.dateRange.end, { zone: "utc" }).endOf("day");

	// Iterate through each day in the date range
	let currentDT = startDT;

	while (currentDT <= endDT) {
		// Skip weekends
		if (isWeekend(currentDT)) {
			currentDT = currentDT.plus({ days: 1 });
			continue;
		}

		// Process each employee for this day
		for (const emp of employees) {
			// 10% chance to skip this day (realistic gaps)
			if (Math.random() < 0.1) {
				continue;
			}

			// Get the last entry for this employee to chain hashes
			const lastEntry = await db.query.timeEntry.findFirst({
				where: eq(timeEntry.employeeId, emp.id),
				orderBy: (t, { desc }) => desc(t.createdAt),
			});

			let previousHash = lastEntry?.hash ?? null;
			let previousEntryId = lastEntry?.id ?? null;

			// Morning session: Clock in (7:30-9:30) to lunch (12:00-13:00)
			const morningStartMinutes = randomTimeBetween(7, 9, 30, 30); // 7:30-9:30
			const morningStartHour = Math.floor(morningStartMinutes / 60);
			const morningStartMin = morningStartMinutes % 60;
			const morningClockInDT = setTimeOnDT(currentDT, morningStartHour, morningStartMin);
			const morningClockIn = dateToDB(morningClockInDT)!;

			const lunchStartMinutes = randomTimeBetween(12, 13, 0, 0); // 12:00-13:00
			const lunchStartHour = Math.floor(lunchStartMinutes / 60);
			const lunchStartMin = lunchStartMinutes % 60;
			const morningClockOutDT = setTimeOnDT(currentDT, lunchStartHour, lunchStartMin);
			const morningClockOut = dateToDB(morningClockOutDT)!;

			// Create morning clock in
			const morningInHash = calculateHash({
				employeeId: emp.id,
				type: "clock_in",
				timestamp: morningClockInDT.toISO()!,
				previousHash,
			});

			const [morningInEntry] = await db
				.insert(timeEntry)
				.values({
					employeeId: emp.id,
					organizationId: options.organizationId,
					type: "clock_in",
					timestamp: morningClockIn,
					hash: morningInHash,
					previousHash,
					previousEntryId,
					notes: "Demo data",
					createdBy: options.createdBy,
				})
				.returning();

			previousHash = morningInEntry.hash;
			previousEntryId = morningInEntry.id;
			timeEntriesCreated++;

			// Create morning clock out (for lunch)
			const morningOutHash = calculateHash({
				employeeId: emp.id,
				type: "clock_out",
				timestamp: morningClockOutDT.toISO()!,
				previousHash,
			});

			const [morningOutEntry] = await db
				.insert(timeEntry)
				.values({
					employeeId: emp.id,
					organizationId: options.organizationId,
					type: "clock_out",
					timestamp: morningClockOut,
					hash: morningOutHash,
					previousHash,
					previousEntryId,
					notes: generateMorningWorkDescription(),
					createdBy: options.createdBy,
				})
				.returning();

			previousHash = morningOutEntry.hash;
			previousEntryId = morningOutEntry.id;
			timeEntriesCreated++;

			// Create morning work period
			const morningDuration = Math.round(
				morningClockOutDT.diff(morningClockInDT, "minutes").minutes,
			);
			await db.insert(workPeriod).values({
				employeeId: emp.id,
				organizationId: options.organizationId,
				clockInId: morningInEntry.id,
				clockOutId: morningOutEntry.id,
				startTime: morningClockIn,
				endTime: morningClockOut,
				durationMinutes: morningDuration,
				isActive: false,
			});
			workPeriodsCreated++;

			// Lunch break: 30-60 minutes
			const lunchDuration = Math.floor(Math.random() * 31) + 30; // 30-60 minutes
			const afternoonClockInDT = addMinutesToDT(morningClockOutDT, lunchDuration);
			const afternoonClockIn = dateToDB(afternoonClockInDT)!;

			// Create afternoon clock in
			const afternoonInHash = calculateHash({
				employeeId: emp.id,
				type: "clock_in",
				timestamp: afternoonClockInDT.toISO()!,
				previousHash,
			});

			const [afternoonInEntry] = await db
				.insert(timeEntry)
				.values({
					employeeId: emp.id,
					organizationId: options.organizationId,
					type: "clock_in",
					timestamp: afternoonClockIn,
					hash: afternoonInHash,
					previousHash,
					previousEntryId,
					notes: "Demo data - Back from lunch",
					createdBy: options.createdBy,
				})
				.returning();

			previousHash = afternoonInEntry.hash;
			previousEntryId = afternoonInEntry.id;
			timeEntriesCreated++;

			// Check if we should add an afternoon break (30% chance)
			const hasAfternoonBreak = Math.random() < 0.3;

			if (hasAfternoonBreak) {
				// Afternoon break around 15:00-15:30
				const breakStartMinutes = randomTimeBetween(15, 15, 0, 30);
				const breakStartHour = Math.floor(breakStartMinutes / 60);
				const breakStartMin = breakStartMinutes % 60;
				const breakStartDT = setTimeOnDT(currentDT, breakStartHour, breakStartMin);
				const breakStart = dateToDB(breakStartDT)!;

				// Clock out for break
				const breakOutHash = calculateHash({
					employeeId: emp.id,
					type: "clock_out",
					timestamp: breakStartDT.toISO()!,
					previousHash,
				});

				const [breakOutEntry] = await db
					.insert(timeEntry)
					.values({
						employeeId: emp.id,
						organizationId: options.organizationId,
						type: "clock_out",
						timestamp: breakStart,
						hash: breakOutHash,
						previousHash,
						previousEntryId,
						notes: generateAfternoonWorkDescription(),
						createdBy: options.createdBy,
					})
					.returning();

				previousHash = breakOutEntry.hash;
				previousEntryId = breakOutEntry.id;
				timeEntriesCreated++;

				// Create first afternoon work period
				const firstAfternoonDuration = Math.round(
					breakStartDT.diff(afternoonClockInDT, "minutes").minutes,
				);
				await db.insert(workPeriod).values({
					employeeId: emp.id,
					organizationId: options.organizationId,
					clockInId: afternoonInEntry.id,
					clockOutId: breakOutEntry.id,
					startTime: afternoonClockIn,
					endTime: breakStart,
					durationMinutes: firstAfternoonDuration,
					isActive: false,
				});
				workPeriodsCreated++;

				// Break duration: 10-20 minutes
				const breakDuration = Math.floor(Math.random() * 11) + 10;
				const breakEndDT = addMinutesToDT(breakStartDT, breakDuration);
				const breakEnd = dateToDB(breakEndDT)!;

				// Clock in after break
				const breakInHash = calculateHash({
					employeeId: emp.id,
					type: "clock_in",
					timestamp: breakEndDT.toISO()!,
					previousHash,
				});

				const [breakInEntry] = await db
					.insert(timeEntry)
					.values({
						employeeId: emp.id,
						organizationId: options.organizationId,
						type: "clock_in",
						timestamp: breakEnd,
						hash: breakInHash,
						previousHash,
						previousEntryId,
						notes: "Demo data - Back from break",
						createdBy: options.createdBy,
					})
					.returning();

				previousHash = breakInEntry.hash;
				previousEntryId = breakInEntry.id;
				timeEntriesCreated++;

				// Final clock out: 16:30-18:30
				const endMinutes = randomTimeBetween(16, 18, 30, 30);
				const endHour = Math.floor(endMinutes / 60);
				const endMin = endMinutes % 60;
				const finalClockOutDT = setTimeOnDT(currentDT, endHour, endMin);
				const finalClockOut = dateToDB(finalClockOutDT)!;

				const finalOutHash = calculateHash({
					employeeId: emp.id,
					type: "clock_out",
					timestamp: finalClockOutDT.toISO()!,
					previousHash,
				});

				const [finalOutEntry] = await db
					.insert(timeEntry)
					.values({
						employeeId: emp.id,
						organizationId: options.organizationId,
						type: "clock_out",
						timestamp: finalClockOut,
						hash: finalOutHash,
						previousHash,
						previousEntryId,
						notes: generateEndOfDayDescription(),
						createdBy: options.createdBy,
					})
					.returning();

				timeEntriesCreated++;

				// Create final afternoon work period
				const finalDuration = Math.round(finalClockOutDT.diff(breakEndDT, "minutes").minutes);
				await db.insert(workPeriod).values({
					employeeId: emp.id,
					organizationId: options.organizationId,
					clockInId: breakInEntry.id,
					clockOutId: finalOutEntry.id,
					startTime: breakEnd,
					endTime: finalClockOut,
					durationMinutes: finalDuration,
					isActive: false,
				});
				workPeriodsCreated++;
			} else {
				// No afternoon break - single afternoon session
				const endMinutes = randomTimeBetween(16, 18, 30, 30);
				const endHour = Math.floor(endMinutes / 60);
				const endMin = endMinutes % 60;
				const finalClockOutDT = setTimeOnDT(currentDT, endHour, endMin);
				const finalClockOut = dateToDB(finalClockOutDT)!;

				const finalOutHash = calculateHash({
					employeeId: emp.id,
					type: "clock_out",
					timestamp: finalClockOutDT.toISO()!,
					previousHash,
				});

				const [finalOutEntry] = await db
					.insert(timeEntry)
					.values({
						employeeId: emp.id,
						organizationId: options.organizationId,
						type: "clock_out",
						timestamp: finalClockOut,
						hash: finalOutHash,
						previousHash,
						previousEntryId,
						notes: generateEndOfDayDescription(),
						createdBy: options.createdBy,
					})
					.returning();

				timeEntriesCreated++;

				// Create afternoon work period
				const afternoonDuration = Math.round(
					finalClockOutDT.diff(afternoonClockInDT, "minutes").minutes,
				);
				await db.insert(workPeriod).values({
					employeeId: emp.id,
					organizationId: options.organizationId,
					clockInId: afternoonInEntry.id,
					clockOutId: finalOutEntry.id,
					startTime: afternoonClockIn,
					endTime: finalClockOut,
					durationMinutes: afternoonDuration,
					isActive: false,
				});
				workPeriodsCreated++;
			}
		}

		// Move to next day
		currentDT = currentDT.plus({ days: 1 });
	}

	return { timeEntriesCreated, workPeriodsCreated };
}

/**
 * Ensure default absence categories exist for the organization
 */
async function ensureDefaultAbsenceCategories(organizationId: string) {
	const existingCategories = await db.query.absenceCategory.findMany({
		where: eq(absenceCategory.organizationId, organizationId),
	});

	const existingTypes = new Set(existingCategories.map((c) => c.type));
	const categoriesToCreate: Array<typeof absenceCategory.$inferInsert> = [];

	if (!existingTypes.has("vacation")) {
		categoriesToCreate.push({
			organizationId,
			type: "vacation",
			name: "Vacation",
			description: "Paid time off",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: true,
			color: "#10b981",
			isActive: true,
		});
	}

	if (!existingTypes.has("sick")) {
		categoriesToCreate.push({
			organizationId,
			type: "sick",
			name: "Sick Leave",
			description: "Sick day",
			requiresWorkTime: false,
			requiresApproval: false,
			countsAgainstVacation: false,
			color: "#ef4444",
			isActive: true,
		});
	}

	if (!existingTypes.has("personal")) {
		categoriesToCreate.push({
			organizationId,
			type: "personal",
			name: "Personal Day",
			description: "Personal time off",
			requiresWorkTime: false,
			requiresApproval: true,
			countsAgainstVacation: false,
			color: "#8b5cf6",
			isActive: true,
		});
	}

	if (categoriesToCreate.length > 0) {
		await db.insert(absenceCategory).values(categoriesToCreate);
	}
}

/**
 * Generate demo absences (vacation, sick, personal days)
 */
export async function generateDemoAbsences(
	options: DemoDataOptions,
): Promise<{ absencesCreated: number }> {
	if (!options.includeAbsences) {
		return { absencesCreated: 0 };
	}

	// Get employees for the organization
	const employees = await db.query.employee.findMany({
		where: options.employeeIds?.length
			? and(
					eq(employee.organizationId, options.organizationId),
					inArray(employee.id, options.employeeIds),
				)
			: eq(employee.organizationId, options.organizationId),
	});

	if (employees.length === 0) {
		return { absencesCreated: 0 };
	}

	// Ensure default absence categories exist
	await ensureDefaultAbsenceCategories(options.organizationId);

	// Get absence categories for this organization
	const categories = await db.query.absenceCategory.findMany({
		where: and(
			eq(absenceCategory.organizationId, options.organizationId),
			eq(absenceCategory.isActive, true),
		),
	});

	if (categories.length === 0) {
		return { absencesCreated: 0 };
	}

	// Find vacation, sick, and personal categories
	const vacationCategory = categories.find((c) => c.type === "vacation");
	const sickCategory = categories.find((c) => c.type === "sick");
	const personalCategory = categories.find((c) => c.type === "personal");

	let absencesCreated = 0;
	const currentYear = new Date().getFullYear();

	for (const emp of employees) {
		// Generate 2-3 vacation requests per employee
		if (vacationCategory) {
			const vacationCount = Math.floor(Math.random() * 2) + 2; // 2-3
			for (let i = 0; i < vacationCount; i++) {
				const absence = generateRandomAbsence(
					emp.id,
					vacationCategory.id,
					currentYear,
					1,
					10,
					employees[0].id, // Use first employee as approver
				);
				await db.insert(absenceEntry).values(absence);
				absencesCreated++;
			}
		}

		// Generate 0-3 sick days per employee
		if (sickCategory) {
			const sickCount = Math.floor(Math.random() * 4); // 0-3
			for (let i = 0; i < sickCount; i++) {
				const absence = generateRandomAbsence(
					emp.id,
					sickCategory.id,
					currentYear,
					1,
					3,
					employees[0].id,
					0.9, // 90% approved for sick days
				);
				await db.insert(absenceEntry).values(absence);
				absencesCreated++;
			}
		}

		// Generate 0-2 personal days per employee
		if (personalCategory) {
			const personalCount = Math.floor(Math.random() * 3); // 0-2
			for (let i = 0; i < personalCount; i++) {
				const absence = generateRandomAbsence(
					emp.id,
					personalCategory.id,
					currentYear,
					1,
					2,
					employees[0].id,
				);
				await db.insert(absenceEntry).values(absence);
				absencesCreated++;
			}
		}
	}

	return { absencesCreated };
}

/**
 * Generate a random absence record
 * Uses Luxon DateTime in UTC for consistent date handling
 */
function generateRandomAbsence(
	employeeId: string,
	categoryId: string,
	year: number,
	minDays: number,
	maxDays: number,
	approverId: string,
	approvedRate = 0.7,
): typeof absenceEntry.$inferInsert {
	// Random start date within the year (Luxon months are 1-indexed)
	const startMonth = Math.floor(Math.random() * 12) + 1; // 1-12
	const startDay = Math.floor(Math.random() * 28) + 1; // 1-28
	const startDT = DateTime.utc(year, startMonth, startDay);

	// Random duration
	const duration = Math.floor(Math.random() * (maxDays - minDays + 1)) + minDays;
	const endDT = startDT.plus({ days: duration - 1 });

	// Convert to ISO date strings for database (date columns expect YYYY-MM-DD)
	const startDate = startDT.toISODate()!;
	const endDate = endDT.toISODate()!;

	// Determine status: 70% approved, 20% pending, 10% rejected
	const statusRand = Math.random();
	let status: "pending" | "approved" | "rejected";
	let approvedBy: string | null = null;
	let approvedAt: Date | null = null;
	let rejectionReason: string | null = null;

	if (statusRand < approvedRate) {
		status = "approved";
		approvedBy = approverId;
		// Approved 1-7 days before start
		const approvedDT = startDT.minus({ days: Math.floor(Math.random() * 7) + 1 });
		approvedAt = dateToDB(approvedDT);
	} else if (statusRand < approvedRate + 0.2) {
		status = "pending";
	} else {
		status = "rejected";
		approvedBy = approverId;
		// Rejected 1-7 days before start
		const rejectedDT = startDT.minus({ days: Math.floor(Math.random() * 7) + 1 });
		approvedAt = dateToDB(rejectedDT);
		rejectionReason = "Demo data - Auto-rejected";
	}

	return {
		employeeId,
		categoryId,
		startDate,
		endDate,
		status,
		notes: "Demo data - Generated absence",
		approvedBy,
		approvedAt,
		rejectionReason,
	};
}

/**
 * Team name generators for realistic department/team names
 */
const teamNameGenerators = [
	() => `${faker.company.buzzAdjective()} ${faker.commerce.department()}`,
	() => `${faker.commerce.department()} Team`,
	() => `${faker.company.buzzNoun()} Division`,
	() => `${faker.hacker.adjective()} ${faker.hacker.noun()} Team`,
];

const defaultTeamNames = [
	"Engineering",
	"Product",
	"Design",
	"Marketing",
	"Sales",
	"Customer Success",
	"Operations",
	"HR & People",
	"Finance",
	"Legal",
];

/**
 * Generate demo teams and assign random employees to them
 */
export async function generateDemoTeams(
	options: DemoDataOptions,
): Promise<{ teamsCreated: number; employeesAssignedToTeams: number }> {
	if (!options.includeTeams) {
		return { teamsCreated: 0, employeesAssignedToTeams: 0 };
	}

	// Get employees for the organization
	const employees = await db.query.employee.findMany({
		where: options.employeeIds
			? inArray(employee.id, options.employeeIds)
			: eq(employee.organizationId, options.organizationId),
	});

	if (employees.length === 0) {
		return { teamsCreated: 0, employeesAssignedToTeams: 0 };
	}

	// Determine number of teams to create (default: 3-5, max based on employee count)
	const maxTeams = Math.min(Math.ceil(employees.length / 2), defaultTeamNames.length);
	const teamCount = options.teamCount ?? Math.min(Math.floor(Math.random() * 3) + 3, maxTeams);

	if (teamCount <= 0) {
		return { teamsCreated: 0, employeesAssignedToTeams: 0 };
	}

	// Use default team names first, then generate random ones if needed
	const teamNames: string[] = [];
	const shuffledDefaults = faker.helpers.shuffle([...defaultTeamNames]);

	for (let i = 0; i < teamCount; i++) {
		if (i < shuffledDefaults.length) {
			teamNames.push(shuffledDefaults[i]);
		} else {
			const generator = faker.helpers.arrayElement(teamNameGenerators);
			teamNames.push(generator());
		}
	}

	// Create teams
	const createdTeams: { id: string; name: string }[] = [];
	for (const name of teamNames) {
		const [newTeam] = await db
			.insert(team)
			.values({
				organizationId: options.organizationId,
				name,
				description: `Demo team - ${name}`,
			})
			.returning({ id: team.id, name: team.name });

		if (newTeam) {
			createdTeams.push(newTeam);
		}
	}

	if (createdTeams.length === 0) {
		return { teamsCreated: 0, employeesAssignedToTeams: 0 };
	}

	// Shuffle employees and assign to teams
	const shuffledEmployees = faker.helpers.shuffle([...employees]);
	let employeesAssigned = 0;

	// Ensure each team gets at least one employee
	for (let i = 0; i < createdTeams.length && i < shuffledEmployees.length; i++) {
		await db
			.update(employee)
			.set({ teamId: createdTeams[i].id })
			.where(eq(employee.id, shuffledEmployees[i].id));
		employeesAssigned++;
	}

	// Assign remaining employees randomly to teams
	for (let i = createdTeams.length; i < shuffledEmployees.length; i++) {
		const randomTeam = faker.helpers.arrayElement(createdTeams);
		await db
			.update(employee)
			.set({ teamId: randomTeam.id })
			.where(eq(employee.id, shuffledEmployees[i].id));
		employeesAssigned++;
	}

	return {
		teamsCreated: createdTeams.length,
		employeesAssignedToTeams: employeesAssigned,
	};
}

/**
 * Project name generators for realistic project names
 */
const projectNameGenerators = [
	() => `${faker.company.buzzAdjective()} ${faker.company.buzzNoun()}`,
	() => {
		const adj = faker.word.adjective();
		return `Project ${adj.charAt(0).toUpperCase() + adj.slice(1)}`;
	},
	() => `${faker.hacker.verb()} ${faker.hacker.noun()}`,
	() => `${faker.commerce.productAdjective()} ${faker.commerce.product()}`,
];

const defaultProjectNames = [
	"Website Redesign",
	"Mobile App Development",
	"API Integration",
	"Database Migration",
	"Customer Portal",
	"Internal Tools",
	"Analytics Dashboard",
	"Security Audit",
	"Performance Optimization",
	"Documentation Update",
	"Cloud Migration",
	"Payment System",
];

const projectColors = [
	"#ef4444", // red
	"#f97316", // orange
	"#eab308", // yellow
	"#22c55e", // green
	"#14b8a6", // teal
	"#06b6d4", // cyan
	"#3b82f6", // blue
	"#6366f1", // indigo
	"#8b5cf6", // violet
	"#a855f7", // purple
	"#ec4899", // pink
	"#f43f5e", // rose
];

const projectIcons = [
	"IconCode",
	"IconDevices",
	"IconDatabase",
	"IconCloud",
	"IconLock",
	"IconChartBar",
	"IconUsers",
	"IconSettings",
	"IconRocket",
	"IconBulb",
	"IconPalette",
	"IconShoppingCart",
];

/**
 * Generate demo projects
 */
export async function generateDemoProjects(
	options: DemoDataOptions,
): Promise<{ projectsCreated: number }> {
	if (!options.includeProjects) {
		return { projectsCreated: 0 };
	}

	// Determine number of projects to create (default: 5-8)
	const projectCount = options.projectCount ?? Math.floor(Math.random() * 4) + 5;

	if (projectCount <= 0) {
		return { projectsCreated: 0 };
	}

	// Use default project names first, then generate random ones if needed
	const projectNames: string[] = [];
	const shuffledDefaults = faker.helpers.shuffle([...defaultProjectNames]);

	for (let i = 0; i < projectCount; i++) {
		if (i < shuffledDefaults.length) {
			projectNames.push(shuffledDefaults[i]);
		} else {
			const generator = faker.helpers.arrayElement(projectNameGenerators);
			projectNames.push(generator());
		}
	}

	// Create projects
	let projectsCreated = 0;
	// Valid statuses from projectStatusEnum: planned, active, paused, completed, archived
	const statuses: Array<"planned" | "active" | "paused" | "completed" | "archived"> = [
		"planned",
		"active",
		"active",
		"active",
		"paused",
		"completed",
	];

	for (let i = 0; i < projectNames.length; i++) {
		const name = projectNames[i];
		const color = projectColors[i % projectColors.length];
		const icon = projectIcons[i % projectIcons.length];
		const status = faker.helpers.arrayElement(statuses);

		// Generate optional budget (60% chance)
		const hasBudget = Math.random() < 0.6;
		const budgetHours = hasBudget
			? String(Math.floor(Math.random() * 500) + 50) // 50-550 hours
			: null;

		// Generate optional deadline (50% chance, only for non-completed projects)
		const hasDeadline = status !== "completed" && Math.random() < 0.5;
		const deadline = hasDeadline ? faker.date.future({ years: 1 }) : null;

		await db.insert(project).values({
			organizationId: options.organizationId,
			name,
			description: `Demo project - ${name}`,
			status,
			icon,
			color,
			budgetHours,
			deadline,
			isActive: status !== "archived",
			createdBy: options.createdBy,
			updatedAt: new Date(),
		});

		projectsCreated++;
	}

	return { projectsCreated };
}

/**
 * Generate manager assignments - assign employees to the owner/admin
 */
export async function generateDemoManagerAssignments(
	options: DemoDataOptions,
): Promise<{ managerAssignmentsCreated: number }> {
	// Get the current user's employee record (the owner/admin)
	const ownerEmployee = await db.query.employee.findFirst({
		where: eq(employee.userId, options.createdBy),
	});

	if (!ownerEmployee) {
		return { managerAssignmentsCreated: 0 };
	}

	// Get all other employees in the organization (excluding the owner)
	const otherEmployees = await db.query.employee.findMany({
		where: and(
			eq(employee.organizationId, options.organizationId),
			options.employeeIds?.length ? inArray(employee.id, options.employeeIds) : undefined,
		),
	});

	// Filter out the owner and get employees without managers
	const employeesWithoutOwner = otherEmployees.filter((e) => e.id !== ownerEmployee.id);

	if (employeesWithoutOwner.length === 0) {
		return { managerAssignmentsCreated: 0 };
	}

	// Check existing manager assignments to avoid duplicates
	const existingAssignments = await db.query.employeeManagers.findMany({
		where: inArray(
			employeeManagers.employeeId,
			employeesWithoutOwner.map((e) => e.id),
		),
	});

	const employeesWithManagers = new Set(existingAssignments.map((a) => a.employeeId));

	// Assign ~60-80% of employees without managers to the owner
	const employeesNeedingManagers = employeesWithoutOwner.filter(
		(e) => !employeesWithManagers.has(e.id),
	);

	const assignmentRate = 0.6 + Math.random() * 0.2; // 60-80%
	const employeesToAssign = faker.helpers
		.shuffle(employeesNeedingManagers)
		.slice(0, Math.ceil(employeesNeedingManagers.length * assignmentRate));

	let managerAssignmentsCreated = 0;

	for (const emp of employeesToAssign) {
		await db.insert(employeeManagers).values({
			employeeId: emp.id,
			managerId: ownerEmployee.id,
			isPrimary: true,
			assignedBy: options.createdBy,
		});
		managerAssignmentsCreated++;
	}

	return { managerAssignmentsCreated };
}

// ============================================
// NEW: LOCATION GENERATORS
// ============================================

const defaultLocationNames = [
	"Main Office",
	"Downtown Branch",
	"Warehouse",
	"Distribution Center",
	"Manufacturing Plant",
	"Regional Office",
	"Retail Store",
	"Service Center",
];

const defaultSubareaNames = [
	"Reception",
	"Cashier",
	"Storage",
	"Office Area",
	"Kitchen",
	"Warehouse Floor",
	"Loading Dock",
	"Meeting Rooms",
	"Break Room",
	"Production Line",
];

/**
 * Generate demo locations with subareas
 */
export async function generateDemoLocations(options: DemoDataOptions): Promise<{
	locationsCreated: number;
	subareasCreated: number;
	supervisorAssignmentsCreated: number;
}> {
	if (!options.includeLocations) {
		return { locationsCreated: 0, subareasCreated: 0, supervisorAssignmentsCreated: 0 };
	}

	// Get employees for supervisor assignments
	const employees = await db.query.employee.findMany({
		where: eq(employee.organizationId, options.organizationId),
	});

	const locationCount = options.locationCount ?? Math.floor(Math.random() * 2) + 2; // 2-3 default
	const subareasPerLocation = options.subareasPerLocation ?? Math.floor(Math.random() * 2) + 3; // 3-4 default

	let locationsCreated = 0;
	let subareasCreated = 0;
	let supervisorAssignmentsCreated = 0;

	const shuffledLocationNames = faker.helpers.shuffle([...defaultLocationNames]);
	const shuffledEmployees = faker.helpers.shuffle([...employees]);

	for (let i = 0; i < locationCount; i++) {
		const locationName =
			i < shuffledLocationNames.length
				? `Demo - ${shuffledLocationNames[i]}`
				: `Demo - ${faker.company.name()} Office`;

		// Create location with realistic address
		const [newLocation] = await db
			.insert(location)
			.values({
				organizationId: options.organizationId,
				name: locationName,
				street: faker.location.streetAddress(),
				city: faker.location.city(),
				postalCode: faker.location.zipCode(),
				country: "DE", // Default to Germany
				isActive: true,
				createdBy: options.createdBy,
				updatedAt: new Date(),
			})
			.returning();

		locationsCreated++;

		// Assign a location supervisor (50% chance)
		if (shuffledEmployees.length > 0 && Math.random() < 0.5) {
			const supervisor = shuffledEmployees[i % shuffledEmployees.length];
			await db.insert(locationEmployee).values({
				locationId: newLocation.id,
				employeeId: supervisor.id,
				isPrimary: true,
				createdBy: options.createdBy,
			});
			supervisorAssignmentsCreated++;
		}

		// Create subareas for this location
		const shuffledSubareaNames = faker.helpers.shuffle([...defaultSubareaNames]);
		for (let j = 0; j < subareasPerLocation && j < shuffledSubareaNames.length; j++) {
			const [newSubarea] = await db
				.insert(locationSubarea)
				.values({
					locationId: newLocation.id,
					name: `Demo - ${shuffledSubareaNames[j]}`,
					isActive: true,
					createdBy: options.createdBy,
					updatedAt: new Date(),
				})
				.returning();

			subareasCreated++;

			// Assign a subarea supervisor (30% chance)
			if (shuffledEmployees.length > 0 && Math.random() < 0.3) {
				const supervisor =
					shuffledEmployees[(i * subareasPerLocation + j) % shuffledEmployees.length];
				await db.insert(subareaEmployee).values({
					subareaId: newSubarea.id,
					employeeId: supervisor.id,
					isPrimary: true,
					createdBy: options.createdBy,
				});
				supervisorAssignmentsCreated++;
			}
		}
	}

	return { locationsCreated, subareasCreated, supervisorAssignmentsCreated };
}

// ============================================
// NEW: WORK CATEGORY GENERATORS
// ============================================

const workCategoryTemplates = [
	{ name: "Normal Work", factor: "1.00", color: "#10b981" },
	{ name: "Training", factor: "1.00", color: "#8b5cf6" },
	{ name: "Meeting", factor: "1.00", color: "#3b82f6" },
	{ name: "Passive Travel", factor: "0.50", color: "#94a3b8" },
	{ name: "Active Travel", factor: "0.75", color: "#06b6d4" },
	{ name: "Standby Duty", factor: "0.50", color: "#f59e0b" },
	{ name: "Overtime", factor: "1.25", color: "#f97316" },
	{ name: "Night Work", factor: "1.25", color: "#6366f1" },
	{ name: "Hazardous Work", factor: "1.50", color: "#ef4444" },
	{ name: "Weekend Work", factor: "1.50", color: "#ec4899" },
];

const workCategorySetTemplates = [
	{ name: "Standard Categories", description: "Default work categories for most employees" },
	{ name: "Field Work Categories", description: "Categories for field workers with travel time" },
	{ name: "Manufacturing Categories", description: "Categories for production and manufacturing" },
];

/**
 * Generate demo work category sets and categories
 */
export async function generateDemoWorkCategories(options: DemoDataOptions): Promise<{
	setsCreated: number;
	categoriesCreated: number;
	assignmentsCreated: number;
}> {
	if (!options.includeWorkCategories) {
		return { setsCreated: 0, categoriesCreated: 0, assignmentsCreated: 0 };
	}

	const setCount = options.workCategorySetCount ?? 2;
	const categoryCount = options.workCategoryCount ?? Math.min(8, workCategoryTemplates.length);

	let setsCreated = 0;
	let categoriesCreated = 0;
	let assignmentsCreated = 0;

	// First, create all categories at org level
	const createdCategories: Array<{ id: string; name: string }> = [];
	const shuffledTemplates = faker.helpers.shuffle([...workCategoryTemplates]);

	for (let i = 0; i < categoryCount && i < shuffledTemplates.length; i++) {
		const template = shuffledTemplates[i];
		const [newCategory] = await db
			.insert(workCategory)
			.values({
				organizationId: options.organizationId,
				name: template.name,
				description: `Demo work category - ${template.name}`,
				factor: template.factor,
				color: template.color,
				isActive: true,
				createdBy: options.createdBy,
				updatedAt: new Date(),
			})
			.returning();

		createdCategories.push({ id: newCategory.id, name: newCategory.name });
		categoriesCreated++;
	}

	// Create category sets and link categories
	const createdSets: Array<{ id: string; name: string }> = [];

	for (let i = 0; i < setCount && i < workCategorySetTemplates.length; i++) {
		const template = workCategorySetTemplates[i];
		const [newSet] = await db
			.insert(workCategorySet)
			.values({
				organizationId: options.organizationId,
				name: template.name,
				description: `Demo work category set - ${template.description}`,
				isActive: true,
				createdBy: options.createdBy,
				updatedAt: new Date(),
			})
			.returning();

		createdSets.push({ id: newSet.id, name: newSet.name });
		setsCreated++;

		// Link categories to this set (each set gets a different subset)
		const startIdx = i * 3; // Each set gets different categories
		const categoriesForSet = createdCategories.slice(startIdx, startIdx + 6);

		// Always include "Normal Work" if available
		const normalWork = createdCategories.find((c) => c.name === "Normal Work");
		if (normalWork && !categoriesForSet.find((c) => c.name === "Normal Work")) {
			categoriesForSet.unshift(normalWork);
		}

		for (let j = 0; j < categoriesForSet.length; j++) {
			await db.insert(workCategorySetCategory).values({
				setId: newSet.id,
				categoryId: categoriesForSet[j].id,
				sortOrder: j,
			});
		}
	}

	// Create organization-level assignment (first set as default)
	if (createdSets.length > 0) {
		await db.insert(workCategorySetAssignment).values({
			setId: createdSets[0].id,
			organizationId: options.organizationId,
			assignmentType: "organization",
			priority: 0,
			isActive: true,
			createdBy: options.createdBy,
			updatedAt: new Date(),
		});
		assignmentsCreated++;

		// Assign other sets to teams (if multiple sets and teams exist)
		if (createdSets.length > 1) {
			const teams = await db.query.team.findMany({
				where: eq(team.organizationId, options.organizationId),
			});

			const shuffledTeams = faker.helpers.shuffle(teams);
			const teamsToAssign = shuffledTeams.slice(0, Math.min(2, shuffledTeams.length));

			for (let i = 0; i < teamsToAssign.length && i + 1 < createdSets.length; i++) {
				await db.insert(workCategorySetAssignment).values({
					setId: createdSets[i + 1].id,
					organizationId: options.organizationId,
					assignmentType: "team",
					teamId: teamsToAssign[i].id,
					priority: 1,
					isActive: true,
					createdBy: options.createdBy,
					updatedAt: new Date(),
				});
				assignmentsCreated++;
			}
		}
	}

	return { setsCreated, categoriesCreated, assignmentsCreated };
}

// ============================================
// NEW: CHANGE POLICY GENERATORS
// ============================================

const changePolicyTemplates = [
	{
		name: "Standard Policy",
		description: "Default policy with same-day free edits, 7-day approval window",
		selfServiceDays: 0,
		approvalDays: 7,
		noApprovalRequired: false,
	},
	{
		name: "Flexible Policy",
		description: "Liberal policy allowing edits within 3 days without approval",
		selfServiceDays: 3,
		approvalDays: 14,
		noApprovalRequired: false,
	},
	{
		name: "Trust Policy",
		description: "No approval required - full trust mode",
		selfServiceDays: 0,
		approvalDays: 0,
		noApprovalRequired: true,
	},
	{
		name: "Strict Policy",
		description: "All clock-outs require manager approval",
		selfServiceDays: 0,
		approvalDays: 0,
		noApprovalRequired: false,
	},
];

/**
 * Generate demo change policies
 */
export async function generateDemoChangePolicies(options: DemoDataOptions): Promise<{
	policiesCreated: number;
	assignmentsCreated: number;
}> {
	if (!options.includeChangePolicies) {
		return { policiesCreated: 0, assignmentsCreated: 0 };
	}

	const policyCount = options.changePolicyCount ?? 2;
	let policiesCreated = 0;
	let assignmentsCreated = 0;

	const createdPolicies: Array<{ id: string; name: string }> = [];

	for (let i = 0; i < policyCount && i < changePolicyTemplates.length; i++) {
		const template = changePolicyTemplates[i];
		const [newPolicy] = await db
			.insert(changePolicy)
			.values({
				organizationId: options.organizationId,
				name: template.name,
				description: `Demo change policy - ${template.description}`,
				selfServiceDays: template.selfServiceDays,
				approvalDays: template.approvalDays,
				noApprovalRequired: template.noApprovalRequired,
				isActive: true,
				createdBy: options.createdBy,
				updatedAt: new Date(),
			})
			.returning();

		createdPolicies.push({ id: newPolicy.id, name: newPolicy.name });
		policiesCreated++;
	}

	// Create organization-level assignment (first policy as default)
	if (createdPolicies.length > 0) {
		await db.insert(changePolicyAssignment).values({
			policyId: createdPolicies[0].id,
			organizationId: options.organizationId,
			assignmentType: "organization",
			priority: 0,
			isActive: true,
			createdBy: options.createdBy,
			updatedAt: new Date(),
		});
		assignmentsCreated++;
	}

	return { policiesCreated, assignmentsCreated };
}

// ============================================
// NEW: SHIFT SCHEDULING GENERATORS
// ============================================

const shiftTemplateData = [
	{ name: "Morning Shift", startTime: "06:00", endTime: "14:00", color: "#fbbf24" },
	{ name: "Day Shift", startTime: "09:00", endTime: "17:00", color: "#10b981" },
	{ name: "Afternoon Shift", startTime: "14:00", endTime: "22:00", color: "#3b82f6" },
	{ name: "Night Shift", startTime: "22:00", endTime: "06:00", color: "#6366f1" },
	{ name: "Split Shift", startTime: "10:00", endTime: "18:00", color: "#ec4899" },
	{ name: "Flex Shift", startTime: "08:00", endTime: "16:00", color: "#14b8a6" },
];

/**
 * Generate demo shift templates
 */
export async function generateDemoShiftTemplates(
	options: DemoDataOptions,
): Promise<{ templatesCreated: number }> {
	if (!options.includeShifts) {
		return { templatesCreated: 0 };
	}

	// Get subareas for the organization
	const orgLocations = await db.query.location.findMany({
		where: eq(location.organizationId, options.organizationId),
	});

	if (orgLocations.length === 0) {
		return { templatesCreated: 0 };
	}

	const locationIds = orgLocations.map((l) => l.id);
	const subareas = await db.query.locationSubarea.findMany({
		where: inArray(locationSubarea.locationId, locationIds),
	});

	const templateCount = options.shiftTemplateCount ?? Math.min(4, shiftTemplateData.length);
	let templatesCreated = 0;

	for (let i = 0; i < templateCount && i < shiftTemplateData.length; i++) {
		const template = shiftTemplateData[i];
		// Assign to a random subarea if available
		const subarea = subareas.length > 0 ? faker.helpers.arrayElement(subareas) : null;

		await db.insert(shiftTemplate).values({
			organizationId: options.organizationId,
			name: `Demo ${template.name}`,
			startTime: template.startTime,
			endTime: template.endTime,
			color: template.color,
			subareaId: subarea?.id ?? null,
			isActive: true,
			createdBy: options.createdBy,
			updatedAt: new Date(),
		});

		templatesCreated++;
	}

	return { templatesCreated };
}

/**
 * Generate demo shifts with recurrence patterns
 */
export async function generateDemoShifts(options: DemoDataOptions): Promise<{
	recurrencesCreated: number;
	shiftsCreated: number;
	requestsCreated: number;
}> {
	if (!options.includeShifts || !options.generateShiftInstances) {
		return { recurrencesCreated: 0, shiftsCreated: 0, requestsCreated: 0 };
	}

	// Get shift templates for this organization
	const templates = await db.query.shiftTemplate.findMany({
		where: eq(shiftTemplate.organizationId, options.organizationId),
	});

	if (templates.length === 0) {
		return { recurrencesCreated: 0, shiftsCreated: 0, requestsCreated: 0 };
	}

	// Get subareas
	const orgLocations = await db.query.location.findMany({
		where: eq(location.organizationId, options.organizationId),
	});
	const locationIds = orgLocations.map((l) => l.id);
	const subareas = await db.query.locationSubarea.findMany({
		where: inArray(locationSubarea.locationId, locationIds),
	});

	if (subareas.length === 0) {
		return { recurrencesCreated: 0, shiftsCreated: 0, requestsCreated: 0 };
	}

	// Get employees for shift assignment
	const employees = await db.query.employee.findMany({
		where: eq(employee.organizationId, options.organizationId),
	});

	let recurrencesCreated = 0;
	let shiftsCreated = 0;
	let requestsCreated = 0;

	// Create recurrence patterns for templates
	for (const template of templates) {
		const subarea = template.subareaId
			? subareas.find((s) => s.id === template.subareaId)
			: faker.helpers.arrayElement(subareas);

		if (!subarea) continue;

		const [newRecurrence] = await db
			.insert(shiftRecurrence)
			.values({
				organizationId: options.organizationId,
				templateId: template.id,
				subareaId: subarea.id,
				recurrenceType: "weekly",
				startTime: template.startTime,
				endTime: template.endTime,
				color: template.color,
				startDate: options.dateRange.start,
				endDate: options.dateRange.end,
				weeklyDays: JSON.stringify([1, 2, 3, 4, 5]), // Monday-Friday
				isActive: true,
				createdBy: options.createdBy,
				updatedAt: new Date(),
			})
			.returning();

		recurrencesCreated++;

		// Generate shift instances for the date range
		const startDT = DateTime.fromJSDate(options.dateRange.start, { zone: "utc" });
		const endDT = DateTime.fromJSDate(options.dateRange.end, { zone: "utc" });
		let currentDT = startDT;

		const shuffledEmployees = faker.helpers.shuffle([...employees]);
		let employeeIndex = 0;

		while (currentDT <= endDT) {
			// Skip weekends
			if (currentDT.weekday >= 1 && currentDT.weekday <= 5) {
				// 70% assigned to employee, 30% open shifts
				const assignToEmployee = Math.random() < 0.7 && shuffledEmployees.length > 0;
				const assignedEmployee = assignToEmployee
					? shuffledEmployees[employeeIndex % shuffledEmployees.length]
					: null;

				if (assignToEmployee) employeeIndex++;

				// 80% published, 20% draft
				const isPublished = Math.random() < 0.8;

				const [newShift] = await db
					.insert(shift)
					.values({
						organizationId: options.organizationId,
						employeeId: assignedEmployee?.id ?? null,
						templateId: template.id,
						subareaId: subarea.id,
						recurrenceId: newRecurrence.id,
						date: currentDT.toJSDate(),
						startTime: template.startTime,
						endTime: template.endTime,
						status: isPublished ? "published" : "draft",
						publishedAt: isPublished ? new Date() : null,
						publishedBy: isPublished ? options.createdBy : null,
						color: template.color,
						createdBy: options.createdBy,
						updatedAt: new Date(),
					})
					.returning();

				shiftsCreated++;

				// 10% chance to create a shift request for published, assigned shifts
				if (isPublished && assignedEmployee && Math.random() < 0.1 && employees.length > 1) {
					const otherEmployees = employees.filter((e) => e.id !== assignedEmployee.id);
					const targetEmployee =
						Math.random() < 0.5 ? faker.helpers.arrayElement(otherEmployees) : null;

					const requestTypes: Array<"swap" | "assignment" | "pickup"> = targetEmployee
						? ["swap"]
						: ["pickup"];
					const requestType = faker.helpers.arrayElement(requestTypes);

					// 60% approved, 25% pending, 15% rejected
					const statusRand = Math.random();
					const requestStatus: "pending" | "approved" | "rejected" =
						statusRand < 0.6 ? "approved" : statusRand < 0.85 ? "pending" : "rejected";

					await db.insert(shiftRequest).values({
						shiftId: newShift.id,
						type: requestType,
						status: requestStatus,
						requesterId: assignedEmployee.id,
						targetEmployeeId: targetEmployee?.id ?? null,
						reason: faker.helpers.arrayElement([
							"Personal appointment",
							"Family commitment",
							"Doctor visit",
							"Schedule conflict",
						]),
						reasonCategory: faker.helpers.arrayElement([
							"personal",
							"emergency",
							"childcare",
							"other",
						]),
						approverId: requestStatus !== "pending" ? employees[0]?.id : null,
						approvedAt: requestStatus !== "pending" ? new Date() : null,
						rejectionReason: requestStatus === "rejected" ? "Schedule conflict" : null,
						updatedAt: new Date(),
					});

					requestsCreated++;
				}
			}

			currentDT = currentDT.plus({ days: 1 });
		}
	}

	return { recurrencesCreated, shiftsCreated, requestsCreated };
}

/**
 * Assign work categories to existing work periods
 * This is called after time entries are generated
 */
export async function assignWorkCategoriesToPeriods(
	options: DemoDataOptions,
): Promise<{ workCategoriesAssigned: number }> {
	if (!options.assignWorkCategoriesToPeriods) {
		return { workCategoriesAssigned: 0 };
	}

	// Get employees for the organization
	const employees = await db.query.employee.findMany({
		where: options.employeeIds?.length
			? and(
					eq(employee.organizationId, options.organizationId),
					inArray(employee.id, options.employeeIds),
				)
			: eq(employee.organizationId, options.organizationId),
	});

	if (employees.length === 0) {
		return { workCategoriesAssigned: 0 };
	}

	// Get work categories for this organization
	const categories = await db.query.workCategory.findMany({
		where: and(
			eq(workCategory.organizationId, options.organizationId),
			eq(workCategory.isActive, true),
		),
	});

	if (categories.length === 0) {
		return { workCategoriesAssigned: 0 };
	}

	const employeeIds = employees.map((e) => e.id);

	// Get work periods without a category assignment
	const periodsWithoutCategory = await db.query.workPeriod.findMany({
		where: and(
			inArray(workPeriod.employeeId, employeeIds),
			eq(workPeriod.isActive, false), // Only completed periods
		),
	});

	// Assign categories to 20-30% of work periods
	const assignmentRate = 0.2 + Math.random() * 0.1;
	const periodsToAssign = faker.helpers
		.shuffle(periodsWithoutCategory)
		.slice(0, Math.ceil(periodsWithoutCategory.length * assignmentRate));

	let workCategoriesAssigned = 0;

	// Weighted category selection (more "Normal Work", less "Hazardous")
	const weightedCategories: string[] = [];
	for (const cat of categories) {
		// More weight for common categories
		const weight =
			cat.name === "Normal Work" || cat.name === "Meeting" ? 5 : cat.name === "Training" ? 3 : 1;
		for (let i = 0; i < weight; i++) {
			weightedCategories.push(cat.id);
		}
	}

	for (const period of periodsToAssign) {
		const categoryId = faker.helpers.arrayElement(weightedCategories);

		await db
			.update(workPeriod)
			.set({ workCategoryId: categoryId })
			.where(eq(workPeriod.id, period.id));

		workCategoriesAssigned++;
	}

	return { workCategoriesAssigned };
}

/**
 * Generate all demo data
 */
export async function generateDemoData(options: DemoDataOptions): Promise<DemoDataResult> {
	// Phase 1: Foundation data (teams, projects, locations)
	const teamResult = await generateDemoTeams(options);
	const projectResult = await generateDemoProjects(options);
	const locationResult = await generateDemoLocations(options);

	// Phase 2: Configuration data (categories, policies)
	const workCategoryResult = await generateDemoWorkCategories(options);
	const changePolicyResult = await generateDemoChangePolicies(options);

	// Phase 3: Manager assignments (depends on teams)
	const managerResult = await generateDemoManagerAssignments(options);

	// Phase 4: Shift templates (depends on locations)
	const shiftTemplateResult = await generateDemoShiftTemplates(options);

	// Phase 5: Time data
	const timeResult = await generateDemoTimeEntries(options);
	const absenceResult = await generateDemoAbsences(options);

	// Phase 6: Shift instances (depends on templates + employees)
	const shiftResult = await generateDemoShifts(options);

	// Phase 7: Work category assignments (depends on categories + time entries)
	const categoryAssignmentResult = await assignWorkCategoriesToPeriods(options);

	return {
		timeEntriesCreated: timeResult.timeEntriesCreated,
		workPeriodsCreated: timeResult.workPeriodsCreated,
		absencesCreated: absenceResult.absencesCreated,
		teamsCreated: teamResult.teamsCreated,
		employeesAssignedToTeams: teamResult.employeesAssignedToTeams,
		projectsCreated: projectResult.projectsCreated,
		managerAssignmentsCreated: managerResult.managerAssignmentsCreated,
		// NEW: Location results
		locationsCreated: locationResult.locationsCreated,
		subareasCreated: locationResult.subareasCreated,
		locationSupervisorsAssigned: locationResult.supervisorAssignmentsCreated,
		// NEW: Work category results
		workCategorySetsCreated: workCategoryResult.setsCreated,
		workCategoriesCreated: workCategoryResult.categoriesCreated,
		workCategoryAssignmentsCreated: workCategoryResult.assignmentsCreated,
		workCategoriesAssignedToPeriods: categoryAssignmentResult.workCategoriesAssigned,
		// NEW: Change policy results
		changePoliciesCreated: changePolicyResult.policiesCreated,
		changePolicyAssignmentsCreated: changePolicyResult.assignmentsCreated,
		// NEW: Shift scheduling results
		shiftTemplatesCreated: shiftTemplateResult.templatesCreated,
		shiftRecurrencesCreated: shiftResult.recurrencesCreated,
		shiftsCreated: shiftResult.shiftsCreated,
		shiftRequestsCreated: shiftResult.requestsCreated,
	};
}

/**
 * Clear all time-related data for an organization
 */
export async function clearOrganizationTimeData(organizationId: string): Promise<ClearDataResult> {
	// Initialize result with zeros
	const result: ClearDataResult = {
		timeEntriesDeleted: 0,
		workPeriodsDeleted: 0,
		absencesDeleted: 0,
		vacationAllowancesReset: 0,
		teamsDeleted: 0,
		employeesUnassignedFromTeams: 0,
		projectsDeleted: 0,
		managerAssignmentsDeleted: 0,
		// NEW fields
		locationsDeleted: 0,
		subareasDeleted: 0,
		workCategorySetsDeleted: 0,
		workCategoriesDeleted: 0,
		workCategoryAssignmentsRemoved: 0,
		changePoliciesDeleted: 0,
		shiftTemplatesDeleted: 0,
		shiftRecurrencesDeleted: 0,
		shiftsDeleted: 0,
		shiftRequestsDeleted: 0,
	};

	// Get all employees in this organization
	const employees = await db.query.employee.findMany({
		where: eq(employee.organizationId, organizationId),
	});

	const employeeIds = employees.length > 0 ? employees.map((e) => e.id) : [];

	// ============================================
	// SHIFT CLEANUP (delete shifts first - they reference templates/subareas)
	// ============================================

	// Delete shift requests (references shifts)
	const allShifts = await db.query.shift.findMany({
		where: eq(shift.organizationId, organizationId),
	});
	const shiftIds = allShifts.map((s) => s.id);

	if (shiftIds.length > 0) {
		const shiftRequestsToDelete = await db.query.shiftRequest.findMany({
			where: inArray(shiftRequest.shiftId, shiftIds),
		});
		if (shiftRequestsToDelete.length > 0) {
			await db.delete(shiftRequest).where(inArray(shiftRequest.shiftId, shiftIds));
			result.shiftRequestsDeleted = shiftRequestsToDelete.length;
		}

		// Delete shifts
		await db.delete(shift).where(eq(shift.organizationId, organizationId));
		result.shiftsDeleted = allShifts.length;
	}

	// Delete shift recurrences
	const shiftRecurrencesToDelete = await db.query.shiftRecurrence.findMany({
		where: eq(shiftRecurrence.organizationId, organizationId),
	});
	if (shiftRecurrencesToDelete.length > 0) {
		await db.delete(shiftRecurrence).where(eq(shiftRecurrence.organizationId, organizationId));
		result.shiftRecurrencesDeleted = shiftRecurrencesToDelete.length;
	}

	// Delete demo shift templates (name starts with "Demo ")
	const allShiftTemplates = await db.query.shiftTemplate.findMany({
		where: eq(shiftTemplate.organizationId, organizationId),
	});
	const shiftTemplatesToDelete = allShiftTemplates.filter((t) => t.name.startsWith("Demo "));
	if (shiftTemplatesToDelete.length > 0) {
		await db.delete(shiftTemplate).where(
			inArray(
				shiftTemplate.id,
				shiftTemplatesToDelete.map((t) => t.id),
			),
		);
		result.shiftTemplatesDeleted = shiftTemplatesToDelete.length;
	}

	// ============================================
	// WORK CATEGORY CLEANUP
	// ============================================

	// Remove work category assignments from work periods
	if (employeeIds.length > 0) {
		const periodsWithCategories = await db.query.workPeriod.findMany({
			where: and(inArray(workPeriod.employeeId, employeeIds), isNotNull(workPeriod.workCategoryId)),
		});
		if (periodsWithCategories.length > 0) {
			await db
				.update(workPeriod)
				.set({ workCategoryId: null })
				.where(inArray(workPeriod.employeeId, employeeIds));
			result.workCategoryAssignmentsRemoved = periodsWithCategories.length;
		}
	}

	// Delete work category set assignments (cascade from sets)
	// Delete work category set categories (cascade from sets/categories)
	// Delete demo work category sets
	const allWorkCategorySets = await db.query.workCategorySet.findMany({
		where: eq(workCategorySet.organizationId, organizationId),
	});
	const workCategorySetsToDelete = allWorkCategorySets.filter((s) =>
		s.description?.startsWith("Demo work category set - "),
	);
	if (workCategorySetsToDelete.length > 0) {
		// Delete assignments first (no cascade defined)
		await db.delete(workCategorySetAssignment).where(
			inArray(
				workCategorySetAssignment.setId,
				workCategorySetsToDelete.map((s) => s.id),
			),
		);
		// Delete set categories
		await db.delete(workCategorySetCategory).where(
			inArray(
				workCategorySetCategory.setId,
				workCategorySetsToDelete.map((s) => s.id),
			),
		);
		// Delete sets
		await db.delete(workCategorySet).where(
			inArray(
				workCategorySet.id,
				workCategorySetsToDelete.map((s) => s.id),
			),
		);
		result.workCategorySetsDeleted = workCategorySetsToDelete.length;
	}

	// Delete demo work categories
	const allWorkCategories = await db.query.workCategory.findMany({
		where: eq(workCategory.organizationId, organizationId),
	});
	const workCategoriesToDelete = allWorkCategories.filter((c) =>
		c.description?.startsWith("Demo work category - "),
	);
	if (workCategoriesToDelete.length > 0) {
		await db.delete(workCategory).where(
			inArray(
				workCategory.id,
				workCategoriesToDelete.map((c) => c.id),
			),
		);
		result.workCategoriesDeleted = workCategoriesToDelete.length;
	}

	// ============================================
	// CHANGE POLICY CLEANUP
	// ============================================

	// Delete demo change policies (cascade deletes assignments)
	const allChangePolicies = await db.query.changePolicy.findMany({
		where: eq(changePolicy.organizationId, organizationId),
	});
	const changePoliciesToDelete = allChangePolicies.filter((p) =>
		p.description?.startsWith("Demo change policy - "),
	);
	if (changePoliciesToDelete.length > 0) {
		// Delete assignments first
		await db.delete(changePolicyAssignment).where(
			inArray(
				changePolicyAssignment.policyId,
				changePoliciesToDelete.map((p) => p.id),
			),
		);
		// Delete policies
		await db.delete(changePolicy).where(
			inArray(
				changePolicy.id,
				changePoliciesToDelete.map((p) => p.id),
			),
		);
		result.changePoliciesDeleted = changePoliciesToDelete.length;
	}

	// ============================================
	// LOCATION CLEANUP
	// ============================================

	// Delete demo locations (cascade deletes subareas and employee assignments)
	const allLocations = await db.query.location.findMany({
		where: eq(location.organizationId, organizationId),
	});
	const locationsToDelete = allLocations.filter((l) => l.name.startsWith("Demo - "));
	if (locationsToDelete.length > 0) {
		const locationIdsToDelete = locationsToDelete.map((l) => l.id);

		// Count subareas before deletion
		const subareasToDelete = await db.query.locationSubarea.findMany({
			where: inArray(locationSubarea.locationId, locationIdsToDelete),
		});
		result.subareasDeleted = subareasToDelete.length;

		// Delete location employee assignments
		await db
			.delete(locationEmployee)
			.where(inArray(locationEmployee.locationId, locationIdsToDelete));

		// Delete subarea employee assignments
		if (subareasToDelete.length > 0) {
			await db.delete(subareaEmployee).where(
				inArray(
					subareaEmployee.subareaId,
					subareasToDelete.map((s) => s.id),
				),
			);
		}

		// Delete subareas
		await db
			.delete(locationSubarea)
			.where(inArray(locationSubarea.locationId, locationIdsToDelete));

		// Delete locations
		await db.delete(location).where(inArray(location.id, locationIdsToDelete));
		result.locationsDeleted = locationsToDelete.length;
	}

	// ============================================
	// EXISTING CLEANUP (work periods, time entries, absences, etc.)
	// ============================================

	if (employeeIds.length > 0) {
		// Delete work periods first (references time entries)
		const workPeriodsToDelete = await db.query.workPeriod.findMany({
			where: inArray(workPeriod.employeeId, employeeIds),
		});
		if (workPeriodsToDelete.length > 0) {
			await db.delete(workPeriod).where(inArray(workPeriod.employeeId, employeeIds));
			result.workPeriodsDeleted = workPeriodsToDelete.length;
		}

		// Delete time entries
		const timeEntriesToDelete = await db.query.timeEntry.findMany({
			where: inArray(timeEntry.employeeId, employeeIds),
		});
		if (timeEntriesToDelete.length > 0) {
			await db.delete(timeEntry).where(inArray(timeEntry.employeeId, employeeIds));
			result.timeEntriesDeleted = timeEntriesToDelete.length;
		}

		// Delete absence entries
		const absencesToDelete = await db.query.absenceEntry.findMany({
			where: inArray(absenceEntry.employeeId, employeeIds),
		});
		if (absencesToDelete.length > 0) {
			await db.delete(absenceEntry).where(inArray(absenceEntry.employeeId, employeeIds));
			result.absencesDeleted = absencesToDelete.length;
		}

		// Delete employee vacation allowances (reset to org defaults)
		const allowancesToDelete = await db.query.employeeVacationAllowance.findMany({
			where: inArray(employeeVacationAllowance.employeeId, employeeIds),
		});
		if (allowancesToDelete.length > 0) {
			await db
				.delete(employeeVacationAllowance)
				.where(inArray(employeeVacationAllowance.employeeId, employeeIds));
			result.vacationAllowancesReset = allowancesToDelete.length;
		}

		// Unassign employees from teams
		const employeesWithTeams = employees.filter((e) => e.teamId !== null);
		if (employeesWithTeams.length > 0) {
			await db
				.update(employee)
				.set({ teamId: null })
				.where(
					inArray(
						employee.id,
						employeesWithTeams.map((e) => e.id),
					),
				);
			result.employeesUnassignedFromTeams = employeesWithTeams.length;
		}

		// Delete manager assignments for these employees
		const managerAssignmentsToDelete = await db.query.employeeManagers.findMany({
			where: inArray(employeeManagers.employeeId, employeeIds),
		});
		if (managerAssignmentsToDelete.length > 0) {
			await db.delete(employeeManagers).where(inArray(employeeManagers.employeeId, employeeIds));
			result.managerAssignmentsDeleted = managerAssignmentsToDelete.length;
		}
	}

	// Delete demo teams (teams with description starting with "Demo team")
	const allTeams = await db.query.team.findMany({
		where: eq(team.organizationId, organizationId),
	});
	const teamsToDelete = allTeams.filter((t) => t.description?.startsWith("Demo team - "));
	if (teamsToDelete.length > 0) {
		await db.delete(team).where(
			inArray(
				team.id,
				teamsToDelete.map((t) => t.id),
			),
		);
		result.teamsDeleted = teamsToDelete.length;
	}

	// Delete demo projects (projects with description starting with "Demo project")
	const allProjects = await db.query.project.findMany({
		where: eq(project.organizationId, organizationId),
	});
	const projectsToDelete = allProjects.filter((p) => p.description?.startsWith("Demo project - "));
	if (projectsToDelete.length > 0) {
		await db.delete(project).where(
			inArray(
				project.id,
				projectsToDelete.map((p) => p.id),
			),
		);
		result.projectsDeleted = projectsToDelete.length;
	}

	return result;
}
