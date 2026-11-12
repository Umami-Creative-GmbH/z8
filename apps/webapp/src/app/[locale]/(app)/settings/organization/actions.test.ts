import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";
import { isOrganizationFeature } from "./organization-features";

const mocks = vi.hoisted(() => {
	const updateWhere = vi.fn();
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const onConflictDoUpdate = vi.fn();
	const insertValues = vi.fn(() => ({ onConflictDoUpdate }));
	return {
		caller: null as StubCaller | null,
		coordination: { inside: false, updatesInside: 0 },
		db: {
			query: {
				member: { findFirst: vi.fn() },
				invitation: { findFirst: vi.fn() },
				employeeInvitationDraft: { findFirst: vi.fn() },
				team: { findFirst: vi.fn() },
				user: { findFirst: vi.fn() },
				organization: { findFirst: vi.fn() },
			},
			update: vi.fn(() => ({ set: updateSet })),
			insert: vi.fn(() => ({ values: insertValues })),
		},
		updateSet,
		updateWhere,
		insertValues,
		onConflictDoUpdate,
		headers: vi.fn(),
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
		assertInvitationAllowed: vi.fn(),
		persistDraft: vi.fn(),
		syncTargetTeam: vi.fn(),
		changeTimezone: vi.fn(),
		rebuildIntents: vi.fn(),
		revokeShareLinks: vi.fn(),
		pauseSchedules: vi.fn(),
		sendDeletionNotifications: vi.fn(),
	};
});

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: mocks.db }));
});
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/logger", () => ({ createLogger: () => mocks.logger }));
// Role updates must commit inside the coordinated Better Auth transaction (#314).
vi.mock("@/lib/auth/auth-transaction", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth/auth-transaction")>()),
	runCoordinatedAuthMutation: async (_context: unknown, mutation: () => Promise<unknown>) => {
		mocks.coordination.inside = true;
		try {
			return await mutation();
		} finally {
			mocks.coordination.inside = false;
		}
	},
}));
vi.mock("@/lib/auth/employee-invitation-draft", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/auth/employee-invitation-draft")>()),
	persistEmployeeInvitationDraft: mocks.persistDraft,
	syncInvitationTargetTeam: mocks.syncTargetTeam,
}));
vi.mock("@/lib/enterprise-identity/enforcement", () => ({
	assertEnterpriseIdentityInvitationAllowed: mocks.assertInvitationAllowed,
}));
vi.mock("@/lib/timezone/organization-timezone-change", () => ({
	changeOrganizationTimezone: mocks.changeTimezone,
}));
vi.mock("@/lib/work-balance/rebuild-intents", () => ({
	processWorkBalanceRebuildIntents: mocks.rebuildIntents,
	failureMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
vi.mock("@/lib/projects/report-share/access-change", () => ({
	revokeShareLinksAfterAccessChange: mocks.revokeShareLinks,
}));
vi.mock("@/lib/scheduled-exports/application/owner-access-change", () => ({
	pauseSchedulesAfterOwnerAccessChange: mocks.pauseSchedules,
}));
vi.mock("@/lib/jobs/organization-deletion-notification", () => ({
	sendOrganizationDeletionNotifications: mocks.sendDeletionNotifications,
}));

const { auth } = await import("@/lib/auth");
const {
	cancelInvitation,
	deleteOrganization,
	recoverOrganization,
	removeOrganizationLogo,
	resendInvitation,
	sendInvitation,
	toggleOrganizationFeature,
	updateInvitationTargetTeam,
	updateMemberRole,
	updateOrganizationDefaultNotificationLanguage,
	updateOrganizationDetails,
	updateOrganizationTimezone,
} = await import("./actions");

const owner: StubCaller = {
	userId: "user-owner",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: { id: "employee-owner", role: "admin", former: false },
};
const orgAdmin: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "user-manager",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-manager", role: "manager", former: false },
};
const formerAdmin: StubCaller = {
	...orgAdmin,
	employee: { id: "employee-admin", role: "admin", former: true },
};

const TEAM_ID = "11111111-1111-4111-8111-111111111111";
const pendingInvitation = {
	id: "invite-old",
	organizationId: "org-1",
	email: "invitee@example.com",
	role: "member",
	status: "pending",
	expiresAt: new Date("2100-01-01T00:00:00.000Z"),
	targetTeamId: null,
	canCreateOrganizations: false,
};

const api = {
	createInvitation: vi.fn(),
	cancelInvitation: vi.fn(),
	updateMemberRole: vi.fn(),
	updateOrganization: vi.fn(),
};
const whereParams = (mock: { mock: { calls: unknown[][] } }, call = 0) =>
	new PgDialect().sqlToQuery(
		(mock.mock.calls[call]?.[0] as { where: never } | undefined)?.where as never,
	).params;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	vi.spyOn(auth.api, "createInvitation").mockImplementation(api.createInvitation as never);
	vi.spyOn(auth.api, "cancelInvitation").mockImplementation(api.cancelInvitation as never);
	vi.spyOn(auth.api, "updateOrganization").mockImplementation(api.updateOrganization as never);
	vi.spyOn(auth.api, "updateMemberRole").mockImplementation(((input: unknown) => {
		if (mocks.coordination.inside) mocks.coordination.updatesInside += 1;
		return api.updateMemberRole(input);
	}) as never);
	mocks.coordination.updatesInside = 0;
	mocks.headers.mockResolvedValue(new Headers({ cookie: "session=token" }));
	mocks.db.query.member.findFirst.mockResolvedValue(null);
	mocks.db.query.invitation.findFirst.mockResolvedValue(null);
	mocks.db.query.employeeInvitationDraft.findFirst.mockResolvedValue({
		invitationId: "invite-old",
	});
	mocks.db.query.team.findFirst.mockResolvedValue({ id: TEAM_ID, organizationId: "org-1" });
	mocks.db.query.user.findFirst.mockResolvedValue(null);
	mocks.db.query.organization.findFirst.mockResolvedValue({
		id: "org-1",
		name: "Organization One",
		deletedAt: null,
	});
	mocks.updateWhere.mockResolvedValue(undefined);
	mocks.onConflictDoUpdate.mockResolvedValue(undefined);
	mocks.assertInvitationAllowed.mockResolvedValue(undefined);
	mocks.persistDraft.mockResolvedValue({ outcome: "persisted" });
	mocks.syncTargetTeam.mockResolvedValue(undefined);
	mocks.changeTimezone.mockResolvedValue({ status: "changed", rebuild: "intent" });
	mocks.rebuildIntents.mockResolvedValue({ organizationsRebuilt: 1, failures: [] });
	mocks.revokeShareLinks.mockResolvedValue(undefined);
	mocks.pauseSchedules.mockResolvedValue(undefined);
	mocks.sendDeletionNotifications.mockResolvedValue(undefined);
	api.createInvitation.mockResolvedValue({ id: "invitation-created" });
	api.cancelInvitation.mockResolvedValue({});
	api.updateMemberRole.mockResolvedValue({});
	api.updateOrganization.mockResolvedValue({});
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe("organization feature allowlist", () => {
	it("allows only supported organization feature flags", () => {
		for (const feature of [
			"shiftsEnabled",
			"projectsEnabled",
			"surchargesEnabled",
			"demoDataEnabled",
			"worksCouncilEnabled",
			"personnelFilesEnabled",
			"equipmentEnabled",
		]) {
			expect(isOrganizationFeature(feature)).toBe(true);
		}
		expect(isOrganizationFeature("metadata")).toBe(false);
		expect(isOrganizationFeature("deletedAt")).toBe(false);
	});
});

describe("settings access of each organization action", () => {
	const orgAdminActions = [
		["sendInvitation", () => sendInvitation({ email: "invitee@example.com", role: "member" })],
		["resendInvitation", () => resendInvitation("invite-old")],
		[
			"updateInvitationTargetTeam",
			() => updateInvitationTargetTeam({ invitationId: "invite-old", targetTeamId: null }),
		],
		["cancelInvitation", () => cancelInvitation("invite-old")],
		[
			"toggleOrganizationFeature (personnel files)",
			() => toggleOrganizationFeature({ feature: "personnelFilesEnabled", enabled: true }),
		],
		[
			"updateOrganizationDefaultNotificationLanguage",
			() => updateOrganizationDefaultNotificationLanguage("de"),
		],
		["deleteOrganization", () => deleteOrganization({ confirmationName: "Organization One" })],
		["recoverOrganization", () => recoverOrganization()],
	] as const;
	const ownerActions = [
		["updateMemberRole", () => updateMemberRole({ memberId: "target-member", role: "admin" })],
		["updateOrganizationDetails", () => updateOrganizationDetails({ name: "Renamed" })],
		["removeOrganizationLogo", () => removeOrganizationLogo()],
		[
			"toggleOrganizationFeature (shifts)",
			() => toggleOrganizationFeature({ feature: "shiftsEnabled", enabled: true }),
		],
		["updateOrganizationTimezone", () => updateOrganizationTimezone("America/New_York")],
	] as const;

	const writes = () => [
		api.createInvitation,
		api.cancelInvitation,
		api.updateMemberRole,
		api.updateOrganization,
		mocks.persistDraft,
		mocks.syncTargetTeam,
		mocks.updateSet,
		mocks.insertValues,
		mocks.changeTimezone,
	];

	it.each(orgAdminActions)("refuses %s to a scoped manager", async (_name, run) => {
		mocks.caller = scopedManager;

		expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
		for (const write of writes()) expect(write).not.toHaveBeenCalled();
	});

	it.each(ownerActions)(
		"refuses %s to an org admin, since it stays owner-only",
		async (_name, run) => {
			mocks.caller = orgAdmin;

			expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
			for (const write of writes()) expect(write).not.toHaveBeenCalled();
		},
	);

	it.each([
		["a former admin", formerAdmin],
		["a pending membership", { ...orgAdmin, membershipRole: null }],
		["a refused SSO session", { ...orgAdmin, organizationAccessRefused: true }],
		["a signed-out caller", null],
	])("refuses invitation actions to %s", async (_case, caller) => {
		mocks.caller = caller;
		mocks.db.query.invitation.findFirst.mockResolvedValue(pendingInvitation);

		for (const [, run] of orgAdminActions.slice(0, 4)) {
			expect(await run()).toMatchObject({ success: false });
		}
		for (const write of writes()) expect(write).not.toHaveBeenCalled();
	});

	it("refuses a former owner before any owner-only mutation", async () => {
		mocks.caller = { ...owner, employee: { id: "employee-owner", role: "admin", former: true } };

		for (const [, run] of ownerActions) {
			expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
		}
		for (const write of writes()) expect(write).not.toHaveBeenCalled();
	});
});

describe("sendInvitation", () => {
	it("invites through Better Auth with the normalized email and records the draft", async () => {
		api.createInvitation.mockResolvedValue({ id: "better-auth-invitation" });

		const result = await sendInvitation({
			email: "  Invitee@Example.COM  ",
			role: "admin",
			canCreateOrganizations: true,
			targetTeamId: TEAM_ID,
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(api.createInvitation).toHaveBeenCalledWith({
			body: { organizationId: "org-1", email: "invitee@example.com", role: "admin", resend: false },
			headers: expect.any(Headers),
		});
		expect(mocks.persistDraft).toHaveBeenCalledWith(mocks.db, {
			organizationId: "org-1",
			normalizedEmail: "invitee@example.com",
			invitationId: "better-auth-invitation",
			canCreateOrganizations: true,
			targetTeamId: TEAM_ID,
			initialRole: "admin",
			updatedBy: "user-admin",
		});
		expect(whereParams(mocks.db.query.team.findFirst)).toEqual([TEAM_ID, "org-1"]);
	});

	it("refuses a submitted organization ID instead of trusting it", async () => {
		const result = await sendInvitation({
			organizationId: "org-other",
			email: "invitee@example.com",
			role: "member",
		} as Parameters<typeof sendInvitation>[0]);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(api.createInvitation).not.toHaveBeenCalled();
	});

	it.each([
		["an invalid email", { email: "not-an-email" }, "Invalid email address"],
		["an unknown role", { role: "superuser" }, "Role must be owner, admin, or member"],
	])("refuses %s before inviting", async (_case, overrides, error) => {
		const result = await sendInvitation({
			email: "invitee@example.com",
			role: "member",
			...overrides,
		} as Parameters<typeof sendInvitation>[0]);

		expect(result).toMatchObject({ success: false, code: "ValidationError", error });
		expect(api.createInvitation).not.toHaveBeenCalled();
	});

	it("rejects a target team outside the organization", async () => {
		mocks.db.query.team.findFirst.mockResolvedValue(null);

		expect(
			await sendInvitation({ email: "invitee@example.com", role: "member", targetTeamId: TEAM_ID }),
		).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Target team not found in this organization",
		});
		expect(api.createInvitation).not.toHaveBeenCalled();
	});

	it("refuses an address the enterprise identity restriction does not allow", async () => {
		mocks.assertInvitationAllowed.mockRejectedValue(
			new Error("Email must use the enterprise identity domain acme.test"),
		);

		expect(await sendInvitation({ email: "invitee@example.com", role: "member" })).toMatchObject({
			success: false,
			error: "Email must use the enterprise identity domain acme.test",
		});
		expect(mocks.assertInvitationAllowed).toHaveBeenCalledWith({
			organizationId: "org-1",
			email: "invitee@example.com",
		});
		expect(api.createInvitation).not.toHaveBeenCalled();
	});

	it("repairs app-owned fields on an existing actionable invitation without sending again", async () => {
		mocks.db.query.invitation.findFirst.mockResolvedValue({
			...pendingInvitation,
			id: "invite-existing",
		});

		const result = await sendInvitation({
			email: "invitee@example.com",
			role: "member",
			canCreateOrganizations: true,
			targetTeamId: TEAM_ID,
		});

		expect(result).toMatchObject({
			success: false,
			error: "An invitation for this email is already pending",
		});
		expect(api.createInvitation).not.toHaveBeenCalled();
		expect(mocks.persistDraft).toHaveBeenCalledWith(
			mocks.db,
			expect.objectContaining({
				invitationId: "invite-existing",
				canCreateOrganizations: true,
				targetTeamId: TEAM_ID,
			}),
		);
		expect(whereParams(mocks.db.query.invitation.findFirst)).toEqual(
			expect.arrayContaining(["org-1", "invitee@example.com", "pending"]),
		);
	});

	it("treats acceptance between Better Auth send and app persistence as completed", async () => {
		mocks.persistDraft.mockResolvedValue({ outcome: "consumed" });

		expect(await sendInvitation({ email: "invitee@example.com", role: "member" })).toEqual({
			success: true,
			data: undefined,
		});
		expect(api.createInvitation).toHaveBeenCalledOnce();
	});

	it("does not block on an expired pending invitation", async () => {
		mocks.db.query.invitation.findFirst.mockResolvedValue({
			...pendingInvitation,
			expiresAt: new Date("2000-01-01T00:00:00.000Z"),
		});

		expect(await sendInvitation({ email: "invitee@example.com", role: "member" })).toMatchObject({
			success: true,
		});
		expect(api.createInvitation).toHaveBeenCalledOnce();
	});

	it("refuses to invite a user who is already a member", async () => {
		mocks.db.query.user.findFirst.mockResolvedValue({ id: "user-existing" });
		mocks.db.query.member.findFirst.mockResolvedValue({ id: "member-existing" });

		expect(await sendInvitation({ email: "invitee@example.com", role: "member" })).toMatchObject({
			success: false,
			error: "This user is already a member of the organization",
		});
		expect(whereParams(mocks.db.query.member.findFirst)).toEqual(["user-existing", "org-1"]);
		expect(api.createInvitation).not.toHaveBeenCalled();
	});

	it.each([
		["Better Auth refuses the send", "createInvitation", undefined],
		[
			"the draft cannot be persisted after the email",
			"persistInvitationState",
			"better-auth-invitation",
		],
	])("returns a safe error and logs IDs when %s", async (_case, failurePhase, invitationId) => {
		const secret = "select * where email=invitee@example.com token=auth-secret";
		if (failurePhase === "createInvitation") {
			api.createInvitation.mockRejectedValue(new Error(secret));
		} else {
			api.createInvitation.mockResolvedValue({ id: "better-auth-invitation" });
			mocks.persistDraft.mockRejectedValue(new Error(secret));
		}

		const result = await sendInvitation({ email: "invitee@example.com", role: "member" });

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Failed to send invitation",
		});
		expect(mocks.logger.error).toHaveBeenCalledWith(
			{
				operation: "sendInvitation",
				failurePhase,
				organizationId: "org-1",
				...(invitationId ? { invitationId } : {}),
			},
			"Failed to send invitation",
		);
		expect(JSON.stringify([result, mocks.logger.error.mock.calls])).not.toContain(secret);
	});
});

