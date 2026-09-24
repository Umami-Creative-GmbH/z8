/**
 * Guarded PostgreSQL fixture for employee lifecycle integration tests.
 * Only targets the label-owned disposable database created by
 * `pnpm --filter webapp test:approval-workflow-repository:integration`.
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, it } from "vitest";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const sentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const required = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";

/** `describe` when the disposable database is configured, otherwise a visible skip. */
export function describeLifecycleDatabase(name: string, body: () => void) {
	const configuration = resolveApprovalWorkflowRepositoryTestConfiguration({
		databaseUrl,
		required,
		sentinel,
	});
	if (configuration.status === "error") {
		throw new Error(`Invalid lifecycle integration configuration: ${configuration.reason}`);
	}
	if (configuration.status === "unavailable") {
		describe.skip(`${name} (PostgreSQL unavailable: ${configuration.reason})`, () => {
			it("requires the label-owned disposable PostgreSQL runner", () => {});
		});
		return;
	}
	describe(name, body);
}

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
	close(): Promise<void>;
};

export async function createLifecycleDatabaseFixture(): Promise<LifecycleDatabaseFixture> {
	const pool = new Pool({ connectionString: databaseUrl, max: 8 });
	const guard = await verifyApprovalWorkflowRepositoryTestDatabase({
		databaseUrl,
		required,
		sentinel,
		currentDatabase: async () => {
			const result = await pool.query<{ name: string }>("select current_database() as name");
			return result.rows[0]?.name ?? "";
		},
	});
	if (guard.status !== "enabled") {
		await pool.end();
		throw new Error("Lifecycle integration database is not enabled");
	}

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
		async close() {
			try {
				// Deleting a tenant cascades to its lifecycle rows; append-only
				// events permit deletion only once their organization is gone.
				await pool.query("delete from organization where id = any($1::text[])", [
					organizationIds,
				]);
				await pool.query(`delete from "user" where id = any($1::text[])`, [userIds]);
			} finally {
				await pool.end();
			}
		},
	};
}
