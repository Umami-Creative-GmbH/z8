import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, pool, user } from "../index";
import {
	assertNoUnitProjectDatabaseRefusals,
	isUnitTestProject,
	UNIT_PROJECT_DATABASE_REFUSAL,
} from "../unit-project-guard";

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: vi.fn() }),
}));

function errorChain(error: unknown): string[] {
	const messages: string[] = [];
	for (let current = error; current instanceof Error; current = current.cause) {
		messages.push(current.message);
	}
	return messages;
}

async function refusal(operation: () => Promise<unknown>): Promise<string[]> {
	const error = await operation().then(
		() => expect.unreachable("the unit project reached PostgreSQL"),
		(rejection: unknown) => rejection,
	);
	return errorChain(error);
}

function expectRefusedAttempts(count: number) {
	expect(assertNoUnitProjectDatabaseRefusals).toThrow(
		`${UNIT_PROJECT_DATABASE_REFUSAL} (${count} connection attempt(s) refused)`,
	);
}

describe("real @/db pool in the unit test project", () => {
	afterEach(() => vi.restoreAllMocks());

	it("runs under the unit project", () => {
		expect(isUnitTestProject()).toBe(true);
	});

	it("refuses pool.query without opening a PostgreSQL connection", async () => {
		const driverConnect = vi.spyOn(Client.prototype, "connect");

		expect(await refusal(() => pool.query("select 1"))).toContain(UNIT_PROJECT_DATABASE_REFUSAL);

		expect(driverConnect).not.toHaveBeenCalled();
		expectRefusedAttempts(1);
	});

	it("refuses pool.connect, which drizzle transactions check out", async () => {
		const driverConnect = vi.spyOn(Client.prototype, "connect");

		expect(await refusal(() => pool.connect())).toContain(UNIT_PROJECT_DATABASE_REFUSAL);

		expect(driverConnect).not.toHaveBeenCalled();
		expectRefusedAttempts(1);
	});

	it("refuses drizzle reads and transactions", async () => {
		expect(await refusal(() => db.select().from(user).limit(1))).toContain(
			UNIT_PROJECT_DATABASE_REFUSAL,
		);
		expect(await refusal(() => db.transaction(async () => undefined))).toContain(
			UNIT_PROJECT_DATABASE_REFUSAL,
		);

		expectRefusedAttempts(2);
	});

	it("still reports a refusal that the code under test swallowed", async () => {
		const swallowed = await pool.query("select 1").then(
			() => "connected",
			() => "swallowed",
		);

		expect(swallowed).toBe("swallowed");
		expectRefusedAttempts(1);
		// The assertion forgot the refusal, so the setup file's afterEach passes.
		expect(assertNoUnitProjectDatabaseRefusals).not.toThrow();
	});

	it("leaves schema-only imports untouched", () => {
		expect(user).toBeDefined();
		expect(assertNoUnitProjectDatabaseRefusals).not.toThrow();
	});
});
