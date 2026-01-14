"use server";

import { faker } from "@faker-js/faker";
import { and, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeManagers,
	employeeVacationAllowance,
	project,
	team,
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
	includeTeams: boolean;
	teamCount?: number; // Number of teams to create (default: 3-5)
	includeProjects: boolean;
	projectCount?: number; // Number of projects to create (default: 5-8)
	employeeIds?: string[];
	createdBy: string;
}

export interface DemoDataResult {
	timeEntriesCreated: number;
	workPeriodsCreated: number;
	absencesCreated: number;
	teamsCreated: number;
	employeesAssignedToTeams: number;
	projectsCreated: number;
	managerAssignmentsCreated: number;
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

/**
 * Generate all demo data
 */
export async function generateDemoData(options: DemoDataOptions): Promise<DemoDataResult> {
	// Generate teams first (so employees have teams before other data)
	const teamResult = await generateDemoTeams(options);
	const projectResult = await generateDemoProjects(options);
	const managerResult = await generateDemoManagerAssignments(options);
	const timeResult = await generateDemoTimeEntries(options);
	const absenceResult = await generateDemoAbsences(options);

	return {
		timeEntriesCreated: timeResult.timeEntriesCreated,
		workPeriodsCreated: timeResult.workPeriodsCreated,
		absencesCreated: absenceResult.absencesCreated,
		teamsCreated: teamResult.teamsCreated,
		employeesAssignedToTeams: teamResult.employeesAssignedToTeams,
		projectsCreated: projectResult.projectsCreated,
		managerAssignmentsCreated: managerResult.managerAssignmentsCreated,
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
			teamsDeleted: 0,
			employeesUnassignedFromTeams: 0,
			projectsDeleted: 0,
			managerAssignmentsDeleted: 0,
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
	}

	// Delete manager assignments for these employees
	const managerAssignmentsToDelete = await db.query.employeeManagers.findMany({
		where: inArray(employeeManagers.employeeId, employeeIds),
	});

	if (managerAssignmentsToDelete.length > 0) {
		await db.delete(employeeManagers).where(inArray(employeeManagers.employeeId, employeeIds));
	}

	return {
		timeEntriesDeleted: timeEntriesToDelete.length,
		workPeriodsDeleted: workPeriodsToDelete.length,
		absencesDeleted: absencesToDelete.length,
		vacationAllowancesReset: allowancesToDelete.length,
		teamsDeleted: teamsToDelete.length,
		employeesUnassignedFromTeams: employeesWithTeams.length,
		projectsDeleted: projectsToDelete.length,
		managerAssignmentsDeleted: managerAssignmentsToDelete.length,
	};
}
