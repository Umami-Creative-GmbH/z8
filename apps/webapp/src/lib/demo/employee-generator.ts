"use server";

import { faker } from "@faker-js/faker";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import { employee } from "@/db/schema";

export interface GenerateEmployeesOptions {
	organizationId: string;
	count: number;
	includeManagers: boolean;
}

export interface GenerateEmployeesResult {
	usersCreated: number;
	employeesCreated: number;
	managersCreated: number;
}

/**
 * Common job positions for demo employees
 */
const positions = [
	"Software Engineer",
	"Senior Software Engineer",
	"Frontend Developer",
	"Backend Developer",
	"Full Stack Developer",
	"DevOps Engineer",
	"QA Engineer",
	"Product Manager",
	"Project Manager",
	"UX Designer",
	"UI Designer",
	"Data Analyst",
	"Marketing Specialist",
	"Sales Representative",
	"Customer Support",
	"HR Specialist",
	"Finance Analyst",
	"Technical Writer",
	"System Administrator",
	"Business Analyst",
];

/**
 * Generate demo employees with fake user accounts
 * Creates users that can't login (no password) but have proper employee records
 */
export async function generateDemoEmployees(
	options: GenerateEmployeesOptions,
): Promise<GenerateEmployeesResult> {
	const { organizationId, count, includeManagers } = options;

	let usersCreated = 0;
	let employeesCreated = 0;
	let managersCreated = 0;

	// Calculate role distribution (20% managers if includeManagers is true)
	const managerCount = includeManagers ? Math.max(1, Math.floor(count * 0.2)) : 0;

	// Generate employees
	for (let i = 0; i < count; i++) {
		const isManager = i < managerCount;
		const firstName = faker.person.firstName();
		const lastName = faker.person.lastName();
		const email = `demo-${faker.string.alphanumeric(8).toLowerCase()}@demo.invalid`;

		// Create user account (no password = can't login)
		const userId = `demo_${faker.string.alphanumeric(16)}`;
		const memberId = `demo_member_${faker.string.alphanumeric(16)}`;

		try {
			// Insert user
			await db.insert(user).values({
				id: userId,
				name: `${firstName} ${lastName}`,
				email,
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date(),
			});
			usersCreated++;

			// Insert member (organization membership)
			await db.insert(member).values({
				id: memberId,
				organizationId,
				userId,
				role: isManager ? "admin" : "member",
				createdAt: new Date(),
			});

			// Insert employee
			const startDate = faker.date.past({ years: 3 });
			const gender = faker.helpers.arrayElement(["male", "female", "other"] as const);
			const birthday = faker.date.birthdate({ min: 22, max: 55, mode: "age" });

			await db.insert(employee).values({
				userId,
				organizationId,
				firstName,
				lastName,
				gender,
				birthday,
				role: isManager ? "manager" : "employee",
				employeeNumber: `EMP${String(faker.number.int({ min: 1000, max: 9999 }))}`,
				position: faker.helpers.arrayElement(positions),
				startDate,
				isActive: true,
			});
			employeesCreated++;
			if (isManager) managersCreated++;
		} catch (error) {
			console.error(`Error creating demo employee ${i + 1}:`, error);
			// Continue with next employee
		}
	}

	return {
		usersCreated,
		employeesCreated,
		managersCreated,
	};
}
