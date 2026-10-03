import { Client, type PoolConfig } from "pg";

// Suites that need PostgreSQL are discovered by the `*.integration.test.ts`
// suffix. A misnamed one lands in the unit project, where `@/db` is this real
// module. There, the pool's clients refuse to connect, so neither `pool.query`
// nor `pool.connect` (drizzle transactions) can reach whatever POSTGRES_*
// names. The unit project's setup file fails the test that caused a refusal,
// even when production code caught the error.
//
// The variable is read from process.env, not from "@/env", on purpose: a
// suite that mocks "@/env" must not be able to switch the guard off.
const UNIT_TEST_PROJECT = "unit";
const REFUSALS = Symbol.for("z8.unitProjectDatabaseRefusals");

type RefusalStore = { [REFUSALS]?: Error[] };
type ConnectCallback = (err: Error) => void;

export const UNIT_PROJECT_DATABASE_REFUSAL =
	"PostgreSQL is not available in the unit test project: this suite reached the real @/db pool. " +
	"Name a suite that needs the database *.integration.test.ts, or mock @/db or the code that queries it.";

export function isUnitTestProject(): boolean {
	return process.env.Z8_TEST_PROJECT === UNIT_TEST_PROJECT;
}

function refusals(): Error[] {
	const store = globalThis as RefusalStore;
	store[REFUSALS] ??= [];
	return store[REFUSALS];
}

/** Throws when a connection was refused since the last call, then forgets the refusals. */
export function assertNoUnitProjectDatabaseRefusals(): void {
	const refused = refusals().splice(0);
	if (refused.length === 0) return;

	throw new Error(
		`${UNIT_PROJECT_DATABASE_REFUSAL} (${refused.length} connection attempt(s) refused)`,
		{
			cause: refused[0],
		},
	);
}

class UnitProjectRefusedClient extends Client {
	override connect(): Promise<Client>;
	override connect(callback: ConnectCallback): void;
	override connect(callback?: ConnectCallback): Promise<Client> | undefined {
		const error = new Error(UNIT_PROJECT_DATABASE_REFUSAL);
		refusals().push(error);
		if (!callback) return Promise.reject(error);
		process.nextTick(callback, error);
		return undefined;
	}
}

/** Makes every client of the pool refuse to connect when running under the unit test project. */
export function refuseConnectionsInUnitTestProject(config: PoolConfig): PoolConfig {
	return isUnitTestProject() ? { ...config, Client: UnitProjectRefusedClient } : config;
}
