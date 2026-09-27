/**
 * Setup file of the `integration` Vitest project: every `*.integration.test.ts`
 * suite gets `@/db` bound to the disposable database, the database verified
 * before its first hook, and its pools closed after its last hook.
 */
import { afterAll, beforeAll, vi } from "vitest";
import { closeIntegrationPools, verifySuiteDatabase } from "./integration-database";

vi.mock("@/db", async () => (await import("./integration-database")).integrationDbModule());

beforeAll(async () => {
	await verifySuiteDatabase();
});

afterAll(closeIntegrationPools);