describe("resendInvitation", () => {
	beforeEach(() => {
		mocks.db.query.invitation.findFirst.mockResolvedValue(pendingInvitation);
		api.createInvitation.mockResolvedValue({ id: "invite-replacement" });
	});

	it("resends with the normalized email and same role, and relinks the stable draft", async () => {
		mocks.db.query.invitation.findFirst.mockResolvedValue({
			...pendingInvitation,
			email: "  Invitee@Example.COM  ",
			role: "admin",
			targetTeamId: TEAM_ID,
			canCreateOrganizations: true,
		});

		expect(await resendInvitation("invite-old")).toEqual({ success: true, data: undefined });
		expect(api.createInvitation).toHaveBeenCalledWith({
			body: { organizationId: "org-1", email: "invitee@example.com", role: "admin", resend: true },
			headers: expect.any(Headers),
		});
		expect(api.cancelInvitation).not.toHaveBeenCalled();
		expect(mocks.persistDraft).toHaveBeenCalledWith(mocks.db, {
			organizationId: "org-1",
			normalizedEmail: "invitee@example.com",
			invitationId: "invite-replacement",
			canCreateOrganizations: true,
			targetTeamId: TEAM_ID,
			initialRole: "admin",
			updatedBy: "user-admin",
		});
	});

	it("treats another organization's invitation as not found", async () => {
		mocks.db.query.invitation.findFirst.mockResolvedValue(null);

		expect(await resendInvitation("other-org-invitation")).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(whereParams(mocks.db.query.invitation.findFirst)).toEqual([
			"other-org-invitation",
			"org-1",
		]);
		expect(api.createInvitation).not.toHaveBeenCalled();
	});

	it.each([
		["a source that no longer owns the stable draft", { invitationId: "invite-newer" }, {}],
		[
			"an invitation that is no longer pending",
			{ invitationId: "invite-old" },
			{ status: "accepted" },
		],
	])("refuses to resend %s", async (_case, draft, invitation) => {
		mocks.db.query.employeeInvitationDraft.findFirst.mockResolvedValue(draft);
		mocks.db.query.invitation.findFirst.mockResolvedValue({ ...pendingInvitation, ...invitation });

		expect(await resendInvitation("invite-old")).toMatchObject({
			success: false,
			error: "Invitation cannot be resent",
		});
		expect(api.createInvitation).not.toHaveBeenCalled();
	});

	it("checks the enterprise identity restriction before resending", async () => {
		mocks.assertInvitationAllowed.mockRejectedValue(new Error("Email must use acme.test"));

		expect(await resendInvitation("invite-old")).toMatchObject({
			success: false,
			error: "Email must use acme.test",
		});
		expect(api.createInvitation).not.toHaveBeenCalled();
	});

	it("does not report post-email persistence failure as a resend failure", async () => {
		mocks.persistDraft.mockRejectedValue(new Error("database detail"));

		expect(await resendInvitation("invite-old")).toMatchObject({ success: true });
		expect(mocks.logger.warn).toHaveBeenCalledWith(
			{
				operation: "repairResentInvitationPersistence",
				organizationId: "org-1",
				invitationId: "invite-replacement",
			},
			"Resent invitation requires app-state repair",
		);
	});

	it("returns a safe error when Better Auth refuses the resend", async () => {
		api.createInvitation.mockRejectedValue(new Error("token=auth-secret"));

		const result = await resendInvitation("invite-old");

		expect(result).toMatchObject({ success: false, error: "Failed to resend invitation" });
		expect(JSON.stringify(result)).not.toContain("auth-secret");
	});
});

