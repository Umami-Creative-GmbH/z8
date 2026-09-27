/**
 * Global setup for the `integration` vitest project. The project fails closed:
 * without the disposable PostgreSQL database that
 * `pnpm --filter webapp test:approval-workflow-repository:integration` (or CI)
 * creates and migrates, no suite runs and the run fails instead of skipping.
 */
import { Pool } from "pg";
import { verifyApprovalWorkflowRepositoryTestDatabase } from "../lib/approvals/workflow/repository-integration-harness";

type IntegrationEnvironment = Record<string, string | undefined>;

export async function requirePostgresIntegrationDatabase(
	environment: IntegrationEnvironment,
	currentDatabase: (databaseUrl: string) => Promise<string>,
) {
	const databaseUrl = environment.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
	try {
		const guard = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: true,
			sentinel: environment.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL,
			currentDatabase: () => currentDatabase(databaseUrl ?? ""),
		});
		if (guard.status !== "enabled") throw new Error(guard.reason);
		return guard;
	} catch (error) {
		throw new Error(
			"The PostgreSQL integration project needs its disposable database. Run " +
				"`pnpm --filter webapp test:approval-workflow-repository:integration`.",
			{ cause: error },
		);
	}
}

async function queryCurrentDatabase(databaseUrl: string) {
	const pool = new Pool({ connectionString: databaseUrl, max: 1 });
	try {
		const result = await pool.query<{ name: string }>("select current_database() as name");
		return result.rows[0]?.name ?? "";
	} finally {
		await pool.end();
	}
}

export default async function setup() {
	await requirePostgresIntegrationDatabase(process.env, queryCurrentDatabase);
}
