import type { DBAdapter } from "@better-auth/core/db/adapter";
import type { BetterAuthOptions } from "better-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	events: [] as string[],
	acquireUsers: vi.fn(),
	protect: vi.fn(),
}));

vi.mock("@/lib/time-tracking/work-transaction", () => ({
	acquireExclusiveUserConfigurationAccessGuards: mocks.acquireUsers,
}));
vi.mock("@/lib/authorization/authorization-mutation", () => ({
	protectAuthorizationMutation: mocks.protect,
}));

const { captureAuthTransactions, UncoordinatedAuthMutationError } = await import(
	"@/lib/auth/auth-transaction"
);
const { guardSCIMSubjectAcquisitions, protectSCIMProjectedUser, SCIMProjectionGuardOrderError } =
	await import("./projection-guards");

type Row = Record<string, unknown>;

/**
 * A Better Auth adapter factory whose transactions run on a captured fake
 * drizzle transaction, like `drizzleAdapter(captureAuthTransactions(db))`.
 */
function adapterFactory() {
	const database = captureAuthTransactions({
		async transaction<T>(callback: (tx: object) => Promise<T>) {
			return callback({ marker: `tx-${Math.random()}` });
		},
	});
	const rows = new Map<string, Row>();
	function adapter(): DBAdapter<BetterAuthOptions> {
		return {
			id: "fake",
			async create({ model, data }: { model: string; data: Row }) {
				mocks.events.push(`create:${model}:${String(data.userId)}`);
				const row = { id: `${model}-${String(data.userId)}`, ...data };
				rows.set(row.id, row);
				return row;
			},
			async incrementOne({ model, where }: { model: string; where: { value: unknown }[] }) {
				const row = rows.get(String(where[0]?.value));
				mocks.events.push(`increment:${model}:${String(row?.userId ?? null)}`);
				return row ?? null;
			},
			async findOne() {
				return null;
			},
			async transaction<R>(callback: (trx: never) => Promise<R>) {
				return database.transaction(() => callback(adapter() as never));
			},
		} as unknown as DBAdapter<BetterAuthOptions>;
	}
	return { factory: (_options: BetterAuthOptions) => adapter(), rows };
}

const subject = (userId: string) => ({ id: `scimSubject-${userId}`, userId, revision: 1 });

function seedSubjects(setup: ReturnType<typeof adapterFactory>, ...userIds: string[]) {
	for (const userId of userIds) setup.rows.set(`scimSubject-${userId}`, subject(userId));
}

const bump = (trx: DBAdapter<BetterAuthOptions>, userId: string) =>
	trx.incrementOne({
		model: "scimSubject",
		where: [
			{ field: "id", value: `scimSubject-${userId}` },
			{ field: "revision", value: 1 },
		],
		increment: { revision: 1 },
	});

beforeEach(() => {
	mocks.events.length = 0;
	mocks.acquireUsers.mockReset();
	mocks.acquireUsers.mockImplementation(async (_transaction: object, userIds: string[]) => {
		mocks.events.push(`guard:${userIds.join(",")}`);
	});
	mocks.protect.mockReset();
	mocks.protect.mockImplementation(async (_transaction: object, scope: { userIds: string[] }) => {
		mocks.events.push(`protect:${scope.userIds.join(",")}`);
	});
});