describe("updateInvitationTargetTeam", () => {
	beforeEach(() => {
		mocks.db.query.invitation.findFirst.mockResolvedValue(pendingInvitation);
	});

	it("moves a pending invitation of the session's organization to a team", async () => {
		expect(
			await updateInvitationTargetTeam({ invitationId: "invite-old", targetTeamId: TEAM_ID }),
		).toEqual({ success: true, data: undefined });
		expect(whereParams(mocks.db.query.invitation.findFirst)).toEqual([
			"invite-old",
			"org-1",
			"pending",
		]);
		expect(mocks.syncTargetTeam).toHaveBeenCalledWith(mocks.db, {
			organizationId: "org-1",
			invitationId: "invite-old",
			email: "invitee@example.com",
			targetTeamId: TEAM_ID,
		});
	});

	it("clears the target team", async () => {
		await updateInvitationTargetTeam({ invitationId: "invite-old", targetTeamId: null });

		expect(mocks.syncTargetTeam).toHaveBeenCalledWith(
			mocks.db,
			expect.objectContaining({ targetTeamId: null }),
		);
		expect(mocks.db.query.team.findFirst).not.toHaveBeenCalled();
	});

	it.each([
		["a malformed team ID", { targetTeamId: "not-a-uuid" }, "Invalid target team", () => null],
		[
			"a team outside the organization",
			{ targetTeamId: TEAM_ID },
			"Target team not found in this organization",
			() => mocks.db.query.team.findFirst.mockResolvedValue(null),
		],
	])("refuses %s", async (_case, input, error, arrange) => {
		arrange();

		expect(
			await updateInvitationTargetTeam({ invitationId: "invite-old", ...input }),
		).toMatchObject({ success: false, code: "ValidationError", error });
		expect(mocks.syncTargetTeam).not.toHaveBeenCalled();
	});

	it("treats a missing pending invitation as not found", async () => {
		mocks.db.query.invitation.findFirst.mockResolvedValue(null);

		expect(
			await updateInvitationTargetTeam({ invitationId: "invite-other", targetTeamId: null }),
		).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mocks.syncTargetTeam).not.toHaveBeenCalled();
	});
});

