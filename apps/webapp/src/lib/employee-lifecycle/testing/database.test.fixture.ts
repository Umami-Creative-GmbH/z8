/**
 * Employee lifecycle seeding over the integration database module, which owns
 * the gate and the pools (`@/test/integration-database`).
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import { integrationAdminPool, openIntegrationPool } from "@/test/integration-database";

const combinedSchema = { ...authSchema, ...schema };

export type LifecycleTestDatabase = ReturnType<typeof drizzle<typeof combinedSchema>>;

export type OrganizationRole = "owner" | "admin" | "member";

export type SeededEmployee = {
	userId: string;
	memberId: string;
	employeeId: string;
	employmentPeriodId: string;
};

export type SeedEmployeeInput = {
	organizationId?: string;
	role?: OrganizationRole;
	isActive?: boolean;
	withPeriod?: boolean;
	/** Legacy employee dates; start defaults to the fixture creation instant. */
	startDate?: Date | null;
	endDate?: Date | null;
};

export type LifecycleDatabaseFixture = {
	pool: Pool;
	db: LifecycleTestDatabase;
	organizationId: string;
	employeeId: string;
	employmentPeriodId: string;
	ownerUserId: string;
	ownerEmployeeId: string;
	/** Seeds another organization that `close` also removes. */
	createOrganization(): Promise<string>;
	/** Seeds user, approved member, active employee and an open recorded period. */
	seedEmployee(input?: SeedEmployeeInput): Promise<SeededEmployee>;
	/**
	 * A database bound to one backend that a test may terminate with
	 * `pg_terminate_backend(backendPid)` to simulate a process crash.
	 */
	openCrashableConnection(): Promise<CrashableConnection>;
	/** Removes the seeded organizations and users; the module closes the pools. */
	close(): Promise<void>;
};

export type CrashableConnection = {
	db: LifecycleTestDatabase;
	backendPid: number;
	close(): Promise<void>;
};

export async function createLifecycleDatabaseFixture(): Promise<LifecycleDatabaseFixture> {
	const pool = integrationAdminPool();
	const db = drizzle({ client: pool, schema: combinedSchema });
	const organizationIds: string[] = [];
	const userIds: string[] = [];
	const createdAt = new Date("2026-01-01T00:00:00Z");

	async function createOrganization() {
		const id = randomUUID();
		await pool.query(
			`insert into organization (id, name, slug, created_at) values ($1, $2, $3, $4)`,
			[id, `Lifecycle ${id}`, `lifecycle-${id}`, createdAt],
		);
		organizationIds.push(id);
		return id;
	}

	async function seedEmployee(input: SeedEmployeeInput = {}): Promise<SeededEmployee> {
		const targetOrganizationId = input.organizationId ?? organizationId;
		const userId = randomUUID();
		const memberId = randomUUID();
		const employeeId = randomUUID();
		const employmentPeriodId = randomUUID();
		await pool.query(
			`insert into "user" (id, name, email, created_at, updated_at) values ($1, 'Lifecycle', $2, $3, $3)`,
			[userId, `${userId}@lifecycle.test`, createdAt],
		);
		userIds.push(userId);
		await pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 values ($1, $2, $3, $4, 'approved', $5)`,
			[memberId, targetOrganizationId, userId, input.role ?? "member", createdAt],
		);
		await pool.query(
			`insert into employee
			 (id, user_id, organization_id, role, is_active, start_date, end_date, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				employeeId,
				userId,
				targetOrganizationId,
				input.role === "owner" || input.role === "admin" ? "admin" : "employee",
				input.isActive ?? true,
				input.startDate === undefined ? createdAt : input.startDate,
				input.endDate ?? null,
				createdAt,
			],
		);
		if (input.withPeriod !== false) {
			await pool.query(
				`insert into employee_employment_period
				 (id, organization_id, employee_id, status, started_at, start_provenance)
				 values ($1, $2, $3, 'open', $4, 'recorded')`,
				[employmentPeriodId, targetOrganizationId, employeeId, createdAt],
			);
		}
		return { userId, memberId, employeeId, employmentPeriodId };
	}

	const organizationId = await createOrganization();
	const owner = await seedEmployee({ role: "owner" });
	const target = await seedEmployee();

	return {
		pool,
		db,
		organizationId,
		employeeId: target.employeeId,
		employmentPeriodId: target.employmentPeriodId,
		ownerUserId: owner.userId,
		ownerEmployeeId: owner.employeeId,
		createOrganization,
		seedEmployee,
		async openCrashableConnection() {
			const crashable = openIntegrationPool({ max: 1, idleTimeoutMillis: 0 });
			const result = await crashable.query<{ pid: number }>("select pg_backend_pid() as pid");
			return {
				db: drizzle({ client: crashable, schema: combinedSchema }),
				backendPid: result.rows[0]?.pid ?? 0,
				close: () => crashable.end(),
			};
		},
		async close() {
			// Deleting a tenant cascades to its lifecycle rows; append-only
			// events permit deletion only once their organization is gone.
			await pool.query("delete from organization where id = any($1::text[])", [organizationIds]);
			await pool.query(`delete from "user" where id = any($1::text[])`, [userIds]);
		},
	};
}