describe("guardSCIMSubjectAcquisitions", () => {
	it("takes each user's exclusive guard right after the plugin locks the user's subject", async () => {
		const setup = adapterFactory();
		seedSubjects(setup, "user-a", "user-b");
		const adapter = guardSCIMSubjectAcquisitions(setup.factory)({} as BetterAuthOptions);

		await adapter.transaction(async (trx) => {
			await bump(trx, "user-a");
			await bump(trx, "user-b");
		});

		expect(mocks.events).toEqual([
			"increment:scimSubject:user-a",
			"guard:user-a",
			"increment:scimSubject:user-b",
			"guard:user-b",
		]);
	});

	it("guards a subject the plugin creates, once per user and transaction", async () => {
		const setup = adapterFactory();
		const adapter = guardSCIMSubjectAcquisitions(setup.factory)({} as BetterAuthOptions);

		await adapter.transaction(async (trx) => {
			await trx.create({ model: "scimSubject", data: { userId: "user-a", revision: 1 } });
			await bump(trx, "user-a");
		});

		expect(mocks.events).toEqual([
			"create:scimSubject:user-a",
			"guard:user-a",
			"increment:scimSubject:user-a",
		]);
	});

	it("ignores other models and subjects whose revision changed concurrently", async () => {
		const setup = adapterFactory();
		const adapter = guardSCIMSubjectAcquisitions(setup.factory)({} as BetterAuthOptions);

		await adapter.transaction(async (trx) => {
			await trx.create({ model: "scimUser", data: { userId: "user-a" } });
			await expect(bump(trx, "user-missing")).resolves.toBeNull();
		});

		expect(mocks.acquireUsers).not.toHaveBeenCalled();
	});

	it("refuses to lock a subject below a user it already guards, taking no guard", async () => {
		const setup = adapterFactory();
		seedSubjects(setup, "user-a", "user-b");
		const adapter = guardSCIMSubjectAcquisitions(setup.factory)({} as BetterAuthOptions);

		await expect(
			adapter.transaction(async (trx) => {
				await bump(trx, "user-b");
				await bump(trx, "user-a");
			}),
		).rejects.toBeInstanceOf(SCIMProjectionGuardOrderError);

		expect(mocks.events).toEqual([
			"increment:scimSubject:user-b",
			"guard:user-b",
			"increment:scimSubject:user-a",
		]);
	});

	it("starts every transaction with no guarded users", async () => {
		const setup = adapterFactory();
		seedSubjects(setup, "user-a", "user-b");
		const adapter = guardSCIMSubjectAcquisitions(setup.factory)({} as BetterAuthOptions);

		await adapter.transaction((trx) => bump(trx, "user-b"));
		await adapter.transaction((trx) => bump(trx, "user-a"));

		expect(mocks.acquireUsers).toHaveBeenCalledTimes(2);
	});

	it("fails closed when a subject is locked outside a captured transaction", async () => {
		const setup = adapterFactory();
		seedSubjects(setup, "user-a");
		const adapter = guardSCIMSubjectAcquisitions(setup.factory)({} as BetterAuthOptions);

		await expect(bump(adapter, "user-a")).rejects.toBeInstanceOf(UncoordinatedAuthMutationError);
		expect(mocks.acquireUsers).not.toHaveBeenCalled();
	});
});

describe("protectSCIMProjectedUser", () => {
	const organizationId = "org-1";

	it("re-takes the guard of a user locked in sorted order", async () => {
		const setup = adapterFactory();
		seedSubjects(setup, "user-a", "user-b");
		const adapter = guardSCIMSubjectAcquisitions(setup.factory)({} as BetterAuthOptions);
		const { requireAuthTransaction } = await import("@/lib/auth/auth-transaction");

		await adapter.transaction(async (trx) => {
			await bump(trx, "user-a");
			await bump(trx, "user-b");
			const transaction = requireAuthTransaction("test");
			await protectSCIMProjectedUser(transaction, { organizationId, userId: "user-b" });
			await protectSCIMProjectedUser(transaction, { organizationId, userId: "user-a" });
		});

		expect(mocks.protect.mock.calls.map(([, scope]) => scope)).toEqual([
			{ organizationId, userIds: ["user-b"] },
			{ organizationId, userIds: ["user-a"] },
		]);
	});

	it("guards the only user of a transaction that locked no subject", async () => {
		const transaction = { marker: "single-user" };

		await protectSCIMProjectedUser(transaction as never, { organizationId, userId: "user-a" });
		await protectSCIMProjectedUser(transaction as never, { organizationId, userId: "user-a" });

		expect(mocks.protect).toHaveBeenCalledTimes(2);
	});

	it("fails closed on a late user instead of guarding it out of order", async () => {
		const setup = adapterFactory();
		seedSubjects(setup, "user-b");
		const adapter = guardSCIMSubjectAcquisitions(setup.factory)({} as BetterAuthOptions);
		const { requireAuthTransaction } = await import("@/lib/auth/auth-transaction");

		await expect(
			adapter.transaction(async (trx) => {
				await bump(trx, "user-b");
				await protectSCIMProjectedUser(requireAuthTransaction("test"), {
					organizationId,
					userId: "user-c",
				});
			}),
		).rejects.toBeInstanceOf(SCIMProjectionGuardOrderError);

		expect(mocks.protect).not.toHaveBeenCalled();
		expect(mocks.events).toEqual(["increment:scimSubject:user-b", "guard:user-b"]);
	});

	it("fails closed on a second user after guarding a first one itself", async () => {
		const transaction = { marker: "unobserved" };

		await protectSCIMProjectedUser(transaction as never, { organizationId, userId: "user-b" });
		await expect(
			protectSCIMProjectedUser(transaction as never, { organizationId, userId: "user-c" }),
		).rejects.toBeInstanceOf(SCIMProjectionGuardOrderError);

		expect(mocks.protect).toHaveBeenCalledTimes(1);
	});
});