describe("cancelInvitation", () => {
	it("cancels an invitation of the session's organization", async () => {
		mocks.db.query.invitation.findFirst.mockResolvedValue(pendingInvitation);

		expect(await cancelInvitation("invite-old")).toEqual({ success: true, data: undefined });
		expect(whereParams(mocks.db.query.invitation.findFirst)).toEqual(["invite-old", "org-1"]);
		expect(api.cancelInvitation).toHaveBeenCalledWith({
			body: { invitationId: "invite-old" },
			headers: expect.any(Headers),
		});
	});

	it("treats another organization's invitation as not found", async () => {
		expect(await cancelInvitation("invite-other-org")).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(api.cancelInvitation).not.toHaveBeenCalled();
	});

	it("returns a fixed safe error when Better Auth refuses", async () => {
		mocks.db.query.invitation.findFirst.mockResolvedValue(pendingInvitation);
		api.cancelInvitation.mockRejectedValue(new Error("secret detail"));

		const result = await cancelInvitation("invite-old");

		expect(result).toMatchObject({ success: false, error: "Failed to cancel invitation" });
		expect(JSON.stringify(result)).not.toContain("secret");
	});
});

describe("updateMemberRole", () => {
	beforeEach(() => {
		mocks.caller = owner;
		mocks.db.query.member.findFirst.mockResolvedValue({
			id: "target-member",
			userId: "target-user",
			status: "approved",
		});
	});

	it("updates an approved member of the session's organization inside the auth transaction", async () => {
		expect(await updateMemberRole({ memberId: "target-member", role: "admin" })).toEqual({
			success: true,
			data: undefined,
		});
		expect(whereParams(mocks.db.query.member.findFirst)).toEqual([
			"target-member",
			"org-1",
			"approved",
		]);
		expect(mocks.coordination.updatesInside).toBe(1);
		expect(api.updateMemberRole).toHaveBeenCalledExactlyOnceWith({
			body: { organizationId: "org-1", memberId: "target-member", role: "admin" },
			headers: expect.any(Headers),
		});
		expect(mocks.revokeShareLinks).toHaveBeenCalledWith(mocks.db, {
			organizationId: "org-1",
			creator: { userId: "target-user" },
			actorUserId: "user-owner",
		});
		expect(mocks.pauseSchedules).toHaveBeenCalledWith(mocks.db, {
			organizationId: "org-1",
			owner: { userId: "target-user" },
			actorUserId: "user-owner",
		});
	});

	it("treats a missing or unapproved target as not found", async () => {
		mocks.db.query.member.findFirst.mockResolvedValue(undefined);

		expect(await updateMemberRole({ memberId: "target-member", role: "admin" })).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(api.updateMemberRole).not.toHaveBeenCalled();
	});

	it("rejects a self-role update", async () => {
		mocks.db.query.member.findFirst.mockResolvedValue({
			id: "owner-member",
			userId: "user-owner",
			status: "approved",
		});

		expect(await updateMemberRole({ memberId: "owner-member", role: "member" })).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "You cannot change your own organization role",
		});
		expect(api.updateMemberRole).not.toHaveBeenCalled();
	});

	it("refuses an unknown role", async () => {
		expect(
			await updateMemberRole({ memberId: "target-member", role: "root" } as never),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(api.updateMemberRole).not.toHaveBeenCalled();
	});

	it("returns a safe error while preserving Better Auth owner protections", async () => {
		api.updateMemberRole.mockRejectedValue(new Error("secret database trigger detail"));

		const result = await updateMemberRole({ memberId: "target-member", role: "member" });

		expect(result).toMatchObject({ success: false, error: "Failed to update member role" });
		expect(JSON.stringify(result)).not.toContain("secret");
		expect(mocks.revokeShareLinks).not.toHaveBeenCalled();
	});
});

