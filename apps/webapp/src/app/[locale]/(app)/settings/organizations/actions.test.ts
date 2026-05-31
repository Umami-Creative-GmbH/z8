import { beforeEach, describe, expect, it, vi } from "vitest";
import { isOrganizationFeature } from "./organization-features";

const getSessionMock = vi.fn();
const createInvitationMock = vi.fn();
const memberFindFirstMock = vi.fn();
const invitationFindFirstMock = vi.fn();
const teamFindFirstMock = vi.fn();
const userFindFirstMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: getSessionMock,
			createInvitation: createInvitationMock,
		},
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	}),
}));

vi.mock("@/lib/enterprise-identity/enforcement", () => ({
	assertEnterpriseIdentityInvitationAllowed: vi.fn(async () => undefined),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: { findFirst: memberFindFirstMock },
			invitation: { findFirst: invitationFindFirstMock },
			team: { findFirst: teamFindFirstMock },
			user: { findFirst: userFindFirstMock },
		},
		update: vi.fn(() => ({
			set: updateSetMock.mockReturnValue({ where: updateWhereMock }),
		})),
	},
}));

describe("organization feature allowlist", () => {
	it("allows only supported organization feature flags", () => {
		expect(isOrganizationFeature("shiftsEnabled")).toBe(true);
		expect(isOrganizationFeature("projectsEnabled")).toBe(true);
		expect(isOrganizationFeature("surchargesEnabled")).toBe(true);
		expect(isOrganizationFeature("demoDataEnabled")).toBe(true);
		expect(isOrganizationFeature("worksCouncilEnabled")).toBe(true);
		expect(isOrganizationFeature("metadata")).toBe(false);
		expect(isOrganizationFeature("deletedAt")).toBe(false);
	});
});

describe("organization invitation actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getSessionMock.mockResolvedValue({
			user: { id: "user-admin" },
			session: {
				id: "session-id",
				userId: "user-admin",
				expiresAt: new Date("2030-01-01T00:00:00.000Z"),
				token: "token",
				activeOrganizationId: "org-1",
			},
		});
		memberFindFirstMock.mockResolvedValue({
			id: "member-admin",
			userId: "user-admin",
			organizationId: "org-1",
			role: "admin",
		});
		userFindFirstMock.mockResolvedValue(null);
		invitationFindFirstMock.mockResolvedValue(null);
		teamFindFirstMock.mockResolvedValue({
			id: "11111111-1111-4111-8111-111111111111",
			organizationId: "org-1",
		});
		createInvitationMock.mockResolvedValue({ id: "invitation-created" });
		updateWhereMock.mockResolvedValue([{ id: "updated" }]);
	});

	it("rejects a direct invite target team outside the organization", async () => {
		teamFindFirstMock.mockResolvedValue(null);

		const { sendInvitation } = await import("./actions");

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
			targetTeamId: "22222222-2222-4222-8222-222222222222",
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Target team not found in this organization",
		});
		expect(createInvitationMock).not.toHaveBeenCalled();
	});

	it("allows an admin to update the target team for a pending invitation", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			status: "pending",
		});

		const { updateInvitationTargetTeam } = await import("./actions");

		const result = await updateInvitationTargetTeam({
			invitationId: "invite-1",
			organizationId: "org-1",
			targetTeamId: "11111111-1111-4111-8111-111111111111",
		});

		expect(result).toMatchObject({ success: true });
		expect(updateSetMock).toHaveBeenCalledWith({
			targetTeamId: "11111111-1111-4111-8111-111111111111",
		});
	});
});
