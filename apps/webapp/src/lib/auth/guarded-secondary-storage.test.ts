import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { member, session } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { createGuardedAuthSecondaryStorage } from "./guarded-secondary-storage";

function serializedSession(
	activeOrganizationId: string | null = "org-1",
	userId: string | null = "user-1",
) {
	return JSON.stringify({
		session: { activeOrganizationId, token: "session-token", userId },
		user: { email: "Person@Example.com", id: "user-1" },
	});
}

function compilePredicate(table: unknown, predicate: unknown) {
	return new PgDialect().sqlToQuery(
		sql`select * from ${table as never} where ${predicate as SQL}`,
	);
}

function setup() {
	const state = {
		memberships: new Map<string, { role: string } | null>([
			["org-1", { role: "member" }],
			["org-2", { role: "member" }],
		]),
		employees: new Map<string, { isActive: boolean } | null>([
			["org-1", { isActive: true }],
			["org-2", { isActive: true }],
		]),
		cache: new Map<string, string>(),
		databaseSessions: new Map([
			[
				"session-token",
				{ activeOrganizationId: "org-1" as string | null, userId: "user-1" },
			],
		]),
	};
	const events: string[] = [];
	const storage = {
		get: vi.fn(async (key: string) => state.cache.get(key) ?? null),
		set: vi.fn(async (key: string, value: string) => {
			events.push("secondary-set");
			state.cache.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			state.cache.delete(key);
		}),
		deleteOrThrow: vi.fn(async (key: string) => {
			events.push("secondary-delete");
			state.cache.delete(key);
		}),
	};
	const memberFindFirst = vi.fn(async (query: { where: unknown }) => {
		const organizationId = compilePredicate(member, query.where)
			.params[1] as string;
		return state.memberships.get(organizationId) ?? null;
	});
	const employeeFindFirst = vi.fn(async (query: { where: unknown }) => {
		const organizationId = compilePredicate(employee, query.where)
			.params[1] as string;
		return state.employees.get(organizationId) ?? null;
	});
	const sessionFindFirst = vi.fn(async (query: { where: unknown }) => {
		const [token, userId, organizationId] = compilePredicate(
			session,
			query.where,
		).params as string[];
		const storedSession = state.databaseSessions.get(token);
		return storedSession?.userId === userId &&
			(organizationId === undefined ||
				storedSession.activeOrganizationId === organizationId)
			? storedSession
			: null;
	});
	const transaction = vi.fn(async () => {
		throw new Error("nested transaction must not be opened");
	});
	const deleteWhere = vi.fn(async (predicate: unknown) => {
		events.push("database-delete");
		const [token, userId, organizationId] = compilePredicate(session, predicate)
			.params as string[];
		const storedSession = state.databaseSessions.get(token);
		if (
			storedSession?.userId === userId &&
			(organizationId === undefined ||
				storedSession.activeOrganizationId === organizationId)
		) {
			state.databaseSessions.delete(token);
		}
	});
	const deleteRows = vi.fn(() => ({ where: deleteWhere }));
	const db = {
		delete: deleteRows,
		query: {
			employee: { findFirst: employeeFindFirst },
			member: { findFirst: memberFindFirst },
			session: { findFirst: sessionFindFirst },
		},
		transaction,
	};

	return {
		adapter: createGuardedAuthSecondaryStorage(storage, db as never),
		deleteRows,
		deleteWhere,
		employeeFindFirst,
		events,
		memberFindFirst,
		sessionFindFirst,
		state,
		storage,
		transaction,
	};
}

