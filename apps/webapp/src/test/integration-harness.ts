/**
 * Shared harness for the `integration` vitest project (every
 * `*.integration.test.ts` except the Redis suite). It owns the database pool
 * and the standard infrastructure fakes, so a suite replaces only what its own
 * contract needs.
 *
 * Each export is a `vi.mock` module factory. `vi.mock` is hoisted above the
 * suite's imports, so a suite reaches the harness through a dynamic import:
 *
 *   vi.mock("@/db", async () => (await import("@/test/integration-harness")).database());
 *   vi.mock("next/cache", async (importOriginal) =>
 *   	(await import("@/test/integration-harness")).nextCache(importOriginal),
 *   );
 */
import { vi } from "vitest";

type ImportOriginal = <T>() => Promise<T>;

/** The disposable database URL; the project's global setup has already verified it. */
export function integrationDatabaseUrl(): string {
	const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
	if (!databaseUrl) {
		throw new Error(
			"APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL is missing. Run " +
				"`pnpm --filter webapp test:approval-workflow-repository:integration`.",
		);
	}
	return databaseUrl;
}

/** `@/db` bound to one UTC pool on the disposable database. */
export async function database(options: { max?: number } = {}) {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import("@/db/postgres-utc");
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({ connectionString: integrationDatabaseUrl(), max: options.max }),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
}

/** `connection()` throws outside a Next request scope. */
export async function nextServer(importOriginal: ImportOriginal) {
	return {
		...(await importOriginal<typeof import("next/server")>()),
		connection: async () => {},
	};
}

export function nextHeaders() {
	return { headers: async () => new Headers() };
}

export async function nextCache(importOriginal: ImportOriginal) {
	return {
		...(await importOriginal<typeof import("next/cache")>()),
		revalidatePath: vi.fn(),
		revalidateTag: vi.fn(),
	};
}

/** Billing always admits the mutation. Pass `importOriginal` to keep the other exports. */
export async function billingGuard(importOriginal?: ImportOriginal) {
	return {
		...(importOriginal ? await importOriginal<typeof import("@/lib/billing/guard")>() : {}),
		requireBillingForMutation: async () => ({ canAccess: true }),
		isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
	};
}

/** Silences every notification trigger, or only the named ones. */
export async function notificationTriggers(
	importOriginal: ImportOriginal,
	only?: readonly string[],
) {
	const original = await importOriginal<Record<string, unknown>>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" && (!only || only.includes(name)) ? async () => undefined : value,
		]),
	);
}

/** The best-effort fast path only runs the owner sooner; suites run it explicitly. */
export function deliveryKick(kicks?: { organizationId: string; workflowId?: string | null }[]) {
	return {
		kickApprovalDelivery: (input: { organizationId: string; workflowId?: string | null }) => {
			kicks?.push(input);
		},
	};
}

export async function vault(
	importOriginal: ImportOriginal,
	getOrgSecret: (organizationId: string, key: string) => Promise<string | null>,
) {
	return { ...(await importOriginal<typeof import("@/lib/vault")>()), getOrgSecret };
}

export async function calendarSyncQueue(importOriginal: ImportOriginal) {
	return {
		...(await importOriginal<typeof import("@/lib/queue")>()),
		addCalendarSyncJob: async () => undefined,
	};
}

export function emailService() {
	return { sendEmail: async () => ({ success: true }) };
}

export async function absenceEmailRender(importOriginal: ImportOriginal) {
	return {
		...(await importOriginal<typeof import("@/lib/email/render")>()),
		renderAbsenceRequestSubmitted: async () => "<p>submitted</p>",
		renderAbsenceRequestPendingApproval: async () => "<p>pending</p>",
		renderAbsenceRequestApproved: async () => "<p>approved</p>",
		renderAbsenceRequestRejected: async () => "<p>rejected</p>",
	};
}
