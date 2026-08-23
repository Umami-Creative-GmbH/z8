import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as authModule from "./auth";
import {
	makeEmailLookupCaseInsensitiveAdapter,
	resolveInvitationTargetTeamId,
} from "./auth";

describe("resolveInvitationTargetTeamId", () => {
	it("returns valid stored target team ids that still exist in the invitation organization", async () => {
		const db = {
			query: {
				team: {
					findFirst: async () => ({
						id: "11111111-1111-4111-8111-111111111111",
					}),
				},
			},
		};

		await expect(
			resolveInvitationTargetTeamId(
				db as Parameters<typeof resolveInvitationTargetTeamId>[0],
				"org-1",
				"11111111-1111-4111-8111-111111111111",
			),
		).resolves.toBe("11111111-1111-4111-8111-111111111111");
	});

	it("falls back to null without querying for missing or malformed stored target team ids", async () => {
		const db = {
			query: {
				team: {
					findFirst: async () => {
						throw new Error("Team lookup should not run");
					},
				},
			},
		};

		await expect(
			resolveInvitationTargetTeamId(
				db as Parameters<typeof resolveInvitationTargetTeamId>[0],
				"org-1",
				null,
			),
		).resolves.toBeNull();
		await expect(
			resolveInvitationTargetTeamId(
				db as Parameters<typeof resolveInvitationTargetTeamId>[0],
				"org-1",
				undefined,
			),
		).resolves.toBeNull();
		await expect(
			resolveInvitationTargetTeamId(
				db as Parameters<typeof resolveInvitationTargetTeamId>[0],
				"org-1",
				"not-a-uuid",
			),
		).resolves.toBeNull();
	});

	it("falls back to null when the stored target team was deleted", async () => {
		const db = {
			query: {
				team: {
					findFirst: async () => null,
				},
			},
		};

		await expect(
			resolveInvitationTargetTeamId(
				db as Parameters<typeof resolveInvitationTargetTeamId>[0],
				"org-1",
				"11111111-1111-4111-8111-111111111111",
			),
		).resolves.toBeNull();
	});
});

describe("billing seat sync hooks", () => {
	it("syncs billing seats after standard invitation acceptance", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
		const acceptInvitationHook = source.slice(
			source.indexOf("afterAcceptInvitation"),
			source.indexOf(
				"// Create employee record when user is added to organization",
			),
		);

		expect(acceptInvitationHook).toContain("syncBillingSeats");
		expect(acceptInvitationHook).toContain('change: "added"');
	});

	it("passes invitation id into employee provisioning", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
		const acceptInvitationHook = source.slice(
			source.indexOf("afterAcceptInvitation"),
			source.indexOf(
				"// Create employee record when user is added to organization",
			),
		);
		expect(acceptInvitationHook).toContain("invitationId: invitation.id");
		expect(acceptInvitationHook).toContain('mode: "membershipAccepted"');
	});

	it("resolves organization creation permission through the stable invitation draft fallback", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
		const acceptInvitationHook = source.slice(
			source.indexOf("afterAcceptInvitation"),
			source.indexOf(
				"// Create employee record when user is added to organization",
			),
		);

		expect(acceptInvitationHook).toContain(
			"resolveAcceptedInvitationCanCreateOrganizations",
		);
		expect(acceptInvitationHook).toContain(
			"normalizeInvitationEmail(invitation.email)",
		);
	});

	it("resolves independent invitation acceptance fields in parallel", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
		const acceptInvitationHook = source.slice(
			source.indexOf("afterAcceptInvitation"),
			source.indexOf(
				"// Create employee record when user is added to organization",
			),
		);

		expect(acceptInvitationHook).toContain(
			"const [targetTeamId, canCreateOrganizations] = await Promise.all([",
		);
		expect(acceptInvitationHook).toContain("resolveInvitationTargetTeamId(");
		expect(acceptInvitationHook).toContain(
			"resolveAcceptedInvitationCanCreateOrganizations(db,",
		);
	});

	it("uses explicit membership acceptance provisioning after directly adding a member", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
		const addMemberHook = source.slice(
			source.indexOf("afterAddMember"),
			source.indexOf("// Sync seat count when member is removed"),
		);

		expect(addMemberHook).toContain('mode: "membershipAccepted"');
	});
});

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

	it("runs access revocation and billing only after membership removal", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
		const revocationSource = readFileSync(
			join(process.cwd(), "src/lib/auth/organization-session-revocation.ts"),
			"utf8",
		);
		const beforeRemovalHook = source.slice(
			source.indexOf("beforeRemoveMember"),
			source.indexOf("afterRemoveMember"),
		);
		const afterRemovalHook = source.slice(
			source.indexOf("afterRemoveMember"),
			source.indexOf("},", source.indexOf("afterRemoveMember")) + 2,
		);

		expect(beforeRemovalHook).not.toContain("revokeRemovedMemberAccess");
		expect(beforeRemovalHook).not.toContain("completeRemovedMemberCleanup");
		expect(beforeRemovalHook).not.toContain("syncBillingSeats");
		expect(afterRemovalHook).toContain("completeRemovedMemberCleanup");
		expect(revocationSource).toContain("secondaryStorage.deleteOrThrow(token)");
		expect(source).not.toContain("cookieCache: {");
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
		expect(wrapped.transaction).toBe(transaction);
	});
});
