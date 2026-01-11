"use server";

import { faker } from "@faker-js/faker";
import { and, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeVacationAllowance,
	timeEntry,
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
	employeeIds?: string[];
	createdBy: string;
}

export interface DemoDataResult {
	timeEntriesCreated: number;
	workPeriodsCreated: number;
	absencesCreated: number;
}

export interface ClearDataResult {
	timeEntriesDeleted: number;
	workPeriodsDeleted: number;
	absencesDeleted: number;
	vacationAllowancesReset: number;
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

	// Convert to Date objects for database
	const startDate = dateToDB(startDT)!;
	const endDate = dateToDB(endDT)!;

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
 * Generate all demo data
 */
export async function generateDemoData(options: DemoDataOptions): Promise<DemoDataResult> {
	const timeResult = await generateDemoTimeEntries(options);
	const absenceResult = await generateDemoAbsences(options);

	return {
		timeEntriesCreated: timeResult.timeEntriesCreated,
		workPeriodsCreated: timeResult.workPeriodsCreated,
		absencesCreated: absenceResult.absencesCreated,
	};
}

/**
 * Clear all time-related data for an organization
 */
export async function clearOrganizationTimeData(organizationId: string): Promise<ClearDataResult> {
	// Get all employees in this organization
	const employees = await db.query.employee.findMany({
		where: eq(employee.organizationId, organizationId),
	});

	if (employees.length === 0) {
		return {
			timeEntriesDeleted: 0,
			workPeriodsDeleted: 0,
			absencesDeleted: 0,
			vacationAllowancesReset: 0,
		};
	}

	const employeeIds = employees.map((e) => e.id);

	// Delete work periods first (references time entries)
	const workPeriodsToDelete = await db.query.workPeriod.findMany({
		where: inArray(workPeriod.employeeId, employeeIds),
	});
	if (workPeriodsToDelete.length > 0) {
		await db.delete(workPeriod).where(inArray(workPeriod.employeeId, employeeIds));
	}

	// Delete time entries
	const timeEntriesToDelete = await db.query.timeEntry.findMany({
		where: inArray(timeEntry.employeeId, employeeIds),
	});
	if (timeEntriesToDelete.length > 0) {
		await db.delete(timeEntry).where(inArray(timeEntry.employeeId, employeeIds));
	}

	// Delete absence entries
	const absencesToDelete = await db.query.absenceEntry.findMany({
		where: inArray(absenceEntry.employeeId, employeeIds),
	});
	if (absencesToDelete.length > 0) {
		await db.delete(absenceEntry).where(inArray(absenceEntry.employeeId, employeeIds));
	}

	// Delete employee vacation allowances (reset to org defaults)
	const allowancesToDelete = await db.query.employeeVacationAllowance.findMany({
		where: inArray(employeeVacationAllowance.employeeId, employeeIds),
	});
	if (allowancesToDelete.length > 0) {
		await db
			.delete(employeeVacationAllowance)
			.where(inArray(employeeVacationAllowance.employeeId, employeeIds));
	}

	return {
		timeEntriesDeleted: timeEntriesToDelete.length,
		workPeriodsDeleted: workPeriodsToDelete.length,
		absencesDeleted: absencesToDelete.length,
		vacationAllowancesReset: allowancesToDelete.length,
	};
}
