import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { loadAutoClockOutSettings, saveAutoClockOutSettings } from "./settings";

const clock = { nowInstant: () => parseInstant("2026-10-03T12:00:00Z") };

describe("automatic clock-out settings and durable storage on PostgreSQL", () => {
	let fixture: LifecycleDatabaseFixture;
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture?.close();
	});
	const load = (organizationId: string) =>
		fixture.db.transaction((tx) =>
			loadAutoClockOutSettings(tx, organizationId),
		);
	const save = (organizationId: string, enabled: boolean, minutes: number) =>
		saveAutoClockOutSettings(
			{
				organizationId,
				autoClockOutEnabled: enabled,
				maxUninterruptedMinutes: minutes,
			},
			{ database: fixture.db, clock },
		);

	it("loads enabled twelve-hour defaults for a newly created organization", async () => {
		expect(await load(await fixture.createOrganization())).toEqual({
			autoClockOutEnabled: true,
			maxUninterruptedMinutes: 720,
			revision: 0,
		});
	});

	it("isolates organizations and retains the duration on disable while incrementing revision", async () => {
		const first = await fixture.createOrganization();
		const second = await fixture.createOrganization();
		expect(await save(first, true, 90)).toEqual({
			autoClockOutEnabled: true,
			maxUninterruptedMinutes: 90,
			revision: 1,
		});
		await save(second, true, 180);
		expect(await load(first)).toEqual({
			autoClockOutEnabled: true,
			maxUninterruptedMinutes: 90,
			revision: 1,
		});
		expect(await save(first, false, 90)).toEqual({
			autoClockOutEnabled: false,
			maxUninterruptedMinutes: 90,
			revision: 2,
		});
		expect(await load(second)).toEqual({
			autoClockOutEnabled: true,
			maxUninterruptedMinutes: 180,
			revision: 1,
		});
		const { rows } = await fixture.pool.query(
			"select updated_at from organization_time_tracking_settings where organization_id = $1",
			[first],
		);
		expect(rows[0].updated_at.toISOString()).toBe("2026-10-03T12:00:00.000Z");
	});

	it("serializes concurrent saves without losing revisions", async () => {
		const organizationId = await fixture.createOrganization();
		await Promise.all([
			save(organizationId, true, 60),
			save(organizationId, false, 120),
			save(organizationId, true, 180),
		]);
		expect((await load(organizationId)).revision).toBe(3);
	});

	it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648])(
		"rejects invalid minute limit %s before persisting settings",
		async (minutes) => {
			const organizationId = await fixture.createOrganization();
			await expect(save(organizationId, true, minutes)).rejects.toThrow(
				RangeError,
			);
			expect((await load(organizationId)).revision).toBe(0);
		},
	);

	it("enforces positive limits and revisions even for direct database writes", async () => {
		const organizationId = await fixture.createOrganization();
		await expect(
			fixture.pool.query(
				"insert into organization_time_tracking_settings (organization_id, max_uninterrupted_minutes) values ($1, 0)",
				[organizationId],
			),
		).rejects.toMatchObject({ code: "23514" });
		await expect(
			fixture.pool.query(
				"insert into organization_time_tracking_settings (organization_id, revision) values ($1, 0)",
				[organizationId],
			),
		).rejects.toMatchObject({ code: "23514" });
	});

	async function execution(
		organizationId = fixture.organizationId,
		employeeId = fixture.employeeId,
	) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into automatic_clock_out_execution
		 (id, organization_id, employee_id, work_period_id, start_time, cutoff_time,
		 max_uninterrupted_minutes, settings_revision, timezone, utc_offset_minutes,
		 recipient_user_id, provenance_user_id, clock_out_entry_id, closure_payload, processed_at)
		 values ($1, $2, $3, $4, '2026-10-03T08:00:00Z', '2026-10-03T20:00:00Z',
		 720, 0, 'Europe/Berlin', 120, $5, $5, $6, '{"source":"automatic-clock-out"}', '2026-10-03T20:05:00Z')`,
			[
				id,
				organizationId,
				employeeId,
				randomUUID(),
				fixture.ownerUserId,
				randomUUID(),
			],
		);
		return id;
	}

	it("rejects executions and tasks with mismatched organization or employee ownership", async () => {
		const otherOrg = await fixture.createOrganization();
		await expect(execution(otherOrg)).rejects.toMatchObject({ code: "23503" });
		const operationId = await execution();
		await expect(
			fixture.pool.query(
				`insert into automatic_clock_out_task (organization_id, employee_id, operation_id, kind, dedupe_key, payload)
		 values ($1, $2, $3, 'follow_up', 'wrong-owner', '{}')`,
				[fixture.organizationId, fixture.ownerEmployeeId, operationId],
			),
		).rejects.toMatchObject({ code: "23503" });
		await expect(
			fixture.pool.query(
				`insert into automatic_clock_out_task (organization_id, employee_id, operation_id, kind, dedupe_key, payload)
		 values ($1, $2, $3, 'follow_up', 'wrong-org', '{}')`,
				[otherOrg, fixture.employeeId, operationId],
			),
		).rejects.toMatchObject({ code: "23503" });
	});

	it("deduplicates durable tasks by organization and key and rejects invalid states", async () => {
		const operationId = await execution();
		const values = [
			fixture.organizationId,
			fixture.employeeId,
			operationId,
			`follow-up:${operationId}`,
		];
		const insert = `insert into automatic_clock_out_task (organization_id, employee_id, operation_id, kind, dedupe_key, payload) values ($1, $2, $3, 'follow_up', $4, '{}')`;
		await fixture.pool.query(insert, values);
		await expect(fixture.pool.query(insert, values)).rejects.toMatchObject({
			code: "23505",
		});
		await expect(
			fixture.pool.query(
				"update automatic_clock_out_task set status = 'unknown' where organization_id = $1 and dedupe_key = $2",
				[values[0], values[3]],
			),
		).rejects.toMatchObject({ code: "23514" });
		await expect(
			fixture.pool.query(
				"update automatic_clock_out_task set status = 'processing' where organization_id = $1 and dedupe_key = $2",
				[values[0], values[3]],
			),
		).rejects.toMatchObject({ code: "23514" });
	});

	it("keeps committed execution evidence immutable", async () => {
		const operationId = await execution();
		await expect(
			fixture.pool.query(
				"update automatic_clock_out_execution set closure_payload = '{}' where organization_id = $1 and id = $2",
				[fixture.organizationId, operationId],
			),
		).rejects.toThrow();
	});

	it("restricts scan state to the internal maintenance row", async () => {
		await expect(
			fixture.pool.query(
				"insert into automatic_clock_out_scan_state (id) values ('tenant')",
			),
		).rejects.toMatchObject({ code: "23514" });
		await expect(
			fixture.pool.query(
				"update automatic_clock_out_scan_state set cursor = '{}' where id = 'maintenance'",
			),
		).rejects.toMatchObject({ code: "23514" });
	});
});
