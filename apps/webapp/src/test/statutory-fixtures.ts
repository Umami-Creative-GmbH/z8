/**
 * Seeding for statutory PostgreSQL suites (#1988 and the Milestone 2 monitors #1989–#1994).
 * Every row is prefixed so a suite cleans up only what it created:
 *
 *   const fx = statutoryFixture(integrationAdminPool(), "t1989");
 *   beforeEach(fx.cleanup); afterAll(fx.cleanup);
 *   const org = await fx.organization("a");
 *   const admin = await fx.user("admin");
 *   await fx.membership(org, admin, "admin");
 *   const worker = await fx.employee(org, "worker", { birthday: "2010-05-01" });
 *   const manager = await fx.employee(org, "manager", { role: "manager" }); // scoped manager
 *   await fx.membership(org, manager, "member");
 *
 * Uses raw SQL against the admin pool on purpose: seeding must not depend on the code under test.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface FixtureOrganization {
	readonly id: string;
	readonly timezone: string;
}

export interface FixtureUser {
	readonly userId: string;
}

export interface FixtureEmployee extends FixtureUser {
	readonly employeeId: string;
	readonly organizationId: string;
}

const SEED_INSTANT = new Date("2026-01-01T00:00:00.000Z");

export function statutoryFixture(admin: Pool, prefix: string) {
	const idOf = (key: string) => `${prefix}-${key}`;

	async function user(key: string): Promise<FixtureUser> {
		const userId = idOf(`user-${key}`);
		await admin.query(
			`INSERT INTO "user" (id, name, email, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $4)
			 ON CONFLICT (id) DO NOTHING`,
			[userId, key, `${userId}@example.test`, SEED_INSTANT],
		);
		return { userId };
	}

	return {
		/** Deletes every organization and user this prefix created (cascades to tenant rows). */
		async cleanup() {
			await admin.query(`DELETE FROM organization WHERE id LIKE $1`, [`${prefix}-org-%`]);
			await admin.query(`DELETE FROM "user" WHERE id LIKE $1`, [`${prefix}-user-%`]);
		},

		async organization(key: string, timezone = "Europe/Berlin"): Promise<FixtureOrganization> {
			const id = idOf(`org-${key}`);
			await admin.query(
				`INSERT INTO organization (id, name, slug, timezone, created_at)
				 VALUES ($1, $2, $3, $4, $5)`,
				[id, `Org ${key}`, id, timezone, SEED_INSTANT],
			);
			return { id, timezone };
		},

		user,

		/**
		 * An employee (with its user) in `org`. `role` is the employee role: `manager` or `admin`
		 * makes a scoped manager once the user also has an approved `member` membership.
		 */
		async employee(
			org: FixtureOrganization,
			key: string,
			options: {
				role?: "employee" | "manager" | "admin";
				birthday?: string;
				contractType?: "fixed" | "hourly";
			} = {},
		): Promise<FixtureEmployee> {
			const { userId } = await user(key);
			const {
				rows: [row],
			} = await admin.query<{ id: string }>(
				`INSERT INTO employee (user_id, organization_id, first_name, last_name, role, contract_type, birthday, updated_at)
				 VALUES ($1, $2, $3, 'Test', $4, $5, $6, $7)
				 RETURNING id`,
				[
					userId,
					org.id,
					key,
					options.role ?? "employee",
					options.contractType ?? "fixed",
					options.birthday ? new Date(`${options.birthday}T00:00:00.000Z`) : null,
					SEED_INSTANT,
				],
			);
			return { userId, employeeId: row.id, organizationId: org.id };
		},

		/**
		 * One employment stint of `kind` (spec #1935) from `startedAt` (an ISO instant) until
		 * `endedAt` (null: open), with a recorded start. Seed stints in order and before any terms:
		 * contract changes attach to the open stint. The employee's own engagement kind follows the
		 * open stint, as a rehire leaves it.
		 */
		async stint(
			who: FixtureEmployee,
			kind: "employee" | "contractor",
			startedAt: string,
			endedAt: string | null = null,
		): Promise<string> {
			const {
				rows: [row],
			} = await admin.query<{ id: string }>(
				`INSERT INTO employee_employment_period
				 (organization_id, employee_id, status, started_at, ended_at, start_provenance, engagement_kind)
				 VALUES ($1, $2, $3, $4, $5, 'recorded', $6)
				 RETURNING id`,
				[who.organizationId, who.employeeId, endedAt ? "closed" : "open", startedAt, endedAt, kind],
			);
			if (!endedAt) {
				await admin.query(`UPDATE employee SET engagement_kind = $2 WHERE id = $1`, [
					who.employeeId,
					kind,
				]);
			}
			return row.id;
		},

		/** Ends an open stint at `endedAt` (an ISO instant), as a departure before a conversion does. */
		async endStint(stintId: string, endedAt: string): Promise<void> {
			await admin.query(
				`UPDATE employee_employment_period SET status = 'closed', ended_at = $2 WHERE id = $1`,
				[stintId, endedAt],
			);
		},

		/** An approved membership; `owner`/`admin` are org admins, `member` needs a manager employee to manage. */
		async membership(
			org: FixtureOrganization,
			who: FixtureUser,
			role: "owner" | "admin" | "member",
		): Promise<void> {
			await admin.query(
				`INSERT INTO member (id, organization_id, user_id, role, status, created_at)
				 VALUES ($1, $2, $3, $4, 'approved', $5)`,
				[randomUUID(), org.id, who.userId, role, SEED_INSTANT],
			);
		},
	};
}

export type StatutoryFixture = ReturnType<typeof statutoryFixture>;
