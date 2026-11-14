import { describe, expect, it } from "vitest";
import { resolveInvitationTargetTeamId } from "./organization-joining-hooks";

type LookupDb = Parameters<typeof resolveInvitationTargetTeamId>[0];
const TEAM_ID = "11111111-1111-4111-8111-111111111111";

function teamLookup(findFirst: () => Promise<{ id: string } | null | undefined>) {
	return { query: { team: { findFirst } } } as unknown as LookupDb;
}

describe("resolveInvitationTargetTeamId", () => {
	it("returns valid stored target team ids that still exist in the invitation organization", async () => {
		await expect(
			resolveInvitationTargetTeamId(
				teamLookup(async () => ({ id: TEAM_ID })),
				"org-1",
				TEAM_ID,
			),
		).resolves.toBe(TEAM_ID);
	});

	it("falls back to null without querying for missing or malformed stored target team ids", async () => {
		const db = teamLookup(async () => {
			throw new Error("Team lookup should not run");
		});

		await expect(resolveInvitationTargetTeamId(db, "org-1", null)).resolves.toBeNull();
		await expect(resolveInvitationTargetTeamId(db, "org-1", undefined)).resolves.toBeNull();
		await expect(resolveInvitationTargetTeamId(db, "org-1", "not-a-uuid")).resolves.toBeNull();
	});

	it("falls back to null when the stored target team was deleted", async () => {
		await expect(
			resolveInvitationTargetTeamId(
				teamLookup(async () => undefined),
				"org-1",
				TEAM_ID,
			),
		).resolves.toBeNull();
	});
});