describe("organization details", () => {
	beforeEach(() => {
		mocks.caller = owner;
	});

	it("updates the session organization's name and metadata through Better Auth", async () => {
		expect(
			await updateOrganizationDetails({ name: "Renamed", metadata: '{"description":"Hi"}' }),
		).toEqual({ success: true, data: undefined });
		expect(api.updateOrganization).toHaveBeenCalledWith({
			body: { organizationId: "org-1", data: { name: "Renamed", metadata: { description: "Hi" } } },
			headers: expect.any(Headers),
		});
	});

	it("refuses an invalid slug", async () => {
		expect(await updateOrganizationDetails({ slug: "Not Valid" })).toMatchObject({
			success: false,
			code: "ValidationError",
		});
		expect(api.updateOrganization).not.toHaveBeenCalled();
	});

	it("removes the session organization's logo", async () => {
		expect(await removeOrganizationLogo()).toEqual({ success: true, data: undefined });
		expect(mocks.updateSet).toHaveBeenCalledWith({ logo: null });
		expect(new PgDialect().sqlToQuery(mocks.updateWhere.mock.calls[0]?.[0]).params).toEqual([
			"org-1",
		]);
	});
});

describe("toggleOrganizationFeature", () => {
	it.each(["personnelFilesEnabled", "equipmentEnabled"] as const)(
		"lets an org admin switch %s",
		async (feature) => {
			expect(await toggleOrganizationFeature({ feature, enabled: false })).toEqual({
				success: true,
				data: undefined,
			});
			expect(mocks.updateSet).toHaveBeenCalledWith({ [feature]: false });
		},
	);

	it("steps an org admin up to owner for every other feature", async () => {
		expect(
			await toggleOrganizationFeature({ feature: "shiftsEnabled", enabled: true }),
		).toMatchObject({ success: false, code: "AuthorizationError" });

		mocks.caller = owner;
		expect(
			await toggleOrganizationFeature({ feature: "shiftsEnabled", enabled: true }),
		).toMatchObject({ success: true });
		expect(mocks.updateSet).toHaveBeenCalledExactlyOnceWith({ shiftsEnabled: true });
	});

	it("switches Billable Time off with projects", async () => {
		mocks.caller = owner;

		await toggleOrganizationFeature({ feature: "projectsEnabled", enabled: false });

		expect(mocks.updateSet).toHaveBeenCalledWith({
			projectsEnabled: false,
			billableTimeEnabled: false,
		});
	});

	it.each([
		["an unknown column", "deletedAt", "Invalid organization feature"],
		[
			"Billable Time, which has its own switch",
			"billableTimeEnabled",
			"This feature has its own switch",
		],
	])("refuses %s", async (_case, feature, error) => {
		mocks.caller = owner;

		expect(await toggleOrganizationFeature({ feature, enabled: true } as never)).toMatchObject({
			success: false,
			code: "ValidationError",
			error,
		});
		expect(mocks.updateSet).not.toHaveBeenCalled();
	});
});

