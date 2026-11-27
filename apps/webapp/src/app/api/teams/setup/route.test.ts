import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	getSession: vi.fn(),
	headers: vi.fn(),
	getAbility: vi.fn(),
	teamsTenantFindFirst: vi.fn(),
	requireActiveActor: vi.fn(),
	disconnectLegacyTeamsTenantInstallation: vi.fn(),
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return {
		...actual,
		connection: vi.fn().mockResolvedValue(undefined),
	};
});

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAbility: mockState.getAbility,
}));

vi.mock("@/lib/auth/organization-action-authorization", () => ({
	runActiveOrganizationActionActorCheck: mockState.requireActiveActor,
}));

vi.mock("@/lib/chat-installations/teams-switch", () => ({
	disconnectLegacyTeamsTenantInstallation: mockState.disconnectLegacyTeamsTenantInstallation,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	}),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			teamsTenantConfig: { findFirst: mockState.teamsTenantFindFirst },
		},
	},
}));

vi.mock("@/db/schema", () => ({
	teamsTenantConfig: {
		id: "teamsTenantConfig.id",
		tenantId: "teamsTenantConfig.tenantId",
		organizationId: "teamsTenantConfig.organizationId",
	},
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = await importOriginal<typeof import("drizzle-orm")>();
	return {
		...actual,
		and: (...args: unknown[]) => args,
		eq: (...args: unknown[]) => args,
	};
});

const { DELETE, POST } = await import("./route");

function createDeleteRequest(organizationId: string, tenantId?: string): NextRequest {
	const url = new URL("https://app.example.com/api/teams/setup");
	url.searchParams.set("organizationId", organizationId);
	if (tenantId) url.searchParams.set("tenantId", tenantId);
	return new Request(url, { method: "DELETE" }) as NextRequest;
}

describe("/api/teams/setup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-active" },
		});
		mockState.getAbility.mockResolvedValue({
			cannot: vi.fn().mockReturnValue(false),
		});
		mockState.teamsTenantFindFirst.mockResolvedValue(null);
		mockState.requireActiveActor.mockResolvedValue({});
		mockState.disconnectLegacyTeamsTenantInstallation.mockResolvedValue({
			kind: "disconnected",
			tenantId: "tenant-1",
			installationId: "inst-1",
		});
	});

	it("returns 410 Gone for retired legacy POST setup", async () => {
		const response = await POST();

		expect(response.status).toBe(410);
		expect(await response.json()).toMatchObject({ code: "legacy_setup_superseded" });
	});

	it.each(["pending", "rejected", "inactive"])(
		"denies a %s actor before disconnecting the legacy tenant",
		async (actorState) => {
			mockState.getSession.mockResolvedValue({
				user: { id: "user-1" },
				session: { activeOrganizationId: "org-target" },
			});
			mockState.requireActiveActor.mockRejectedValueOnce(new Error(actorState));

			const response = await DELETE(createDeleteRequest("org-target", "tenant-1"));

			expect(response.status).toBe(403);
			expect(mockState.disconnectLegacyTeamsTenantInstallation).not.toHaveBeenCalled();
		},
	);

	it("rejects disconnect for a non-active target organization", async () => {
		const response = await DELETE(createDeleteRequest("org-target", "tenant-1"));

		expect(response.status).toBe(403);
		expect(mockState.getAbility).not.toHaveBeenCalled();
		expect(mockState.disconnectLegacyTeamsTenantInstallation).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({ error: "Access denied" });
	});
});
