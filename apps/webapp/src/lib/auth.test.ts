import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInvitationTargetTeamId } from "./auth";

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
		expect(acceptInvitationHook).toContain("change: \"added\"");
	});
});