describe("updateOrganizationTimezone", () => {
	beforeEach(() => {
		mocks.caller = owner;
	});

	it("saves through the protected writer, then rebuilds its organization separately", async () => {
		expect(await updateOrganizationTimezone("America/New_York")).toMatchObject({ success: true });
		expect(mocks.changeTimezone).toHaveBeenCalledWith({
			organizationId: "org-1",
			actorUserId: "user-owner",
			timezone: "America/New_York",
		});
		expect(mocks.rebuildIntents).toHaveBeenCalledWith({ organizationId: "org-1" });
		expect(mocks.changeTimezone.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.rebuildIntents.mock.invocationCallOrder[0] ?? 0,
		);
	});

	it("keeps a committed save successful when its rebuild fails", async () => {
		mocks.rebuildIntents.mockResolvedValueOnce({
			organizationsRebuilt: 0,
			failures: [{ organizationId: "org-1", error: "lock timeout" }],
		});
		await expect(updateOrganizationTimezone("America/New_York")).resolves.toMatchObject({
			success: true,
		});

		mocks.rebuildIntents.mockRejectedValueOnce(new Error("connection lost"));
		await expect(updateOrganizationTimezone("America/New_York")).resolves.toMatchObject({
			success: true,
		});
		expect(mocks.logger.warn).toHaveBeenCalledTimes(2);
	});

	it("runs no separate rebuild for an unchanged or legacy save", async () => {
		mocks.changeTimezone.mockResolvedValueOnce({ status: "unchanged" });
		await updateOrganizationTimezone("Europe/Berlin");
		mocks.changeTimezone.mockResolvedValueOnce({ status: "changed", rebuild: "in_transaction" });
		await updateOrganizationTimezone("America/New_York");

		expect(mocks.rebuildIntents).not.toHaveBeenCalled();
	});

	it("reports an owner revoked under protection as unauthorized", async () => {
		mocks.changeTimezone.mockResolvedValueOnce({ status: "not_authorized" });

		await expect(updateOrganizationTimezone("America/New_York")).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.rebuildIntents).not.toHaveBeenCalled();
	});

	it("refuses an invalid zone before the writer", async () => {
		await expect(updateOrganizationTimezone("Mars/Olympus")).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Timezone must be a valid timezone",
		});
		expect(mocks.changeTimezone).not.toHaveBeenCalled();
	});

	it("keeps statement text out of a rolled-back save", async () => {
		mocks.changeTimezone.mockRejectedValueOnce(new Error("insert into secret_table"));

		const result = await updateOrganizationTimezone("America/New_York");

		expect(result).toMatchObject({
			success: false,
			error: "Failed to update organization timezone",
		});
		expect(JSON.stringify(result)).not.toContain("secret_table");
	});
});

