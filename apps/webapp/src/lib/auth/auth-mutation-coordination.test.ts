import type { DBAdapter } from "@better-auth/core/db/adapter";
import { admin as adminPlugin } from "better-auth/plugins/admin";
import { organization as organizationPlugin } from "better-auth/plugins/organization";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	events: [] as string[],
	protect: vi.fn(),
	acquireUsers: vi.fn(),
	revoke: vi.fn(),
	postCommit: vi.fn(),
}));

vi.mock("@/lib/authorization/authorization-mutation", () => ({
	protectAuthorizationMutation: mocks.protect,
}));
vi.mock("@/lib/time-tracking/work-transaction", () => ({
	acquireExclusiveUserConfigurationAccessGuards: mocks.acquireUsers,
}));
vi.mock("./member-removal-cleanup", () => ({
	revokeRemovedMemberAccessInTransaction: mocks.revoke,
	completeRemovedMemberCleanupPostCommit: mocks.postCommit,
}));

const {
	createCoordinatedOrganizationHooks,
	handleCoordinatedAuthRequest,
	isCoordinatedAuthMutationPath,
} = await import("./auth-mutation-coordination");
const { captureAuthTransactions, runCoordinatedAuthMutation, UncoordinatedAuthMutationError } =
	await import("./auth-transaction");

const organization = { id: "org-1", name: "Org", slug: "org", createdAt: new Date() };
const user = { id: "actor", email: "actor@example.test" } as never;
const member = {
	id: "member-1",
	organizationId: "org-1",
	userId: "target",
	role: "member",
	createdAt: new Date(),
};

/** A Better Auth adapter whose transactions run on a captured fake drizzle transaction. */
function coordinatedAuth() {
	const transaction = { marker: "tx" };
	const outcome = { committed: 0, rolledBack: 0 };
	const database = captureAuthTransactions({
		async transaction<T>(callback: (tx: typeof transaction) => Promise<T>) {
			try {
				const result = await callback(transaction);
				outcome.committed += 1;
				mocks.events.push("commit");
				return result;
			} catch (error) {
				outcome.rolledBack += 1;
				throw error;
			}
		},
	});
	const adapter = {
		transaction: <T>(callback: (trx: unknown) => Promise<T>) =>
			database.transaction(() => callback({})),
	} as unknown as DBAdapter;
	return { transaction, outcome, context: { adapter } };
}

