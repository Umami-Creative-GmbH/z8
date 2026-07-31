import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";
import { completeRemovedMemberCleanup } from "./member-removal-cleanup";

function compilePredicate(table: unknown, predicate: unknown) {
	return new PgDialect().sqlToQuery(
		sql`select * from ${table as never} where ${predicate as SQL}`,
	);
}

function setup(
	options: {
		replacementMembership?: { id: string } | null;
		secondaryFailure?: Error;
	} = {},
) {
	const events: string[] = [];
	const userFindFirst = vi.fn().mockImplementation(async () => {
		events.push("user-email-loaded");
		return { email: "  Person@Example.COM " };
	});
	const memberFindFirst = vi.fn().mockImplementation(async () => {
		events.push("replacement-checked");
		return options.replacementMembership ?? null;
	});
	const execute = vi.fn().mockImplementation(async () => {
		events.push("identity-locked");
	});
	const sessionWhere = vi.fn().mockImplementation(async () => {
		events.push("sessions-selected");
		return [{ token: "session-token" }];
	});
	const sessionFrom = vi.fn(() => ({ where: sessionWhere }));
	const select = vi.fn(() => ({ from: sessionFrom }));
	const deleteWhere = vi.fn().mockImplementation(async () => {
		events.push("database-sessions-deleted");
	});
	const deleteRows = vi.fn(() => ({ where: deleteWhere }));
	const updateWhere = vi.fn().mockImplementation(async () => {
		events.push("employee-deactivated");
	});
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set: updateSet }));
	const tx = {
		execute,
		query: {
			user: { findFirst: userFindFirst },
			member: { findFirst: memberFindFirst },
		},
		select,
		delete: deleteRows,
		update,
	};
	const transaction = vi.fn(
		async (run: (client: typeof tx) => Promise<unknown>) => {
			events.push("transaction-started");
			try {
				const result = await run(tx);
				events.push("transaction-committed");
				return result;
			} catch (error) {
				events.push("transaction-rolled-back");
				throw error;
			}
		},
	);
	const deleteSecondarySession = vi.fn().mockImplementation(async () => {
		events.push("secondary-token-deleted");
		if (options.secondaryFailure) throw options.secondaryFailure;
	});
	const reconcileBillingSeatsForOrganization = vi
		.fn()
		.mockImplementation(async () => {
			events.push("billing-reconciled");
		});

	return {
		dependencies: {
			db: { transaction },
			deleteSecondarySession,
			reconcileBillingSeatsForOrganization,
		},
		deleteRows,
		deleteWhere,
		events,
		execute,
		memberFindFirst,
		reconcileBillingSeatsForOrganization,
		select,
		transaction,
		update,
		updateWhere,
	};
}

describe("completeRemovedMemberCleanup", () => {
	it("locks identity before checking replacement membership and revoking sessions", async () => {
		const harness = setup();

		await completeRemovedMemberCleanup(
			{ organizationId: "org-1", userId: "user-1" },
			harness.dependencies as never,
		);

		expect(harness.events).toEqual([
			"transaction-started",
			"user-email-loaded",
			"identity-locked",
			"replacement-checked",
			"sessions-selected",
			"database-sessions-deleted",
			"employee-deactivated",
			"transaction-committed",
			"secondary-token-deleted",
			"billing-reconciled",
		]);
		expect(
			harness.reconcileBillingSeatsForOrganization,
		).toHaveBeenCalledExactlyOnceWith("org-1", { strict: true });
	});

	it("serializes replacement membership before preserving employee and session access", async () => {
		const harness = setup({
			replacementMembership: { id: "replacement-member-id" },
		});

		await completeRemovedMemberCleanup(
			{ organizationId: "org-1", userId: "user-1" },
			harness.dependencies as never,
		);

		const membershipQuery = compilePredicate(
			member,
			harness.memberFindFirst.mock.calls[0]?.[0]?.where,
		);
		expect(membershipQuery.params).toEqual(["user-1", "org-1", "approved"]);
		expect(membershipQuery.params).not.toContain("replacement-member-id");
		const identityLock = new PgDialect().sqlToQuery(
			harness.execute.mock.calls[0]?.[0] as SQL,
		);
		expect(identityLock.params).toEqual(["org-1", "person@example.com"]);
		expect(harness.select).not.toHaveBeenCalled();
		expect(harness.deleteRows).not.toHaveBeenCalled();
		expect(harness.update).not.toHaveBeenCalled();
		expect(harness.events).toEqual([
			"transaction-started",
			"user-email-loaded",
			"identity-locked",
			"replacement-checked",
			"transaction-committed",
			"billing-reconciled",
		]);
	});

	it("commits DB token deletion and deactivation before reporting Redis failure", async () => {
		const secondaryFailure = new Error("redis unavailable");
		const harness = setup({ secondaryFailure });

		await expect(
			completeRemovedMemberCleanup(
				{ organizationId: "org-1", userId: "user-1" },
				harness.dependencies as never,
			),
		).rejects.toBe(secondaryFailure);
		expect(harness.deleteWhere).toHaveBeenCalledOnce();
		expect(harness.updateWhere).toHaveBeenCalledOnce();
		expect(harness.reconcileBillingSeatsForOrganization).not.toHaveBeenCalled();
		expect(harness.events).toEqual([
			"transaction-started",
			"user-email-loaded",
			"identity-locked",
			"replacement-checked",
			"sessions-selected",
			"database-sessions-deleted",
			"employee-deactivated",
			"transaction-committed",
			"secondary-token-deleted",
		]);
	});
});
