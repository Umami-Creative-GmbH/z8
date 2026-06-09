import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { makeEmailLookupCaseInsensitiveAdapter, resolveInvitationTargetTeamId } from "./auth";

describe("resolveInvitationTargetTeamId", () => {
	it("returns valid stored target team ids that still exist in the invitation organization", async () => {
		const db = {
			query: {
				team: {
					findFirst: async () => ({ id: "11111111-1111-4111-8111-111111111111" }),
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
			source.indexOf("// Create employee record when user is added to organization"),
		);

		expect(acceptInvitationHook).toContain("syncBillingSeats");
		expect(acceptInvitationHook).toContain('change: "added"');
	});

	it("passes invitation id into employee provisioning", () => {
		const source = readFileSync(join(process.cwd(), "src/lib/auth.ts"), "utf8");
		const acceptInvitationHook = source.slice(
			source.indexOf("afterAcceptInvitation"),
			source.indexOf("// Create employee record when user is added to organization"),
		);
		expect(acceptInvitationHook).toContain("invitationId: invitation.id");
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
			where: [{ field: "email", value: "USER@Example.com", mode: "insensitive" }],
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
		const findOne = vi.fn(async () => null);
		const create = vi.fn();
		const adapter = { create, findOne } as any;
		const wrapped = makeEmailLookupCaseInsensitiveAdapter(adapter);

		expect(wrapped.create).toBe(adapter.create);
	});
});
