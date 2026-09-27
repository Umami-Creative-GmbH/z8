/**
 * The one way `*.integration.test.ts` suites reach PostgreSQL.
 *
 * The `integration` Vitest project's setup file (`integration-setup.ts`) binds
 * `@/db` to the app pool, verifies the disposable database before the first
 * hook of every suite, and closes every pool after the last one. Suites only
 * import what they use directly: the admin pool for raw seeding and
 * assertions, or a dedicated pool when a test needs its own connections.
 *
 * Only the label-owned database that `pnpm --filter webapp test:integration`
 * (and CI) creates passes the gate.
 */
import { Pool, type PoolConfig } from "pg";
import { configurePostgresUtcTypes, withUtcPostgresSession } from "@/db/postgres-utc";

const integrationDatabaseSentinel = "approval-workflow-repository-test";
const integrationDatabaseName = /^approval_workflow_repository_test_[a-z0-9_]+$/;

export type IntegrationDatabaseConfig = {
	databaseUrl: string;
	databaseName: string;
};

/**
 * Vitest discovers PostgreSQL suites only by the `*.integration.test.ts`
 * suffix. A misnamed suite lands in the `unit` project, where it would never
 * meet a database, so the gate refuses to run there.
 */
function assertNotUnitTestProject() {
	if (process.env.Z8_TEST_PROJECT === "unit") {
		throw new Error(
			"A PostgreSQL database gate was called from the unit test project: database suites must be named `*.integration.test.ts`",
		);
	}
}

/** URL safety shared with the migration verifier script, which runs outside Vitest. */
export function parseIntegrationDatabaseUrl(databaseUrl: string): IntegrationDatabaseConfig {
	let parsed: URL;
	try {
		parsed = new URL(databaseUrl);
	} catch {
		throw new Error("Integration test database URL must be a valid PostgreSQL URL");
	}
	if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
		throw new Error("Integration test database URL must use a PostgreSQL protocol");
	}
	if (parsed.search !== "") {
		throw new Error("Integration test database URL must not include query parameters");
	}
	const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
		throw new Error("Integration test database URL must use a loopback host");
	}

	const databaseName = decodeURIComponent(parsed.pathname.slice(1));
	if (!integrationDatabaseName.test(databaseName)) {
		throw new Error("Refusing to target a non-isolated integration test database");
	}
	return { databaseUrl, databaseName };
}

function resolveIntegrationDatabaseUrl(input: {
	databaseUrl: string | undefined;
	sentinel: string | undefined;
}): IntegrationDatabaseConfig {
	assertNotUnitTestProject();
	if (!input.databaseUrl) {
		throw new Error(
			"Invalid integration database configuration: disposable PostgreSQL URL is missing",
		);
	}
	if (input.sentinel !== integrationDatabaseSentinel) {
		throw new Error(
			"Invalid integration database configuration: disposable PostgreSQL sentinel is missing or invalid",
		);
	}
	return parseIntegrationDatabaseUrl(input.databaseUrl);
}

function environmentConfiguration() {
	return resolveIntegrationDatabaseUrl({
		databaseUrl: process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL,
		sentinel: process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL,
	});
}

/** Checks configuration before connecting, then `current_database()` over the connection. */
export async function verifyIntegrationDatabase(input: {
	databaseUrl: string | undefined;
	sentinel: string | undefined;
	currentDatabase: () => Promise<string>;
}): Promise<IntegrationDatabaseConfig> {
	const { databaseUrl } = resolveIntegrationDatabaseUrl(input);
	const databaseName = await input.currentDatabase();
	if (!integrationDatabaseName.test(databaseName)) {
		throw new Error("current_database() is not a disposable integration test database");
	}
	return { databaseUrl, databaseName };
}

const openedPools: Pool[] = [];
let appPool: Pool | undefined;
let adminPool: Pool | undefined;

/**
 * A pool on the verified database with UTC sessions. Closed after the suite;
 * a test may end it earlier.
 */
export function openIntegrationPool(
	config: Pick<PoolConfig, "max" | "idleTimeoutMillis"> = {},
): Pool {
	const { databaseUrl } = environmentConfiguration();
	configurePostgresUtcTypes();
	const pool = new Pool(withUtcPostgresSession({ ...config, connectionString: databaseUrl }));
	// Crash scenarios terminate backends; the affected query fails, but an idle
	// client's error must not take down the test process.
	pool.on("error", () => {});
	pool.on("connect", (client) => client.on("error", () => {}));
	openedPools.push(pool);
	return pool;
}

/** The pool behind `@/db`, i.e. the connections production code uses. */
function integrationAppPool(): Pool {
	appPool ??= openIntegrationPool({ max: 16 });
	return appPool;
}

/** Raw SQL for seeding, cleanup and assertions, apart from the app's connections. */
export function integrationAdminPool(): Pool {
	adminPool ??= openIntegrationPool({ max: 12 });
	return adminPool;
}

type QueryLogger = (query: string, params: unknown[]) => void;

/** The `@/db` module bound to the app pool. Pass `logQuery` to observe production queries. */
export async function integrationDbModule(options: { logQuery?: QueryLogger } = {}) {
	const pool = integrationAppPool();
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const db = drizzle({
		client: pool,
		schema: { ...authSchema, ...schema },
		...(options.logQuery ? { logger: { logQuery: options.logQuery } } : {}),
	});
	return { ...authSchema, ...schema, db, pool };
}

/** Runs once per suite, before its first hook (see `integration-setup.ts`). */
export async function verifyIntegrationTestDatabase(): Promise<IntegrationDatabaseConfig> {
	const pool = integrationAdminPool();
	return verifyIntegrationDatabase({
		databaseUrl: process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL,
		sentinel: process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL,
		currentDatabase: async () => {
			const result = await pool.query<{ name: string }>("select current_database() as name");
			return result.rows[0]?.name ?? "";
		},
	});
}

/** Runs once per suite, after its last hook (see `integration-setup.ts`). */
export async function closeIntegrationPools(): Promise<void> {
	const pools = openedPools.splice(0);
	appPool = undefined;
	adminPool = undefined;
	await Promise.all(pools.filter((pool) => !pool.ended).map((pool) => pool.end()));
}

export { integrationDatabaseSentinel };