describe("guarded Better Auth secondary storage", () => {
	it("preserves Better Auth invitation acceptance set-before-database ordering", async () => {
		const harness = setup();

		harness.events.push("outer-transaction-member-insert");
		await harness.adapter.set("session-token", serializedSession(), 300);
		harness.events.push("outer-transaction-session-update");

		expect(harness.events).toEqual([
			"outer-transaction-member-insert",
			"secondary-set",
			"outer-transaction-session-update",
		]);
		expect(harness.transaction).not.toHaveBeenCalled();
		expect(harness.storage.set).toHaveBeenCalledWith(
			"session-token",
			serializedSession(),
			300,
		);
	});

	it("returns unrelated secondary values unchanged without querying access", async () => {
		const harness = setup();
		const values = [
			["rate-limit", "12"],
			["active-sessions-user-1", JSON.stringify([{ token: "session-token" }])],
			["malformed", "not-json"],
		] as const;

		for (const [key, value] of values) {
			harness.state.cache.set(key, value);
			await expect(harness.adapter.get(key)).resolves.toBe(value);
		}

		expect(harness.memberFindFirst).not.toHaveBeenCalled();
		expect(harness.employeeFindFirst).not.toHaveBeenCalled();
		expect(harness.storage.deleteOrThrow).not.toHaveBeenCalled();
	});

	it("returns a durable session without an active organization", async () => {
		const harness = setup();
		const value = serializedSession(null);
		harness.state.databaseSessions.set("session-token", {
			activeOrganizationId: null,
			userId: "user-1",
		});
		harness.state.cache.set("session-token", value);

		await expect(harness.adapter.get("session-token")).resolves.toBe(value);
		expect(harness.memberFindFirst).not.toHaveBeenCalled();
		expect(harness.employeeFindFirst).not.toHaveBeenCalled();
		expect(harness.storage.deleteOrThrow).not.toHaveBeenCalled();
		expect(
			compilePredicate(
				session,
				harness.sessionFindFirst.mock.calls[0]?.[0]?.where,
			).params,
		).toEqual(["session-token", "user-1"]);
	});

	it("deletes a revoked cached session without an active organization", async () => {
		const harness = setup();
		harness.state.databaseSessions.delete("session-token");
		harness.state.cache.set("session-token", serializedSession(null));

		await expect(harness.adapter.get("session-token")).resolves.toBeNull();
		expect(harness.memberFindFirst).not.toHaveBeenCalled();
		expect(harness.employeeFindFirst).not.toHaveBeenCalled();
		expect(harness.storage.deleteOrThrow).toHaveBeenCalledWith("session-token");
		expect(harness.state.cache.has("session-token")).toBe(false);
	});

	it("returns a valid active employee session", async () => {
		const harness = setup();
		const value = serializedSession();
		harness.state.cache.set("session-token", value);

		await expect(harness.adapter.get("session-token")).resolves.toBe(value);
		expect(harness.storage.deleteOrThrow).not.toHaveBeenCalled();
		expect(harness.deleteRows).not.toHaveBeenCalled();
		expect(
			compilePredicate(
				session,
				harness.sessionFindFirst.mock.calls[0]?.[0]?.where,
			).params,
		).toEqual(["session-token", "user-1"]);
	});

	it.each([
		"owner",
		"admin",
	])("allows no-employee bootstrap for an approved %s role token", async (role) => {
		const harness = setup();
		const value = serializedSession();
		harness.state.memberships.set("org-1", { role: `member, ${role}` });
		harness.state.employees.set("org-1", null);
		harness.state.cache.set("session-token", value);

		await expect(harness.adapter.get("session-token")).resolves.toBe(value);
		expect(harness.storage.deleteOrThrow).not.toHaveBeenCalled();
		expect(harness.deleteRows).not.toHaveBeenCalled();
	});

	it.each([
		["missing approved membership", null, { isActive: true }],
		["inactive employee", { role: "member" }, { isActive: false }],
		["ordinary member without employee", { role: "member" }, null],
	] as const)("deletes and rejects a session with %s", async (_name, membership, employeeRow) => {
		const harness = setup();
		harness.state.memberships.set("org-1", membership);
		harness.state.employees.set("org-1", employeeRow);
		harness.state.cache.set("session-token", serializedSession());

		await expect(harness.adapter.get("session-token")).resolves.toBeNull();
		expect(
			compilePredicate(session, harness.deleteWhere.mock.calls[0]?.[0]).params,
		).toEqual(["session-token", "user-1"]);
		expect(harness.events).toEqual(["database-delete", "secondary-delete"]);
		expect(harness.state.databaseSessions.has("session-token")).toBe(false);
		expect(harness.storage.deleteOrThrow).toHaveBeenCalledWith("session-token");
		expect(harness.state.cache.has("session-token")).toBe(false);
	});

	it("preserves a persisted session for the correct active organization", async () => {
		const harness = setup();
		const value = serializedSession("org-2");
		harness.state.databaseSessions.set("session-token", {
			activeOrganizationId: "org-2",
			userId: "user-1",
		});
		harness.state.memberships.set("org-1", null);
		harness.state.employees.set("org-1", { isActive: false });
		harness.state.cache.set("session-token", value);

		await expect(harness.adapter.get("session-token")).resolves.toBe(value);
		expect(
			compilePredicate(
				member,
				harness.memberFindFirst.mock.calls[0]?.[0]?.where,
			).params,
		).toEqual(["user-1", "org-2", "approved"]);
		expect(
			compilePredicate(
				employee,
				harness.employeeFindFirst.mock.calls[0]?.[0]?.where,
			).params,
		).toEqual(["user-1", "org-2"]);
		expect(harness.storage.deleteOrThrow).not.toHaveBeenCalled();
		expect(harness.deleteRows).not.toHaveBeenCalled();
	});

	it("deletes an otherwise valid cache token when its durable session row is absent", async () => {
		const harness = setup();
		harness.state.databaseSessions.delete("session-token");
		harness.state.cache.set("session-token", serializedSession());

		await expect(harness.adapter.get("session-token")).resolves.toBeNull();
		expect(harness.storage.deleteOrThrow).toHaveBeenCalledWith("session-token");
		expect(harness.state.cache.has("session-token")).toBe(false);
	});

	it("invalidates a stale key left by secondary-first cleanup ordering", async () => {
		const harness = setup();
		await harness.adapter.set("session-token", serializedSession());
		harness.events.push("cleanup-committed");
		harness.state.databaseSessions.delete("session-token");
		harness.state.memberships.set("org-1", null);
		harness.state.employees.set("org-1", { isActive: false });

		await expect(harness.adapter.get("session-token")).resolves.toBeNull();
		expect(harness.events).toEqual([
			"secondary-set",
			"cleanup-committed",
			"database-delete",
			"secondary-delete",
		]);
		expect(harness.state.databaseSessions.has("session-token")).toBe(false);
		expect(harness.state.cache.has("session-token")).toBe(false);
	});

	it("prevents Better Auth from falling back to a stale database session", async () => {
		const harness = setup();
		harness.state.memberships.set("org-1", null);
		harness.state.cache.set("session-token", serializedSession());
		const findSessionLikeBetterAuth = async (token: string) => {
			const cached = await harness.adapter.get(token);
			return cached ?? harness.state.databaseSessions.get(token) ?? null;
		};

		await expect(
			findSessionLikeBetterAuth("session-token"),
		).resolves.toBeNull();
		expect(harness.state.databaseSessions.has("session-token")).toBe(false);
	});

	it("fails closed for identifiable session parse and database failures", async () => {
		const malformedHarness = setup();
		malformedHarness.state.cache.set(
			"malformed-session",
			serializedSession("org-1", null),
		);
		await expect(
			malformedHarness.adapter.get("malformed-session"),
		).rejects.toThrow("Organization session invalidation failed");
		expect(malformedHarness.storage.deleteOrThrow).not.toHaveBeenCalled();

		const failedDbHarness = setup();
		failedDbHarness.state.cache.set("session-token", serializedSession());
		failedDbHarness.memberFindFirst.mockRejectedValueOnce(
			new Error("database unavailable"),
		);
		await expect(
			failedDbHarness.adapter.get("session-token"),
		).resolves.toBeNull();
		expect(failedDbHarness.storage.deleteOrThrow).toHaveBeenCalledWith(
			"session-token",
		);
	});

	it("throws a sanitized error when database deletion fails", async () => {
		const harness = setup();
		harness.state.memberships.set("org-1", null);
		harness.state.cache.set("session-token", serializedSession());
		harness.deleteWhere.mockRejectedValueOnce(
			new Error("postgres secret failure detail"),
		);

		await expect(harness.adapter.get("session-token")).rejects.toThrow(
			"Organization session invalidation failed",
		);
		expect(harness.storage.deleteOrThrow).not.toHaveBeenCalled();
		expect(harness.state.databaseSessions.has("session-token")).toBe(true);
	});

	it("throws after database deletion when Redis deletion fails", async () => {
		const harness = setup();
		harness.state.memberships.set("org-1", null);
		harness.state.cache.set("session-token", serializedSession());
		harness.storage.deleteOrThrow.mockRejectedValueOnce(
			new Error("redis unavailable"),
		);

		await expect(harness.adapter.get("session-token")).rejects.toThrow(
			"Organization session invalidation failed",
		);
		expect(harness.state.databaseSessions.has("session-token")).toBe(false);
	});

	it("never resurrects a deleted durable session after failed Redis cleanup and employee reactivation", async () => {
		const harness = setup();
		harness.state.employees.set("org-1", { isActive: false });
		harness.state.cache.set("session-token", serializedSession());
		harness.storage.deleteOrThrow.mockRejectedValueOnce(
			new Error("redis unavailable"),
		);

		await expect(harness.adapter.get("session-token")).rejects.toThrow(
			"Organization session invalidation failed",
		);
		expect(harness.state.databaseSessions.has("session-token")).toBe(false);
		expect(harness.state.cache.has("session-token")).toBe(true);

		harness.state.employees.set("org-1", { isActive: true });

		await expect(harness.adapter.get("session-token")).resolves.toBeNull();
		expect(harness.storage.deleteOrThrow).toHaveBeenCalledTimes(2);
		expect(harness.state.cache.has("session-token")).toBe(false);
	});

	it("fails closed without deleting a different parsed session token", async () => {
		const harness = setup();
		harness.state.memberships.set("org-1", null);
		const mismatchedValue = serializedSession().replace(
			'"token":"session-token"',
			'"token":"different-token"',
		);
		harness.state.cache.set("session-token", mismatchedValue);

		await expect(harness.adapter.get("session-token")).rejects.toThrow(
			"Organization session invalidation failed",
		);
		expect(harness.deleteRows).not.toHaveBeenCalled();
		expect(harness.storage.deleteOrThrow).not.toHaveBeenCalled();
	});
});
