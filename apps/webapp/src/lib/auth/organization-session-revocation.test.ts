import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import * as schema from "@/db/auth-schema";
import { revokeOrganizationActiveSessions } from "./organization-session-revocation";

type RevocationDb = NonNullable<
	Parameters<typeof revokeOrganizationActiveSessions>[2]
>["db"];

function createDb(
	sessionRows: Array<{ token: string }>,
	events: string[] = [],
) {
	const selectWhere = vi.fn().mockResolvedValue(sessionRows);
	const selectFrom = vi.fn(() => ({ where: selectWhere }));
	const deleteWhere = vi.fn().mockImplementation(async () => {
		events.push("database-delete");
	});

	return {
		select: vi.fn(() => ({ from: selectFrom })),
		delete: vi.fn(() => ({ where: deleteWhere })),
		selectWhere,
		deleteWhere,
	};
}

function createDeferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function compileSessionPredicate(predicate: unknown) {
	return new PgDialect().sqlToQuery(
		sql`select ${schema.session.token} from ${schema.session} where ${predicate as SQL}`,
	);
}

describe("revokeOrganizationActiveSessions", () => {
	it("selects and deletes only sessions active for the user in the removed organization", async () => {
		const db = createDb([{ token: "org-1-session" }]);
		const deleteSecondarySession = vi.fn().mockResolvedValue(undefined);

		await revokeOrganizationActiveSessions("user-1", "org-1", {
			db: db as RevocationDb,
			deleteSecondarySession,
		});

		const selectQuery = compileSessionPredicate(
			db.selectWhere.mock.calls[0]?.[0],
		);
		const deleteQuery = compileSessionPredicate(
			db.deleteWhere.mock.calls[0]?.[0],
		);
		for (const query of [selectQuery, deleteQuery]) {
			expect(query.sql).toContain('"session"."user_id"');
			expect(query.sql).toContain('"session"."active_organization_id"');
			expect(query.params).toEqual(["user-1", "org-1"]);
		}
		expect(deleteSecondarySession).toHaveBeenCalledExactlyOnceWith(
			"org-1-session",
		);
	});

	it("deletes every selected token from secondary storage while preserving other organization sessions", async () => {
		const db = createDb([{ token: "org-1-a" }, { token: "org-1-b" }]);
		const deleteSecondarySession = vi.fn().mockResolvedValue(undefined);

		await revokeOrganizationActiveSessions("user-1", "org-1", {
			db: db as RevocationDb,
			deleteSecondarySession,
		});

		expect(deleteSecondarySession.mock.calls).toEqual([
			["org-1-a"],
			["org-1-b"],
		]);
		expect(deleteSecondarySession).not.toHaveBeenCalledWith(
			"other-org-session",
		);
	});

	it("durably deletes database rows before attempting secondary storage deletion", async () => {
		const events: string[] = [];
		const db = createDb([{ token: "org-1-a" }, { token: "org-1-b" }], events);
		const deleteSecondarySession = vi.fn().mockImplementation(async (token) => {
			events.push(`secondary-delete:${token}`);
		});

		await revokeOrganizationActiveSessions("user-1", "org-1", {
			db: db as RevocationDb,
			deleteSecondarySession,
		});

		expect(events).toEqual([
			"database-delete",
			"secondary-delete:org-1-a",
			"secondary-delete:org-1-b",
		]);
	});

	it("deletes database rows without waiting for secondary storage", async () => {
		const firstDelete = createDeferred();
		const secondDelete = createDeferred();
		const db = createDb([{ token: "org-1-a" }, { token: "org-1-b" }]);
		const deleteSecondarySession = vi.fn((token: string) =>
			token === "org-1-a" ? firstDelete.promise : secondDelete.promise,
		);

		const revocation = revokeOrganizationActiveSessions("user-1", "org-1", {
			db: db as RevocationDb,
			deleteSecondarySession,
		});
		await vi.waitFor(() =>
			expect(deleteSecondarySession).toHaveBeenCalledTimes(2),
		);

		expect(db.deleteWhere).toHaveBeenCalledOnce();
		firstDelete.resolve();
		await Promise.resolve();
		expect(db.deleteWhere).toHaveBeenCalledOnce();

		secondDelete.resolve();
		await revocation;
		expect(db.deleteWhere).toHaveBeenCalledOnce();
	});

	it("is idempotent when the user has no active sessions in the organization", async () => {
		const db = createDb([]);
		const deleteSecondarySession = vi.fn().mockResolvedValue(undefined);

		await expect(
			revokeOrganizationActiveSessions("user-1", "org-1", {
				db: db as RevocationDb,
				deleteSecondarySession,
			}),
		).resolves.toBeUndefined();

		expect(db.deleteWhere).toHaveBeenCalledOnce();
		expect(deleteSecondarySession).not.toHaveBeenCalled();
	});

	it("propagates secondary storage failures after durable database deletion", async () => {
		const db = createDb([{ token: "org-1-a" }, { token: "org-1-b" }]);
		const storageError = new Error("secondary storage unavailable");
		const deleteSecondarySession = vi.fn((token: string) =>
			token === "org-1-a" ? Promise.reject(storageError) : Promise.resolve(),
		);

		await expect(
			revokeOrganizationActiveSessions("user-1", "org-1", {
				db: db as RevocationDb,
				deleteSecondarySession,
			}),
		).rejects.toBe(storageError);

		expect(deleteSecondarySession.mock.calls).toEqual([
			["org-1-a"],
			["org-1-b"],
		]);
		expect(db.deleteWhere).toHaveBeenCalledOnce();
	});
});
