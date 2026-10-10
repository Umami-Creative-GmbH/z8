/**
 * #1063: the batched expected-period reader agrees with the per-employee reader (#1057).
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { loadExpectedSubmissionPeriods } from "./employee-expected-periods";
import { loadExpectedSubmissionPeriodsByEmployee } from "./organization-expected-periods";
import { savePeriodSubmissionSettings } from "./settings";

const window = { from: parsePlainDate("2026-03-09"), to: parsePlainDate("2026-03-29") };

describe("expected submission periods of several employees read from PostgreSQL", () => {
	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		organizationId = await fixture.createOrganization();
		await fixture.pool.query(`update organization set timezone = 'Europe/Berlin' where id = $1`, [
			organizationId,
		]);
		await savePeriodSubmissionSettings(
			{
				organizationId,
				actorUserId: fixture.ownerUserId,
				cadence: { kind: "weekly", weekStartDay: "monday" },
				secondReminderDelayDays: 3,
			},
			{ database: fixture.db, clock: { nowInstant: () => parseInstant("2026-03-04T10:00:00Z") } },
		);
	}, 60_000);

	afterAll(async () => {
		await fixture?.close();
	});

	it("matches the per-employee reader for each employee, leaving out other organizations", async () => {
		const plain = await fixture.seedEmployee({ organizationId });
		const away = await fixture.seedEmployee({ organizationId });
		const categoryId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category (id, organization_id, type, name, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', now())`,
			[categoryId, organizationId],
		);
		await fixture.pool.query(
			`insert into absence_entry (employee_id, category_id, start_date, end_date, status, organization_id, updated_at)
			 values ($1, $2, '2026-03-16', '2026-03-22', 'approved', $3, now())`,
			[away.employeeId, categoryId, organizationId],
		);
		const leaving = await fixture.seedEmployee({ organizationId });
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, revision, status, created_by, request_id, request_fingerprint)
			 values ($1, $2, $3, 'scheduled', '2026-03-25', 'Europe/Berlin', '2026-03-25T23:00:00Z',
			  1, 'pending', $4, $5, 'fingerprint')`,
			[
				organizationId,
				leaving.employeeId,
				leaving.employmentPeriodId,
				fixture.ownerUserId,
				randomUUID(),
			],
		);
		const kiosk = await fixture.seedEmployee({ organizationId });
		await fixture.pool.query(`update "user" set email = $1 where id = $2`, [
			`kiosk-${kiosk.userId.replaceAll("-", "")}@kiosk.invalid`,
			kiosk.userId,
		]);
		const stranger = await fixture.seedEmployee({
			organizationId: await fixture.createOrganization(),
		});

		const people = [plain, away, leaving, kiosk];
		const batched = await loadExpectedSubmissionPeriodsByEmployee(fixture.db, {
			organizationId,
			employeeIds: [...people.map((person) => person.employeeId), stranger.employeeId],
			window,
		});
		const ranges = (periods: { startDate: unknown; endDate: unknown }[] | undefined) =>
			periods?.map((period) => `${period.startDate}..${period.endDate}`);

		expect([...batched.keys()].toSorted()).toEqual(
			people.map((person) => person.employeeId).toSorted(),
		);
		for (const person of people) {
			const single = await loadExpectedSubmissionPeriods(fixture.db, {
				organizationId,
				employeeId: person.employeeId,
				window,
			});
			expect(ranges(batched.get(person.employeeId))).toEqual(ranges(single));
		}
		expect(ranges(batched.get(away.employeeId))).toEqual([
			"2026-03-09..2026-03-15",
			"2026-03-23..2026-03-29",
		]);
		expect(ranges(batched.get(leaving.employeeId))).toEqual([
			"2026-03-09..2026-03-15",
			"2026-03-16..2026-03-22",
		]);
		expect(ranges(batched.get(kiosk.employeeId))).toEqual([]);
	});
});
