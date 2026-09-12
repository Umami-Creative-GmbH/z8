import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	allowed: vi.fn(),
	generate: vi.fn(),
	unlink: vi.fn(),
	membership: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async () => ({
	...(await vi.importActual("next/server")),
	connection: async () => {},
}));
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: "actor" },
				session: {
					id: "password-session",
					userId: "actor",
					activeOrganizationId: "open",
				},
			}),
		},
	},
}));
vi.mock("@/lib/auth-helpers", () => ({ verifyOrgMembership: mocks.allowed }));
vi.mock("@/lib/slack/user-resolver", () => ({
	generateLinkCode: mocks.generate,
	unlinkSlackUser: mocks.unlink,
}));
vi.mock("@/lib/telegram", () => ({
	generateLinkCode: mocks.generate,
	unlinkTelegramUser: mocks.unlink,
	isTelegramEnabledForOrganization: async () => true,
}));
vi.mock("@/lib/discord", () => ({
	generateLinkCode: mocks.generate,
	unlinkDiscordUser: mocks.unlink,
	isDiscordEnabledForOrganization: async () => true,
}));
vi.mock("@/db", () => ({
	db: {
		select: () => ({
			from: () => ({ where: () => ({ limit: mocks.membership }) }),
		}),
	},
}));

describe("nonactive SSO org chat account linking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.allowed.mockResolvedValue({ isValid: false });
		mocks.membership.mockResolvedValue([{ role: "owner" }]);
		mocks.generate.mockResolvedValue({ code: "link", expiresAt: new Date() });
		mocks.unlink.mockResolvedValue(true);
	});
	it.each(["slack", "telegram", "discord"])(
		"%s blocks link creation/deletion before sensitive operations despite membership",
		async (provider) => {
			const route =
				provider === "slack"
					? await import("../slack/link/route")
					: provider === "telegram"
						? await import("../telegram/link/route")
						: await import("../discord/link/route");
			const post = await route.POST(
				new Request(`https://app.test/api/${provider}/link`, {
					method: "POST",
					body: JSON.stringify({ organizationId: "locked" }),
				}) as never,
			);
			const deletion = await route.DELETE(
				new Request(
					`https://app.test/api/${provider}/link?organizationId=locked`,
					{ method: "DELETE" },
				) as never,
			);
			expect(post.status).toBe(403);
			expect(deletion.status).toBe(403);
			expect(mocks.generate).not.toHaveBeenCalled();
			expect(mocks.unlink).not.toHaveBeenCalled();
			mocks.allowed.mockResolvedValue({ isValid: true });
			expect(
				(
					await route.POST(
						new Request(`https://app.test/api/${provider}/link`, {
							method: "POST",
							body: JSON.stringify({ organizationId: "open" }),
						}) as never,
					)
				).status,
			).toBe(200);
		},
	);
});
