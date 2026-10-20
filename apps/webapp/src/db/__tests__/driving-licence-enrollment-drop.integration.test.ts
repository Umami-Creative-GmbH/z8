/**
 * #1424 (spec #1418, Organization ADR 0005): intended-driver assignments replaced the old
 * enrollment table, so a migration after the #1423 data copy drops it. Asserts the migrated
 * chain, then reruns both migration files against a stand-in enrollment table in a scratch
 * schema, as on a database that still has enrollments: the copy keeps who added each
 * enrollment and when, the drop removes the table, and both run again cleanly.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { integrationAdminPool } from "@/test/integration-database";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const SCHEMA = "t1424_migration";
const ENROLLMENTS = "driving_licence_participant";
const admin = integrationAdminPool();

function migration(suffix: string) {
	const directory = join(process.cwd(), "drizzle");
	const file = readdirSync(directory).find((name) => name.endsWith(suffix));
	if (!file) throw new Error(`migration *${suffix} missing`);
	return readFileSync(join(directory, file), "utf8").split("--> statement-breakpoint");
}
const copyEnrollments = migration("_driving_licence_intended_driver_assignments.sql");
const dropEnrollments = migration("_drop_driving_licence_enrollments.sql");

async function existingRelation(schema: string, name: string) {
	const result = await admin.query<{ relation: string | null }>(
		`select to_regclass($1)::text as relation`,
		[`${schema}.${name}`],
	);
	return result.rows[0]?.relation ?? null;
}

let fixture: LifecycleDatabaseFixture;
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
});
afterEach(async () => {
	await admin.query(`drop schema if exists ${SCHEMA} cascade`);
	await fixture?.close();
});

describe("dropping driving licence enrollments", () => {
	it("leaves no enrollment table after the chain, and keeps the assignments", async () => {
		expect(await existingRelation("public", ENROLLMENTS)).toBeNull();
		expect(await existingRelation("public", "driving_licence_intended_driver_assignment")).toBe(
			"driving_licence_intended_driver_assignment",
		);
	});

	it("copies enrollments into assignments, then drops the table, and reruns cleanly", async () => {
		const alex = await fixture.seedEmployee();
		const enrolledAt = new Date("2026-01-15T08:30:00.123Z");
		const client = await admin.connect();
		try {
			await client.query(`drop schema if exists ${SCHEMA} cascade`);
			await client.query(`create schema ${SCHEMA}`);
			// The scratch schema comes first, so both migrations create, copy and drop there,
			// while the enum and the referenced tables resolve to public.
			await client.query(`set search_path to ${SCHEMA}, public`);
			// Stand-in with 0244's columns and key.
			await client.query(`
				create table ${ENROLLMENTS} (
					id uuid primary key default gen_random_uuid(),
					organization_id text not null,
					employee_id uuid not null,
					enrolled_at timestamptz not null,
					enrolled_by text not null,
					unique (organization_id, employee_id))
			`);
			await client.query(
				`insert into ${ENROLLMENTS} (organization_id, employee_id, enrolled_at, enrolled_by)
				 values ($1, $2, $3, $4)`,
				[fixture.organizationId, alex.employeeId, enrolledAt, fixture.ownerUserId],
			);

			for (const run of [copyEnrollments, copyEnrollments, dropEnrollments, dropEnrollments])
				for (const statement of run) await client.query(statement);

			expect(await existingRelation(SCHEMA, ENROLLMENTS)).toBeNull();
			const assignments = await client.query<{
				assignment_type: string;
				employee_id: string;
				team_id: string | null;
				required: boolean;
				created_at: Date;
				created_by: string;
				updated_by: string;
			}>(
				`select assignment_type, employee_id, team_id, required, created_at, created_by, updated_by
				 from ${SCHEMA}.driving_licence_intended_driver_assignment where organization_id = $1`,
				[fixture.organizationId],
			);
			expect(assignments.rows).toEqual([
				{
					assignment_type: "employee",
					employee_id: alex.employeeId,
					team_id: null,
					required: true,
					created_at: enrolledAt,
					created_by: fixture.ownerUserId,
					updated_by: fixture.ownerUserId,
				},
			]);
		} finally {
			await client.query(`set search_path to default`).catch(() => undefined);
			client.release();
		}
	});
});
