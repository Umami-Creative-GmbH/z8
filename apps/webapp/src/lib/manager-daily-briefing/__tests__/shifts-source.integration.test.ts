/**
 * PostgreSQL contract (#918): `shift.date` stores the organization-local
 * midnight of the shift's calendar date, so the briefing reads published
 * shifts by the organization's calendar day. It used to match UTC midnight,
 * which found no shifts for any organization outside UTC.
 */
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	getManagerDailyBriefingFromSources,
	managerDailyBriefingDatabaseSources,
} from "../get-manager-daily-briefing";

const DAY = "2026-04-28";

describe("manager daily briefing published shifts source", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function organization(timezone: string) {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query("update organization set timezone = $2 where id = $1", [
			organizationId,
			timezone,
		]);
		const creator = await fixture.seedEmployee({ organizationId, role: "owner" });
		const locationId = randomUUID();
		const subareaId = randomUUID();
		await fixture.pool.query(
			`insert into location (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'Store', $3, now())`,
			[locationId, organizationId, creator.userId],
		);
		await fixture.pool.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at)
			 values ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, creator.userId],
		);
		return { organizationId, timezone, subareaId, creator };
	}
	type Org = Awaited<ReturnType<typeof organization>>;

	/** Inserts a shift the way `upsertShift` stores it: at the organization-local midnight. */
	async function shift(
		org: Org,
		person: SeededEmployee,
		storedDate: string,
		options: { status?: "draft" | "published" } = {},
	) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into shift
			 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, '08:00', '16:00', $6, $7, now())`,
			[
				id,
				org.organizationId,
				person.employeeId,
				org.subareaId,
				new Date(storedDate),
				options.status ?? "published",
				org.creator.userId,
			],
		);
		return id;
	}

	const publishedShifts = (org: Org, people: SeededEmployee[], date = DAY) =>
		managerDailyBriefingDatabaseSources.getPublishedShifts({
			organizationId: org.organizationId,
			employeeIds: people.map((person) => person.employeeId),
			date,
			timezone: org.timezone,
		});

	it.each([
		{
			timezone: "Europe/Berlin",
			previous: "2026-04-26T22:00:00Z",
			today: "2026-04-27T22:00:00Z",
			next: "2026-04-28T22:00:00Z",
		},
		{
			timezone: "America/New_York",
			previous: "2026-04-27T04:00:00Z",
			today: "2026-04-28T04:00:00Z",
			next: "2026-04-29T04:00:00Z",
		},
		{
			timezone: "UTC",
			previous: "2026-04-27T00:00:00Z",
			today: "2026-04-28T00:00:00Z",
			next: "2026-04-29T00:00:00Z",
		},
	])(
		"returns only the $timezone organization's published shifts of its calendar day",
		async ({ timezone, previous, today, next }) => {
			const org = await organization(timezone);
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			const todayShiftId = await shift(org, person, today);
			await shift(org, person, today, { status: "draft" });
			await shift(org, person, previous);
			await shift(org, person, next);

			const shifts = await publishedShifts(org, [person]);

			expect(shifts).toEqual([
				expect.objectContaining({
					id: todayShiftId,
					employeeId: person.employeeId,
					date: DAY,
					startTime: "08:00",
					endTime: "16:00",
					status: "published",
					subareaId: org.subareaId,
					subareaName: "Floor",
				}),
			]);
		},
	);

	it("never returns another organization's shifts", async () => {
		const org = await organization("Europe/Berlin");
		const foreign = await organization("Europe/Berlin");
		const person = await fixture.seedEmployee({ organizationId: org.organizationId });
		const foreignPerson = await fixture.seedEmployee({ organizationId: foreign.organizationId });
		await shift(foreign, foreignPerson, "2026-04-27T22:00:00Z");

		expect(await publishedShifts(org, [person, foreignPerson])).toEqual([]);
	});

	it.each([
		{ timezone: "Europe/Berlin", stored: "2026-04-27T22:00:00Z", now: "2026-04-28T07:00:00Z" },
		{ timezone: "America/New_York", stored: "2026-04-28T04:00:00Z", now: "2026-04-28T13:00:00Z" },
	])(
		"lists a managed employee who has not clocked in for today's $timezone shift",
		async ({ timezone, stored, now }) => {
			const org = await organization(timezone);
			const manager = await fixture.seedEmployee({ organizationId: org.organizationId });
			await fixture.pool.query("update employee set role = 'manager' where id = $1", [
				manager.employeeId,
			]);
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			await fixture.pool.query(
				`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
				[person.employeeId, manager.employeeId, org.creator.userId],
			);
			const shiftId = await shift(org, person, stored);

			const briefing = await getManagerDailyBriefingFromSources({
				organizationId: org.organizationId,
				currentEmployee: { id: manager.employeeId, role: "manager" },
				now: DateTime.fromISO(now, { setZone: true }),
				timezone,
				// Approvals load every approval handler; they are covered by approvals-source.
				sources: { ...managerDailyBriefingDatabaseSources, getApprovals: async () => [] },
			});

			expect(briefing.date).toBe(DAY);
			expect(briefing.sections.attendance.items).toEqual([
				expect.objectContaining({ id: `attendance:${shiftId}`, severity: "critical" }),
			]);
		},
	);
});