describe("updateOrganizationDefaultNotificationLanguage", () => {
	it("lets an org admin set the session organization's default language", async () => {
		expect(await updateOrganizationDefaultNotificationLanguage("de")).toEqual({
			success: true,
			data: undefined,
		});
		expect(mocks.insertValues).toHaveBeenCalledWith({
			organizationId: "org-1",
			defaultLanguage: "de",
		});
		expect(mocks.onConflictDoUpdate).toHaveBeenCalledWith(
			expect.objectContaining({ set: { defaultLanguage: "de" } }),
		);
	});

	it("refuses an unsupported language", async () => {
		expect(await updateOrganizationDefaultNotificationLanguage("xx")).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Unsupported language",
		});
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});
});

describe("organization deletion", () => {
	it("schedules the session organization for deletion once its exact name is typed", async () => {
		expect(await deleteOrganization({ confirmationName: "Organization One" })).toEqual({
			success: true,
			data: undefined,
		});
		expect(mocks.updateSet).toHaveBeenCalledWith({
			deletedAt: expect.any(Date),
			deletedBy: "user-admin",
		});
		expect(mocks.sendDeletionNotifications).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				organizationName: "Organization One",
				deletedByName: "user-admin",
			}),
		);
	});

	it("keeps the deletion when its notification emails fail", async () => {
		mocks.sendDeletionNotifications.mockRejectedValue(new Error("smtp down"));

		expect(await deleteOrganization({ confirmationName: "Organization One" })).toMatchObject({
			success: true,
		});
		expect(mocks.logger.warn).toHaveBeenCalled();
	});

	it.each([
		["a mismatched name", "Organization Two", {}],
		["an organization already scheduled", "Organization One", { deletedAt: new Date() }],
	])("refuses %s", async (_case, confirmationName, organization) => {
		mocks.db.query.organization.findFirst.mockResolvedValue({
			id: "org-1",
			name: "Organization One",
			deletedAt: null,
			...organization,
		});

		expect(await deleteOrganization({ confirmationName })).toMatchObject({
			success: false,
			code: "ValidationError",
		});
		expect(mocks.updateSet).not.toHaveBeenCalled();
	});

	it("recovers a scheduled deletion, and refuses one that is not scheduled", async () => {
		expect(await recoverOrganization()).toMatchObject({
			success: false,
			error: "Organization is not scheduled for deletion",
		});

		mocks.db.query.organization.findFirst.mockResolvedValue({
			id: "org-1",
			name: "Organization One",
			deletedAt: new Date(),
		});
		expect(await recoverOrganization()).toEqual({ success: true, data: undefined });
		expect(mocks.updateSet).toHaveBeenCalledWith({ deletedAt: null, deletedBy: null });
		expect(whereParams(mocks.db.query.organization.findFirst)).toEqual(["org-1"]);
	});
});
