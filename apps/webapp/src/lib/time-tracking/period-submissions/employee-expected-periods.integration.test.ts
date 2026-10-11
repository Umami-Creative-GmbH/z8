import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { loadExpectedSubmissionPeriods } from "./employee-expected-periods";
import { savePeriodSubmissionSettings } from "./settings";

const window = { from: parsePlainDate("2026-03-09"), to: parsePlainDate("2026-03-29") };

describe("expected submission periods read from PostgreSQL", () => {
	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let vacationCategoryId: string;

	async function seedAbsence(
		employeeId: string,
		input: { startDate: string; endDate: string; status: "approved" | "pending" },
	) {
		await fixture.pool.query(
			`insert into absence_entry (employee_id, category_id, start_date, end_date, status, organization_id, updated_at)
			 values ($1, $2, $3, $4, $5, $6, now())`,
			[
				employeeId,
				vacationCategoryId,
				input.startDate,
				input.endDate,
				input.status,
				organizationId,
			],
		);
	}

	const ranges = async (employeeId: string, organization = organizationId) =>
		(
			await loadExpectedSubmissionPeriods(fixture.db, {
				organizationId: organization,
				employeeId,
				window,
			})
		).map((period) => `${period.startDate}..${period.endDate}`);

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = await fixture.createOrganization();
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			organizationId,
		]);
		vacationCategoryId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id, organization_id, type, name, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', now())`,
			[vacationCategoryId, organizationId],
		);
		await savePeriodSubmissionSettings(
			{
				organizationId,
				actorUserId: fixture.ownerUserId,
				cadence: { kind: "weekly", weekStartDay: "monday" },
				secondReminderDelayDays: 3,
			},
			{ database: fixture.db, clock: { nowInstant: () => parseInstant("2026-03-04T10:00:00Z") } },
		);
	});
	afterAll(async () => {
		await fixture?.close();
	});

	it("expects every week except one fully covered by an approved absence", async () => {
		const { employeeId } = await fixture.seedEmployee({ organizationId });
		await seedAbsence(employeeId, {
			startDate: "2026-03-16",
			endDate: "2026-03-22",
			status: "approved",
		});
		await seedAbsence(employeeId, {
			startDate: "2026-03-23",
			endDate: "2026-03-29",
			status: "pending",
		});
		expect(await ranges(employeeId)).toEqual(["2026-03-09..2026-03-15", "2026-03-23..2026-03-29"]);
	});

	it("does not expect the final period of a scheduled departure", async () => {
		const { employeeId, employmentPeriodId } = await fixture.seedEmployee({ organizationId });
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, revision, status, created_by, request_id, request_fingerprint)
			 values ($1, $2, $3, 'scheduled', '2026-03-25', 'Europe/Berlin', '2026-03-25T23:00:00Z',
			  1, 'pending', $4, $5, 'fingerprint')`,
			[organizationId, employeeId, employmentPeriodId, fixture.ownerUserId, randomUUID()],
		);
		expect(await ranges(employeeId)).toEqual(["2026-03-09..2026-03-15", "2026-03-16..2026-03-22"]);
	});

	it("expects nothing of a kiosk-only employee", async () => {
		const { employeeId, userId } = await fixture.seedEmployee({ organizationId });
		await fixture.pool.query(`update "user" set email = $1 where id = $2`, [
			`kiosk-${userId.replaceAll("-", "")}@kiosk.invalid`,
			userId,
		]);
		expect(await ranges(employeeId)).toEqual([]);
	});

	it("reads only the employee's own organization", async () => {
		const otherOrganization = await fixture.createOrganization();
		const { employeeId } = await fixture.seedEmployee({ organizationId: otherOrganization });
		// The other organization never switched period submissions on.
		expect(await ranges(employeeId, otherOrganization)).toEqual([]);
		// An employee of another organization is not found through this one.
		expect(await ranges(employeeId)).toEqual([]);
	});
});
