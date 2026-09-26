import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
	AuthorizationScopeChanged,
	protectAuthorizationMutation,
	withAuthorizationMutation,
} from "./authorization-mutation";

const dialect = new PgDialect();

/**
 * A transaction double: `execute` records advisory lock requests, and each
 * employee routing read answers from `employeeUsers` at the time it runs.
 */
function fakeTransaction(employeeUsers: () => Record<string, string>) {
	const events: string[] = [];
	const transaction = {
		async execute(query: SQL) {
			const { sql, params } = dialect.sqlToQuery(query);
			const mode = sql.includes("pg_advisory_xact_lock_shared") ? "shared" : "exclusive";
			events.push(`${mode} ${params[0]}`);
			return { rows: [] };
		},
		select() {
			return {
				from: () => ({
					where: async () => {
						events.push("route");
						return Object.entries(employeeUsers()).map(([id, userId]) => ({ id, userId }));
					},
				}),
			};
		},
	};
	return { transaction, events };
}

const org = (id: string) => `exclusive ${JSON.stringify(["work-organization-configuration", id])}`;
const user = (id: string) => `exclusive ${JSON.stringify(["work-user-configuration-access", id])}`;

describe("protectAuthorizationMutation", () => {
	it("routes, then takes organization then sorted user protection exclusively, then reroutes", async () => {
		const { transaction, events } = fakeTransaction(() => ({ "employee-b": "user-b" }));

		await protectAuthorizationMutation(transaction as never, {
			organizationId: "org-1",
			organizationWide: true,
			userIds: ["user-c", "user-a", "user-c"],
			employeeIds: ["employee-b"],
		});

		expect(events).toEqual([
			"route",
			org("org-1"),
			user("user-a"),
			user("user-b"),
			user("user-c"),
			"route",
		]);
	});

	it("takes only user protection for a user-scoped mutation", async () => {
		const { transaction, events } = fakeTransaction(() => ({}));

		await protectAuthorizationMutation(transaction as never, {
			organizationId: "org-1",
			userIds: ["user-a"],
		});

		expect(events).toEqual([user("user-a")]);
	});

	it("includes dynamically routed employees and users", async () => {
		const { transaction, events } = fakeTransaction(() => ({ "manager-1": "user-m" }));
		const route = vi.fn(async () => ({ employeeIds: ["manager-1"], userIds: ["user-x"] }));

		await protectAuthorizationMutation(transaction as never, {
			organizationId: "org-1",
			route,
		});

		expect(route).toHaveBeenCalledTimes(2);
		expect(events).toEqual(["route", user("user-m"), user("user-x"), "route"]);
	});

	it("refuses when protected routing discovers a user that was not protected", async () => {
		const { transaction } = fakeTransaction(() => ({}));
		const routes = [["user-a"], ["user-a", "user-b"]];
		const route = vi.fn(async () => ({ userIds: routes.shift() }));

		await expect(
			protectAuthorizationMutation(transaction as never, { organizationId: "org-1", route }),
		).rejects.toBeInstanceOf(AuthorizationScopeChanged);
	});

	it("accepts a protected scope that shrank while waiting", async () => {
		const { transaction } = fakeTransaction(() => ({}));
		const routes = [["user-a", "user-b"], ["user-a"]];
		const route = vi.fn(async () => ({ userIds: routes.shift() }));

		await expect(
			protectAuthorizationMutation(transaction as never, { organizationId: "org-1", route }),
		).resolves.toBeUndefined();
	});
});

describe("withAuthorizationMutation", () => {
	function fakeDatabase(transactions: ReturnType<typeof fakeTransaction>["transaction"][]) {
		let attempt = 0;
		return {
			transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
				callback(transactions[Math.min(attempt++, transactions.length - 1)]),
			),
		};
	}

	it("protects before running the mutation in the same transaction", async () => {
		const { transaction, events } = fakeTransaction(() => ({}));
		const database = fakeDatabase([transaction]);

		const result = await withAuthorizationMutation(
			{ organizationId: "org-1", userIds: ["user-a"] },
			async (tx) => {
				expect(tx).toBe(transaction);
				events.push("mutate");
				return "done";
			},
			database as never,
		);

		expect(result).toBe("done");
		expect(events).toEqual([user("user-a"), "mutate"]);
	});

	it("restarts in a new transaction when the protected scope changed", async () => {
		let calls = 0;
		const route = async () => {
			calls += 1;
			// First attempt: routed {a}, confirmed {a, b}; second attempt stable at {a, b}.
			return { userIds: calls === 1 ? ["user-a"] : ["user-a", "user-b"] };
		};
		const first = fakeTransaction(() => ({}));
		const second = fakeTransaction(() => ({}));
		const database = fakeDatabase([first.transaction, second.transaction]);
		const mutation = vi.fn(async () => "done");

		await expect(
			withAuthorizationMutation({ organizationId: "org-1", route }, mutation, database as never),
		).resolves.toBe("done");

		expect(database.transaction).toHaveBeenCalledTimes(2);
		expect(mutation).toHaveBeenCalledTimes(1);
		expect(second.events).toEqual([user("user-a"), user("user-b")]);
	});

	it("gives up after repeated scope changes", async () => {
		let calls = 0;
		const route = async () => ({ userIds: [`user-${calls++}`] });
		const { transaction } = fakeTransaction(() => ({}));
		const database = fakeDatabase([transaction]);

		await expect(
			withAuthorizationMutation(
				{ organizationId: "org-1", route },
				async () => "done",
				database as never,
			),
		).rejects.toBeInstanceOf(AuthorizationScopeChanged);
		expect(database.transaction).toHaveBeenCalledTimes(3);
	});
});
