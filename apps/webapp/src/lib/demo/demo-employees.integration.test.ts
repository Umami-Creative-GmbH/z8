/**
 * #1196: the demo employee generator never gives two employees of an
 * organization the same personnel number, also when its random draws keep
 * hitting numbers the organization already uses. Runs against a disposable
 * database.
 */
import { faker } from "@faker-js/faker";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const { generateDemoEmployees } = await import("./employee-generator");

describe("demo employee personnel numbers on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	const demoUserIds: string[] = [];

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		vi.restoreAllMocks();
		await fixture?.close();
		// Once their organization is gone, the generated users go too.
		await fixture?.pool.query(`delete from "user" where id = any($1::text[])`, [demoUserIds]);
	});

	it("gives every generated employee a number no one in the organization holds", async () => {
		await fixture.pool.query("update employee set employee_number = 'emp5000' where id = $1", [
			fixture.employeeId,
		]);
		// Every random draw hits the number the organization already uses.
		const randomInt = faker.number.int.bind(faker.number);
		vi.spyOn(faker.number, "int").mockImplementation((options) =>
			typeof options === "object" && options.min === 1000 && options.max === 9999
				? 5000
				: randomInt(options),
		);

		const result = await generateDemoEmployees({
			organizationId: fixture.organizationId,
			count: 3,
			includeManagers: false,
		});

		expect(result.employeesCreated).toBe(3);
		const { rows } = await fixture.pool.query<{ employee_number: string | null }>(
			"select employee_number from employee where organization_id = $1 and employee_number is not null",
			[fixture.organizationId],
		);
		const keys = rows.map((row) => row.employee_number?.toLowerCase());
		expect(keys).toHaveLength(4);
		expect(new Set(keys).size).toBe(4);

		const demoUsers = await fixture.pool.query<{ user_id: string }>(
			"select user_id from employee where organization_id = $1 and user_id like 'demo\\_%'",
			[fixture.organizationId],
		);
		demoUserIds.push(...demoUsers.rows.map((row) => row.user_id));
	});
});
