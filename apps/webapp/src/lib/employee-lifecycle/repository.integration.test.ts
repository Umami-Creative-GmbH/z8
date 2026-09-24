/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner owns, migrates, and removes the disposable database.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	createLifecycleDatabaseFixture,
	describeLifecycleDatabase,
	type LifecycleDatabaseFixture,
} from "./testing/database";

const cutoff = new Date("2026-09-15T00:00:00Z");

describeLifecycleDatabase("employee lifecycle persistence constraints", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	function insertDeparture(input: {
		organizationId?: string;
		employeeId?: string;
		employmentPeriodId?: string;
		status?: string;
		requestId?: string;
	}) {
		return fixture.pool.query(
			`insert into employee_departure
			 (id, organization_id, employee_id, employment_period_id, mode, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values (gen_random_uuid(), $1, $2, $3, 'immediate', 'UTC', $4, $5,
			         coalesce($7::uuid, gen_random_uuid()), 'test', 1, $6)`,
			[
				input.organizationId ?? fixture.organizationId,
				input.employeeId ?? fixture.employeeId,
				input.employmentPeriodId ?? fixture.employmentPeriodId,
				cutoff,
				fixture.ownerUserId,
				input.status ?? "canceled",
				input.requestId ?? null,
			],
		);
	}

	it("rejects a departure that points at another tenant's employee", async () => {
		const foreignOrganizationId = await fixture.createOrganization();

		await expect(insertDeparture({ organizationId: foreignOrganizationId })).rejects.toMatchObject({
			code: "23503",
		});
	});

	it("rejects attaching another employee's period in the same tenant", async () => {
		const colleague = await fixture.seedEmployee();

		await expect(
			insertDeparture({ employmentPeriodId: colleague.employmentPeriodId }),
		).rejects.toMatchObject({ code: "23503" });
	});

	it("allows at most one pending departure per employee", async () => {
		const target = await fixture.seedEmployee();
		const pending = {
			employeeId: target.employeeId,
			employmentPeriodId: target.employmentPeriodId,
			status: "pending",
		};
		await insertDeparture(pending);

		await expect(insertDeparture(pending)).rejects.toMatchObject({
			code: "23505",
		});
	});

	it("rejects replaying a request identity as a different departure", async () => {
		const requestId = crypto.randomUUID();
		await insertDeparture({ requestId });

		await expect(insertDeparture({ requestId })).rejects.toMatchObject({
			code: "23505",
		});
	});

	it("allows at most one open employment period per employee", async () => {
		// An unknown start escapes the overlap trigger, so only the index can catch it.
		await expect(
			fixture.pool.query(
				`insert into employee_employment_period
				 (organization_id, employee_id, status, started_at, start_provenance)
				 values ($1, $2, 'open', null, 'unknown')`,
				[fixture.organizationId, fixture.employeeId],
			),
		).rejects.toMatchObject({ code: "23505" });
	});

	it("rejects a closed known-start period that ends before it starts", async () => {
		const target = await fixture.seedEmployee({ withPeriod: false });

		await expect(
			fixture.pool.query(
				`insert into employee_employment_period
				 (organization_id, employee_id, status, started_at, ended_at, start_provenance)
				 values ($1, $2, 'closed', $3, $4, 'recorded')`,
				[fixture.organizationId, target.employeeId, cutoff, new Date("2026-09-14T00:00:00Z")],
			),
		).rejects.toMatchObject({ code: "23514" });
	});

	function insertPeriod(input: {
		employeeId: string;
		status: "open" | "closed" | "legacy_unknown";
		startedAt: string | null;
		endedAt?: string | null;
	}) {
		return fixture.pool.query(
			`insert into employee_employment_period
			 (organization_id, employee_id, status, started_at, ended_at, start_provenance)
			 values ($1, $2, $3, $4::timestamptz, $5::timestamptz,
			         case when $4::timestamptz is null then 'unknown' else 'recorded' end)`,
			[
				fixture.organizationId,
				input.employeeId,
				input.status,
				input.startedAt,
				input.endedAt ?? null,
			],
		);
	}

	it("rejects overlapping known employment intervals for one employee", async () => {
		const target = await fixture.seedEmployee({ withPeriod: false });
		await insertPeriod({
			employeeId: target.employeeId,
			status: "closed",
			startedAt: "2026-01-01T00:00:00Z",
			endedAt: "2026-03-01T00:00:00Z",
		});

		await expect(
			insertPeriod({
				employeeId: target.employeeId,
				status: "open",
				startedAt: "2026-02-01T00:00:00Z",
			}),
		).rejects.toMatchObject({ code: "23P01" });
	});

	it("allows a new period to start exactly at the previous end", async () => {
		const target = await fixture.seedEmployee({ withPeriod: false });
		await insertPeriod({
			employeeId: target.employeeId,
			status: "closed",
			startedAt: "2026-01-01T00:00:00Z",
			endedAt: "2026-03-01T00:00:00Z",
		});

		await expect(
			insertPeriod({
				employeeId: target.employeeId,
				status: "open",
				startedAt: "2026-03-01T00:00:00Z",
			}),
		).resolves.toMatchObject({ rowCount: 1 });
	});

	it("does not assert overlap against legacy periods with unknown bounds", async () => {
		const target = await fixture.seedEmployee({ withPeriod: false });
		await insertPeriod({
			employeeId: target.employeeId,
			status: "legacy_unknown",
			startedAt: null,
		});

		await expect(
			insertPeriod({
				employeeId: target.employeeId,
				status: "open",
				startedAt: "2026-03-01T00:00:00Z",
			}),
		).resolves.toMatchObject({ rowCount: 1 });
	});

	async function insertEvent(
		organizationId: string,
		employeeId: string,
		employmentPeriodId: string,
	) {
		const result = await fixture.pool.query<{ id: string }>(
			`insert into employee_departure_event
			 (organization_id, employee_id, employment_period_id, request_id, kind, actor_user_id)
			 values ($1, $2, $3, gen_random_uuid(), 'departure_scheduled', $4)
			 returning id`,
			[organizationId, employeeId, employmentPeriodId, fixture.ownerUserId],
		);
		return result.rows[0]?.id;
	}

	it("keeps departure audit events append-only", async () => {
		const eventId = await insertEvent(
			fixture.organizationId,
			fixture.employeeId,
			fixture.employmentPeriodId,
		);

		await expect(
			fixture.pool.query(
				`update employee_departure_event set kind = 'departure_canceled' where id = $1`,
				[eventId],
			),
		).rejects.toMatchObject({ code: "55000" });
		await expect(
			fixture.pool.query(`delete from employee_departure_event where id = $1`, [eventId]),
		).rejects.toMatchObject({ code: "55000" });
	});

	it("still lets a deleted tenant cascade through its audit events", async () => {
		const organizationId = await fixture.createOrganization();
		const target = await fixture.seedEmployee({ organizationId });
		await insertEvent(organizationId, target.employeeId, target.employmentPeriodId);

		await fixture.pool.query(`delete from organization where id = $1`, [organizationId]);

		const remaining = await fixture.pool.query(
			`select 1 from employee_departure_event where organization_id = $1`,
			[organizationId],
		);
		expect(remaining.rowCount).toBe(0);
	});

	it("deduplicates follow-up tasks per organization", async () => {
		const dedupeKey = `billing:${crypto.randomUUID()}`;
		const insertTask = () =>
			fixture.pool.query(
				`insert into employee_departure_task
				 (organization_id, employee_id, employment_period_id, kind, dedupe_key)
				 values ($1, $2, $3, 'billing_sync', $4)`,
				[fixture.organizationId, fixture.employeeId, fixture.employmentPeriodId, dedupeKey],
			);
		await insertTask();

		await expect(insertTask()).rejects.toMatchObject({ code: "23505" });
	});
});