function hooks() {
	return createCoordinatedOrganizationHooks({
		beforeUpdateOrganization: vi.fn(),
		afterAcceptInvitation: vi.fn(async () => {
			mocks.events.push("after-accept");
		}),
		afterAddMember: vi.fn(async () => {
			mocks.events.push("after-add");
		}),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.events.length = 0;
	mocks.revoke.mockImplementation(async () => {
		mocks.events.push("revoke");
		return { accessRestored: false, sessionTokens: ["token-1"] };
	});
	mocks.postCommit.mockImplementation(async () => {
		mocks.events.push("post-commit");
	});
});

describe("coordinated organization hooks", () => {
	it("protects the member's user in the role update's own transaction", async () => {
		const auth = coordinatedAuth();
		await runCoordinatedAuthMutation(auth.context, () =>
			hooks().beforeUpdateMemberRole!({ member, newRole: "admin", user, organization }),
		);

		expect(mocks.protect).toHaveBeenCalledExactlyOnceWith(auth.transaction, {
			organizationId: "org-1",
			userIds: ["target"],
		});
	});

	it.each([
		["beforeUpdateMemberRole", { member, newRole: "admin", user, organization }],
		["beforeRemoveMember", { member, user, organization }],
		["beforeAddMember", { member, user, organization }],
		["beforeAcceptInvitation", { invitation: {}, user, organization }],
		["beforeDeleteOrganization", { organization, user }],
		["afterRemoveMember", { member, user, organization }],
	] as const)("fails closed when %s runs outside a coordinated transaction", async (name, data) => {
		const hook = hooks()[name] as (input: unknown) => Promise<unknown>;

		await expect(hook(data)).rejects.toBeInstanceOf(UncoordinatedAuthMutationError);
		expect(mocks.protect).not.toHaveBeenCalled();
		expect(mocks.revoke).not.toHaveBeenCalled();
	});

	it("protects the removed, added and accepting users and the deleted organization", async () => {
		const auth = coordinatedAuth();
		const organizationHooks = hooks();
		await runCoordinatedAuthMutation(auth.context, async () => {
			await organizationHooks.beforeRemoveMember!({ member, user, organization });
			await organizationHooks.beforeAddMember!({ member, user, organization });
			await organizationHooks.beforeAcceptInvitation!({
				invitation: {} as never,
				user,
				organization,
			});
			await organizationHooks.beforeDeleteOrganization!({ organization, user });
		});

		expect(mocks.protect.mock.calls).toEqual([
			[auth.transaction, { organizationId: "org-1", userIds: ["target"] }],
			[auth.transaction, { organizationId: "org-1", userIds: ["target"] }],
			[auth.transaction, { organizationId: "org-1", userIds: ["actor"] }],
			[auth.transaction, { organizationId: "org-1", organizationWide: true }],
		]);
	});

	it("revokes access in the removal transaction and clears sessions and seats after commit", async () => {
		const auth = coordinatedAuth();
		const organizationHooks = hooks();
		await runCoordinatedAuthMutation(auth.context, async () => {
			await organizationHooks.beforeRemoveMember!({ member, user, organization });
			await organizationHooks.afterRemoveMember!({ member, user, organization });
			mocks.events.push("removal-end");
		});

		expect(mocks.revoke).toHaveBeenCalledExactlyOnceWith(auth.transaction, "target", "org-1");
		expect(mocks.postCommit).toHaveBeenCalledExactlyOnceWith({
			organizationId: "org-1",
			sessionTokens: ["token-1"],
		});
		expect(mocks.events).toEqual(["revoke", "removal-end", "commit", "post-commit"]);
	});

	it("runs membership provisioning after the membership commits, as before", async () => {
		const auth = coordinatedAuth();
		const organizationHooks = hooks();
		await runCoordinatedAuthMutation(auth.context, async () => {
			await organizationHooks.afterAddMember!({ member, user, organization });
			await organizationHooks.afterAcceptInvitation!({
				invitation: {} as never,
				member,
				user,
				organization,
			});
			mocks.events.push("membership-end");
		});

		expect(mocks.events).toEqual(["membership-end", "commit", "after-add", "after-accept"]);
	});

	it("rolls back the removal when in-transaction access revocation fails", async () => {
		const auth = coordinatedAuth();
		const organizationHooks = hooks();
		mocks.revoke.mockRejectedValueOnce(new Error("revocation failed"));

		await expect(
			runCoordinatedAuthMutation(auth.context, async () => {
				await organizationHooks.beforeRemoveMember!({ member, user, organization });
				await organizationHooks.afterRemoveMember!({ member, user, organization });
			}),
		).rejects.toThrow("revocation failed");
		expect(auth.outcome).toEqual({ committed: 0, rolledBack: 1 });
		expect(mocks.postCommit).not.toHaveBeenCalled();
	});

	it("rolls back a removal whose member was not guarded before the delete", async () => {
		const auth = coordinatedAuth();

		await expect(
			runCoordinatedAuthMutation(auth.context, () =>
				hooks().afterRemoveMember!({ member, user, organization }),
			),
		).rejects.toBeInstanceOf(UncoordinatedAuthMutationError);
		expect(auth.outcome).toEqual({ committed: 0, rolledBack: 1 });
		expect(mocks.revoke).not.toHaveBeenCalled();
	});
});

describe("coordinated auth HTTP mutations", () => {
	const organizationEndpoints = organizationPlugin().endpoints;
	const adminEndpoints = adminPlugin().endpoints;

	it.each([
		organizationEndpoints.updateMemberRole.path,
		organizationEndpoints.removeMember.path,
		organizationEndpoints.leaveOrganization.path,
		organizationEndpoints.acceptInvitation.path,
		organizationEndpoints.deleteOrganization.path,
		adminEndpoints.setRole.path,
		adminEndpoints.banUser.path,
		adminEndpoints.unbanUser.path,
		adminEndpoints.adminUpdateUser.path,
		adminEndpoints.removeUser.path,
	])("coordinates %s", (path) => {
		expect(isCoordinatedAuthMutationPath(path)).toBe(true);
	});

	it("resolves every coordinated endpoint to an HTTP path", () => {
		expect(organizationEndpoints.updateMemberRole.path).toBe("/organization/update-member-role");
		expect(isCoordinatedAuthMutationPath("/organization/get-full-organization")).toBe(false);
	});

	it("passes other requests through without a transaction", async () => {
		const auth = coordinatedAuth();
		const response = await handleCoordinatedAuthRequest(
			auth.context,
			new Request("https://app.test/api/auth/get-session"),
			async () => new Response("ok"),
		);

		expect(await response.text()).toBe("ok");
		expect(auth.outcome).toEqual({ committed: 0, rolledBack: 0 });
	});

	it("commits a successful coordinated request", async () => {
		const auth = coordinatedAuth();
		const response = await handleCoordinatedAuthRequest(
			auth.context,
			new Request("https://app.test/api/auth/organization/update-member-role", {
				method: "POST",
			}),
			async () => Response.json({ ok: true }),
		);

		expect(response.status).toBe(200);
		expect(auth.outcome).toEqual({ committed: 1, rolledBack: 0 });
	});

	it("rolls back a failed coordinated request and still returns its response", async () => {
		const auth = coordinatedAuth();
		const response = await handleCoordinatedAuthRequest(
			auth.context,
			new Request("https://app.test/api/auth/organization/leave/", { method: "POST" }),
			async () => Response.json({ code: "FORBIDDEN" }, { status: 403 }),
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ code: "FORBIDDEN" });
		expect(auth.outcome).toEqual({ committed: 0, rolledBack: 1 });
	});
});
