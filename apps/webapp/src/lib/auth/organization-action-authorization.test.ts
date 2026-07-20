import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { requireActiveOrganizationActionActor } from "./organization-action-authorization";

function runAuthorization({
	employeeRecord,
	membershipRecord,
	requiredRole = "admin",
}: {
	employeeRecord: { isActive: boolean } | null;
	membershipRecord: {
		role: string;
		status: "approved" | "pending" | "rejected";
	} | null;
	requiredRole?: "admin" | "owner";
}) {
	const memberFindFirst = vi.fn(async () =>
		membershipRecord?.status === "approved" ? membershipRecord : null,
	);
	const employeeFindFirst = vi.fn(async () => employeeRecord);
	const databaseLayer = Layer.succeed(DatabaseService, {
		db: {
			query: {
				employee: { findFirst: employeeFindFirst },
				member: { findFirst: memberFindFirst },
			},
		} as never,
		query: (_name, execute) => Effect.promise(execute),
	});

	return {
		employeeFindFirst,
		memberFindFirst,
		result: Effect.runPromise(
			requireActiveOrganizationActionActor({
				userId: "user-1",
				organizationId: "org-1",
				requiredRole,
				message: "Organization action denied",
				resource: "organization",
				action: "update",
			}).pipe(Effect.provide(databaseLayer)),
		),
	};
}

describe("requireActiveOrganizationActionActor", () => {
	it.each([
		["missing approved membership", null, { isActive: true }],
		[
			"pending privileged membership",
			{ role: "owner", status: "pending" },
			null,
		],
		[
			"rejected privileged membership",
			{ role: "owner", status: "rejected" },
			null,
		],
		[
			"inactive employee",
			{ role: "owner", status: "approved" },
			{ isActive: false },
		],
		[
			"insufficient capability",
			{ role: "member", status: "approved" },
			{ isActive: true },
		],
	] as const)("denies an actor with %s", async (_case, membershipRecord, employeeRecord) => {
		await expect(
			runAuthorization({ membershipRecord, employeeRecord }).result,
		).rejects.toThrow("Organization action denied");
	});

	it.each([
		[
			"active approved admin",
			{ role: "member,admin", status: "approved" },
			{ isActive: true },
		],
		[
			"active approved owner",
			{ role: "member,owner", status: "approved" },
			{ isActive: true },
		],
		["bootstrap admin", { role: "admin", status: "approved" }, null],
		["bootstrap owner", { role: "owner", status: "approved" }, null],
	] as const)("allows an intentional %s", async (_case, membershipRecord, employeeRecord) => {
		await expect(
			runAuthorization({ membershipRecord, employeeRecord }).result,
		).resolves.toMatchObject({
			membership: membershipRecord,
			employee: employeeRecord,
		});
	});

	it("requires an owner token for owner-only actions", async () => {
		await expect(
			runAuthorization({
				membershipRecord: { role: "admin", status: "approved" },
				employeeRecord: null,
				requiredRole: "owner",
			}).result,
		).rejects.toThrow("Organization action denied");

		await expect(
			runAuthorization({
				membershipRecord: { role: "member,owner", status: "approved" },
				employeeRecord: null,
				requiredRole: "owner",
			}).result,
		).resolves.toBeDefined();
	});

	it("scopes both records to the user and organization and requires approved membership", async () => {
		const harness = runAuthorization({
			membershipRecord: { role: "owner", status: "approved" },
			employeeRecord: { isActive: true },
		});

		await harness.result;
		const memberQuery = new PgDialect().sqlToQuery(
			harness.memberFindFirst.mock.calls[0]?.[0].where,
		);
		const employeeQuery = new PgDialect().sqlToQuery(
			harness.employeeFindFirst.mock.calls[0]?.[0].where,
		);
		expect(memberQuery.params).toEqual(["user-1", "org-1", "approved"]);
		expect(employeeQuery.params).toEqual(["user-1", "org-1"]);
	});
});
