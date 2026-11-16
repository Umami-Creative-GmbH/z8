import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { refuseInvitationOutsideEnterpriseIdentity } from "@/lib/enterprise-identity/invitation-restriction";
import * as authModule from "./auth";
import { makeEmailLookupCaseInsensitiveAdapter } from "./auth";

describe("organization member removal", () => {
	it("runs idempotent access cleanup before removed-seat reconciliation", async () => {
		const completeRemovedMemberCleanup = (
			authModule as typeof authModule & {
				completeRemovedMemberCleanup?: (
					input: {
						organizationId: string;
						userId: string;
					},
					dependencies: {
						revokeRemovedMemberAccess: (
							userId: string,
							organizationId: string,
						) => Promise<void>;
						reconcileBillingSeatsForOrganization: (
							organizationId: string,
						) => Promise<void>;
					},
				) => Promise<void>;
			}
		).completeRemovedMemberCleanup;
		expect(completeRemovedMemberCleanup).toBeTypeOf("function");
		const events: string[] = [];
		const revokeRemovedMemberAccess = vi.fn().mockImplementation(async () => {
			events.push("access-revoked");
		});
		const reconcileBillingSeatsForOrganization = vi
			.fn()
			.mockImplementation(async () => {
				events.push("billing-reconciled");
			});

		await completeRemovedMemberCleanup?.(
			{
				organizationId: "org-1",
				userId: "user-1",
			},
			{ revokeRemovedMemberAccess, reconcileBillingSeatsForOrganization },
		);

		expect(revokeRemovedMemberAccess).toHaveBeenCalledExactlyOnceWith(
			"user-1",
			"org-1",
		);
		expect(
			reconcileBillingSeatsForOrganization,
		).toHaveBeenCalledExactlyOnceWith("org-1", { strict: true });
		expect(events).toEqual(["access-revoked", "billing-reconciled"]);
	});

	it("stops post-removal cleanup before billing when access revocation fails", async () => {
		const cleanupError = new Error("secondary session storage unavailable");
		const revokeRemovedMemberAccess = vi.fn().mockRejectedValue(cleanupError);
		const reconcileBillingSeatsForOrganization = vi.fn();

		await expect(
			authModule.completeRemovedMemberCleanup(
				{
					organizationId: "org-1",
					userId: "user-1",
				},
				{ revokeRemovedMemberAccess, reconcileBillingSeatsForOrganization },
			),
		).rejects.toBe(cleanupError);
		expect(reconcileBillingSeatsForOrganization).not.toHaveBeenCalled();
	});

	it("coordinates membership writers and runs removal cleanup in the removal transaction", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
		const revocationSource = readFileSync(
			join(process.cwd(), "src/lib/auth/organization-session-revocation.ts"),
			"utf8",
		);
		const hooks = authModule.auth.options.plugins.find(
			(plugin) => plugin.id === "organization",
		)?.options?.organizationHooks;

		// Removal cleanup is owned by the coordination module (#314), not an after-commit hook here.
		expect(source).toContain(
			"organizationHooks: createCoordinatedOrganizationHooks(",
		);
		expect(source).not.toContain("completeRemovedMemberCleanup({");
		expect(source).toContain("drizzleAdapter(captureAuthTransactions(db)");
		// SCIM subject locks take the users' guards in the plugin's sorted order (#429).
		expect(source).toMatch(
			/guardSCIMSubjectAcquisitions\(\s*drizzleAdapter\(captureAuthTransactions\(db\)/,
		);
		expect(hooks).toEqual(
			expect.objectContaining({
				beforeUpdateMemberRole: expect.any(Function),
				beforeRemoveMember: expect.any(Function),
				afterRemoveMember: expect.any(Function),
				beforeAddMember: expect.any(Function),
				beforeAcceptInvitation: expect.any(Function),
				beforeDeleteOrganization: expect.any(Function),
			}),
		);
		// Enterprise identity "Restrict invites" holds on the raw endpoint (#1024).
		expect(hooks?.beforeCreateInvitation).toBe(refuseInvitationOutsideEnterpriseIdentity);
		expect(revocationSource).toContain("secondaryStorage.deleteOrThrow(token)");
		expect(authModule.auth.options.session?.cookieCache?.enabled).toBe(false);
	});
});

describe("makeEmailLookupCaseInsensitiveAdapter", () => {
	it("adds insensitive mode to user email findOne queries", async () => {
		const user = { id: "user_1" };
		const findOne = vi.fn(async () => user);
		const adapter = { findOne } as any;
		const wrapped = makeEmailLookupCaseInsensitiveAdapter(adapter);

		await expect(
			wrapped.findOne({
				model: "user",
				where: [{ field: "email", value: "USER@Example.com" }],
			}),
		).resolves.toBe(user);

		expect(findOne).toHaveBeenCalledWith({
			model: "user",
			where: [
				{ field: "email", value: "USER@Example.com", mode: "insensitive" },
			],
		});
	});

	it("preserves explicit where modes and non-email clauses", async () => {
		const findOne = vi.fn(async () => null);
		const adapter = { findOne } as any;
		const wrapped = makeEmailLookupCaseInsensitiveAdapter(adapter);

		await wrapped.findOne({
			model: "user",
			where: [
				{ field: "email", value: "USER@Example.com", mode: "sensitive" },
				{ field: "id", value: "user_1" },
			],
		});

		expect(findOne).toHaveBeenCalledWith({
			model: "user",
			where: [
				{ field: "email", value: "USER@Example.com", mode: "sensitive" },
				{ field: "id", value: "user_1" },
			],
		});
	});

	it("leaves non-user model findOne queries unchanged", async () => {
		const findOne = vi.fn(async () => null);
		const adapter = { findOne } as any;
		const wrapped = makeEmailLookupCaseInsensitiveAdapter(adapter);

		await wrapped.findOne({
			model: "account",
			where: [{ field: "email", value: "USER@Example.com" }],
		});

		expect(findOne).toHaveBeenCalledWith({
			model: "account",
			where: [{ field: "email", value: "USER@Example.com" }],
		});
	});

	it("preserves the rest of the adapter surface", () => {
		type AdapterFactory = ReturnType<
			typeof import("@better-auth/drizzle-adapter").drizzleAdapter
		>;
		type Adapter = ReturnType<AdapterFactory>;
		const preservedMethods = [
			"findMany",
			"count",
			"updateMany",
			"deleteMany",
		] as const satisfies readonly (keyof Adapter)[];
		const findOne = vi.fn(async () => null);
		const create = vi.fn();
		const findMany = vi.fn();
		const count = vi.fn();
		const updateMany = vi.fn();
		const deleteMany = vi.fn();
		const consumeOne = vi.fn<Adapter["consumeOne"]>(async () => null);
		const incrementOne = vi.fn<Adapter["incrementOne"]>(async () => null);
		const transaction = vi.fn<Adapter["transaction"]>();
		const adapter = {
			create,
			findOne,
			findMany,
			count,
			updateMany,
			deleteMany,
			consumeOne,
			incrementOne,
			transaction,
		} as unknown as Adapter;
		const wrapped = makeEmailLookupCaseInsensitiveAdapter(adapter);

		expect(wrapped.create).toBe(adapter.create);
		for (const method of preservedMethods) {
			expect(wrapped[method]).toBe(adapter[method]);
		}
		expect(wrapped.consumeOne).toBe(consumeOne);
		expect(wrapped.incrementOne).toBe(incrementOne);
		expect(wrapped.transaction).not.toBe(transaction);
	});

	it("keeps user email lookups insensitive inside Better Auth transactions", async () => {
		const user = { id: "user_1" };
		const findOne = vi.fn(async () => user);
		const create = vi.fn();
		const transactionAdapter = { findOne, create };
		const transaction = vi.fn(
			async (callback: (trx: typeof transactionAdapter) => Promise<unknown>) =>
				callback(transactionAdapter),
		);
		const wrapped = makeEmailLookupCaseInsensitiveAdapter({
			findOne: vi.fn(),
			transaction,
		} as never);

		const result = await wrapped.transaction(async (trx) => {
			expect(trx.create).toBe(create);
			return trx.findOne({
				model: "user",
				where: [{ field: "email", value: "USER@Example.com" }],
			});
		});

		expect(result).toBe(user);
		expect(findOne).toHaveBeenCalledWith({
			model: "user",
			where: [
				{ field: "email", value: "USER@Example.com", mode: "insensitive" },
			],
		});
	});
});
