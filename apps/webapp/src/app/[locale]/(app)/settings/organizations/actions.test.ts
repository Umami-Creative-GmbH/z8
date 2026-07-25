import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isOrganizationFeature } from "./organization-features";

const getSessionMock = vi.fn();
const createInvitationMock = vi.fn();
const cancelInvitationMock = vi.fn();
const updateMemberRoleMock = vi.fn();
const headersMock = vi.fn();
const loggerInfoMock = vi.fn();
const loggerErrorMock = vi.fn();
const loggerWarnMock = vi.fn();
const spanRecordExceptionMock = vi.fn();
const spanSetStatusMock = vi.fn();
const memberFindFirstMock = vi.fn();
const employeeFindFirstMock = vi.fn();
const invitationFindFirstMock = vi.fn();
const employeeInvitationDraftFindFirstMock = vi.fn();
const teamFindFirstMock = vi.fn();
const userFindFirstMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const insertValuesMock = vi.fn();
const onConflictDoUpdateMock = vi.fn();
const attachInvitationToEmployeeDraftMock = vi.fn();
const persistEmployeeInvitationDraftMock = vi.fn();
const syncInvitationTargetTeamMock = vi.fn();
const requestOrganizationWorkBalanceFullRebuildMock = vi.fn();
const transactionClient = {
	update: vi.fn(() => ({
		set: updateSetMock.mockReturnValue({ where: updateWhereMock }),
	})),
};
const transactionMock = vi.fn(
	async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
		callback(transactionClient),
);

vi.mock("@opentelemetry/api", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@opentelemetry/api")>();
	return {
		...actual,
		trace: {
			getTracer: () => ({
				startActiveSpan: (_name: string, ...args: unknown[]) => {
					const callback = args.at(-1) as (span: unknown) => unknown;
					return callback({
						end: vi.fn(),
						recordException: spanRecordExceptionMock,
						setAttribute: vi.fn(),
						setStatus: spanSetStatusMock,
					});
				},
			}),
		},
	};
});

vi.mock("next/headers", () => ({
	headers: headersMock,
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: getSessionMock,
			createInvitation: createInvitationMock,
			cancelInvitation: cancelInvitationMock,
			updateMemberRole: updateMemberRoleMock,
		},
	},
}));

vi.mock("@/lib/auth/employee-invitation-draft", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("@/lib/auth/employee-invitation-draft")
		>();
	return {
		...actual,
		attachInvitationToEmployeeDraft: attachInvitationToEmployeeDraftMock,
		persistEmployeeInvitationDraft: persistEmployeeInvitationDraftMock,
		syncInvitationTargetTeam: syncInvitationTargetTeamMock,
	};
});

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		info: loggerInfoMock,
		error: loggerErrorMock,
		warn: loggerWarnMock,
		debug: vi.fn(),
	}),
}));

vi.mock("@/lib/enterprise-identity/enforcement", () => ({
	assertEnterpriseIdentityInvitationAllowed: vi.fn(async () => undefined),
}));

vi.mock("@/lib/work-balance/service", () => ({
	requestOrganizationWorkBalanceFullRebuild:
		requestOrganizationWorkBalanceFullRebuildMock,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: { findFirst: memberFindFirstMock },
			employee: { findFirst: employeeFindFirstMock },
			invitation: { findFirst: invitationFindFirstMock },
			employeeInvitationDraft: {
				findFirst: employeeInvitationDraftFindFirstMock,
			},
			team: { findFirst: teamFindFirstMock },
			user: { findFirst: userFindFirstMock },
		},
		update: vi.fn(() => ({
			set: updateSetMock.mockReturnValue({ where: updateWhereMock }),
		})),
		insert: vi.fn(() => ({
			values: insertValuesMock.mockReturnValue({
				onConflictDoUpdate: onConflictDoUpdateMock,
			}),
		})),
		transaction: transactionMock,
	},
}));

const {
	cancelInvitation,
	sendInvitation,
	resendInvitation,
	updateMemberRole,
	updateInvitationTargetTeam,
	updateOrganizationTimezone,
	updateOrganizationDefaultNotificationLanguage,
	toggleOrganizationFeature,
	deleteOrganization,
} = await import("./actions");

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

describe("organization action authorization inventory", () => {
	it.each([
		["sendInvitation", "resendInvitation"],
		["resendInvitation", "updateInvitationTargetTeam"],
		["updateInvitationTargetTeam", "cancelInvitation"],
		["cancelInvitation", "updateMemberRole"],
		["updateMemberRole", "updateOrganizationDetails"],
		["updateOrganizationDetails", "removeOrganizationLogo"],
		["removeOrganizationLogo", "toggleOrganizationFeature"],
		["toggleOrganizationFeature", "updateOrganizationTimezone"],
		[
			"updateOrganizationTimezone",
			"updateOrganizationDefaultNotificationLanguage",
		],
		["updateOrganizationDefaultNotificationLanguage", "deleteOrganization"],
		["deleteOrganization", "recoverOrganization"],
		["recoverOrganization", "sendOrganizationDeletionNotifications"],
	] as const)("routes %s through the central active-organization gate", (action, next) => {
		const source = readFileSync(
			new URL("./actions.ts", import.meta.url),
			"utf8",
		);
		const section = source.slice(
			source.indexOf(`export async function ${action}(`),
			source.indexOf(
				`${next === "sendOrganizationDeletionNotifications" ? "async" : "export async"} function ${next}(`,
			),
		);

		expect(section).toContain("requireActiveOrganizationActionActor({");
	});
});

describe("organization invitation actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getSessionMock.mockReset();
		createInvitationMock.mockReset();
		cancelInvitationMock.mockReset();
		updateMemberRoleMock.mockReset();
		headersMock.mockReset();
		loggerInfoMock.mockReset();
		loggerErrorMock.mockReset();
		loggerWarnMock.mockReset();
		spanRecordExceptionMock.mockReset();
		spanSetStatusMock.mockReset();
		memberFindFirstMock.mockReset();
		employeeFindFirstMock.mockReset();
		invitationFindFirstMock.mockReset();
		employeeInvitationDraftFindFirstMock.mockReset();
		teamFindFirstMock.mockReset();
		userFindFirstMock.mockReset();
		updateSetMock.mockReset();
		updateWhereMock.mockReset();
		insertValuesMock.mockReset();
		onConflictDoUpdateMock.mockReset();
		attachInvitationToEmployeeDraftMock.mockReset();
		persistEmployeeInvitationDraftMock.mockReset();
		syncInvitationTargetTeamMock.mockReset();
		requestOrganizationWorkBalanceFullRebuildMock.mockReset();
		transactionMock.mockClear();
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
			status: "approved",
		});
		employeeFindFirstMock.mockResolvedValue(null);
		userFindFirstMock.mockResolvedValue(null);
		invitationFindFirstMock.mockResolvedValue(null);
		employeeInvitationDraftFindFirstMock.mockResolvedValue({
			id: "draft-1",
			organizationId: "org-1",
			normalizedEmail: "invitee@example.com",
			invitationId: "invite-old",
		});
		teamFindFirstMock.mockResolvedValue({
			id: "11111111-1111-4111-8111-111111111111",
			organizationId: "org-1",
		});
		createInvitationMock.mockResolvedValue({ id: "invitation-created" });
		headersMock.mockResolvedValue(new Headers({ cookie: "session=token" }));
		attachInvitationToEmployeeDraftMock.mockResolvedValue({ id: "draft-1" });
		persistEmployeeInvitationDraftMock.mockResolvedValue({
			outcome: "persisted",
		});
		syncInvitationTargetTeamMock.mockResolvedValue(undefined);
		updateSetMock.mockReturnValue({ where: updateWhereMock });
		updateWhereMock.mockResolvedValue([{ id: "updated" }]);
		insertValuesMock.mockReturnValue({
			onConflictDoUpdate: onConflictDoUpdateMock,
		});
		onConflictDoUpdateMock.mockResolvedValue({ organizationId: "org-1" });
		requestOrganizationWorkBalanceFullRebuildMock.mockResolvedValue(undefined);
	});

	async function runInvitationActorAction(
		action: "send" | "resend" | "update" | "cancel",
	) {
		switch (action) {
			case "send":
				return sendInvitation({
					organizationId: "org-1",
					email: "invitee@example.com",
					role: "member",
				});
			case "resend":
				invitationFindFirstMock.mockResolvedValue({
					id: "invite-old",
					organizationId: "org-1",
					email: "invitee@example.com",
					role: "member",
					status: "pending",
					expiresAt: new Date("2100-01-01T00:00:00.000Z"),
					targetTeamId: null,
					canCreateOrganizations: false,
				});
				return resendInvitation("org-1", "invite-old");
			case "update":
				invitationFindFirstMock.mockResolvedValue({
					id: "invite-1",
					organizationId: "org-1",
					status: "pending",
				});
				return updateInvitationTargetTeam({
					invitationId: "invite-1",
					organizationId: "org-1",
					targetTeamId: null,
				});
			case "cancel":
				invitationFindFirstMock.mockResolvedValue({
					id: "invite-1",
					organizationId: "org-1",
					status: "pending",
				});
				return cancelInvitation("invite-1");
		}
	}

	it.each([
		["send", "member,admin"],
		["send", "member,owner"],
		["resend", "member,admin"],
		["resend", "member,owner"],
		["update", "member,admin"],
		["update", "member,owner"],
		["cancel", "member,admin"],
		["cancel", "member,owner"],
	] as const)("allows %s invitation actions for compound role %s", async (action, role) => {
		memberFindFirstMock.mockResolvedValue({
			id: "member-actor",
			userId: "user-admin",
			organizationId: "org-1",
			role,
			status: "approved",
		});

		const result = await runInvitationActorAction(action);

		expect(result).toMatchObject({ success: true });
	});

	it.each([
		"send",
		"resend",
		"update",
		"cancel",
	] as const)("denies a plain member from the %s invitation action", async (action) => {
		memberFindFirstMock.mockResolvedValue({
			id: "member-actor",
			userId: "user-admin",
			organizationId: "org-1",
			role: "member",
			status: "approved",
		});

		const result = await runInvitationActorAction(action);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});

	it("uses the central tokenized capability gate for every invitation actor check", () => {
		const source = readFileSync(
			new URL("./actions.ts", import.meta.url),
			"utf8",
		);
		const boundaries = [
			[
				"export async function sendInvitation(",
				"export async function resendInvitation(",
			],
			[
				"export async function resendInvitation(",
				"export async function updateInvitationTargetTeam(",
			],
			[
				"export async function updateInvitationTargetTeam(",
				"export async function cancelInvitation(",
			],
			[
				"export async function cancelInvitation(",
				"export async function updateMemberRole(",
			],
		] as const;

		for (const [start, end] of boundaries) {
			const section = source.slice(source.indexOf(start), source.indexOf(end));
			expect(section).toContain("requireActiveOrganizationActionActor({");
			expect(section).toContain('requiredRole: "admin"');
		}
	});

	it("allows an approved compound owner to update an approved target by member ID", async () => {
		memberFindFirstMock
			.mockResolvedValueOnce({
				id: "actor-member",
				userId: "user-admin",
				organizationId: "org-1",
				role: "member,owner",
				status: "approved",
			})
			.mockResolvedValueOnce({
				id: "target-member",
				userId: "target-user",
				organizationId: "org-1",
				role: "member",
				status: "approved",
			});
		updateMemberRoleMock.mockResolvedValue({});

		const result = await updateMemberRole("org-1", "target-member", {
			role: "admin",
		});

		expect(result).toMatchObject({ success: true });
		expect(updateMemberRoleMock).toHaveBeenCalledExactlyOnceWith({
			body: {
				organizationId: "org-1",
				memberId: "target-member",
				role: "admin",
			},
			headers: expect.any(Headers),
		});
	});

	it.each([
		"pending",
		"rejected",
	])("denies a direct role update from a %s owner membership", async (status) => {
		memberFindFirstMock.mockResolvedValueOnce({
			id: "actor-member",
			userId: "user-admin",
			organizationId: "org-1",
			role: "owner",
			status,
		});

		const result = await updateMemberRole("org-1", "target-member", {
			role: "admin",
		});

		expect(result).toMatchObject({ success: false });
		expect(updateMemberRoleMock).not.toHaveBeenCalled();
	});

	it.each([
		"pending",
		"rejected",
	])("denies a direct role update for a %s target membership", async (status) => {
		memberFindFirstMock
			.mockResolvedValueOnce({
				id: "actor-member",
				userId: "user-admin",
				organizationId: "org-1",
				role: "owner",
				status: "approved",
			})
			.mockResolvedValueOnce({
				id: "target-member",
				userId: "target-user",
				organizationId: "org-1",
				role: "member",
				status,
			});

		const result = await updateMemberRole("org-1", "target-member", {
			role: "admin",
		});

		expect(result).toMatchObject({ success: false });
		expect(updateMemberRoleMock).not.toHaveBeenCalled();
	});

	it("rejects a direct self-role update", async () => {
		memberFindFirstMock
			.mockResolvedValueOnce({
				id: "actor-member",
				userId: "user-admin",
				organizationId: "org-1",
				role: "owner",
				status: "approved",
			})
			.mockResolvedValueOnce({
				id: "actor-member",
				userId: "user-admin",
				organizationId: "org-1",
				role: "owner",
				status: "approved",
			});

		const result = await updateMemberRole("org-1", "actor-member", {
			role: "member",
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "You cannot change your own organization role",
		});
		expect(updateMemberRoleMock).not.toHaveBeenCalled();
	});

	it("denies an inactive owner before updating a member role", async () => {
		memberFindFirstMock.mockResolvedValue({
			id: "actor-member",
			userId: "user-admin",
			organizationId: "org-1",
			role: "owner",
			status: "approved",
		});
		employeeFindFirstMock.mockResolvedValue({
			id: "actor-employee",
			userId: "user-admin",
			organizationId: "org-1",
			isActive: false,
		});

		const result = await updateMemberRole("org-1", "target-member", {
			role: "admin",
		});

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(updateMemberRoleMock).not.toHaveBeenCalled();
	});

	it.each([
		[
			"owner-only organization settings",
			"owner",
			() => toggleOrganizationFeature("org-1", "shiftsEnabled", true),
		],
		[
			"admin organization deletion",
			"admin",
			() => deleteOrganization("org-1", "Organization One"),
		],
	] as const)("denies an inactive actor before %s mutations", async (_case, role, action) => {
		memberFindFirstMock.mockResolvedValue({
			id: "actor-member",
			userId: "user-admin",
			organizationId: "org-1",
			role,
			status: "approved",
		});
		employeeFindFirstMock.mockResolvedValue({
			id: "actor-employee",
			userId: "user-admin",
			organizationId: "org-1",
			isActive: false,
		});

		const result = await action();

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(updateSetMock).not.toHaveBeenCalled();
		expect(updateMemberRoleMock).not.toHaveBeenCalled();
	});

	it("scopes approved actor and target role-update lookups to the organization", async () => {
		memberFindFirstMock
			.mockResolvedValueOnce({
				id: "actor-member",
				userId: "user-admin",
				organizationId: "org-1",
				role: "owner",
				status: "approved",
			})
			.mockResolvedValueOnce({
				id: "target-member",
				userId: "target-user",
				organizationId: "org-1",
				role: "member",
				status: "approved",
			});
		updateMemberRoleMock.mockResolvedValue({});

		await updateMemberRole("org-1", "target-member", { role: "admin" });

		expect(memberFindFirstMock).toHaveBeenCalledTimes(2);
		const actorQuery = new PgDialect().sqlToQuery(
			memberFindFirstMock.mock.calls[0]?.[0].where,
		);
		const targetQuery = new PgDialect().sqlToQuery(
			memberFindFirstMock.mock.calls[1]?.[0].where,
		);
		expect(actorQuery.params).toEqual(["user-admin", "org-1", "approved"]);
		expect(targetQuery.params).toEqual(["target-member", "org-1", "approved"]);
	});

	it("returns a safe error while preserving Better Auth owner protections", async () => {
		memberFindFirstMock
			.mockResolvedValueOnce({
				id: "actor-member",
				userId: "user-admin",
				organizationId: "org-1",
				role: "owner",
				status: "approved",
			})
			.mockResolvedValueOnce({
				id: "target-member",
				userId: "target-user",
				organizationId: "org-1",
				role: "owner",
				status: "approved",
			});
		updateMemberRoleMock.mockRejectedValue(
			new Error("secret database trigger detail"),
		);

		const result = await updateMemberRole("org-1", "target-member", {
			role: "member",
		});

		expect(updateMemberRoleMock).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			success: false,
			error: "Failed to update member role",
		});
		expect(JSON.stringify(result)).not.toContain("secret");
	});

	it("keeps role updates member-ID correct and removes obsolete lifecycle exports", () => {
		const source = readFileSync(
			new URL("./actions.ts", import.meta.url),
			"utf8",
		);
		const roleUpdate = source.slice(
			source.indexOf("export async function updateMemberRole("),
			source.indexOf("export async function updateOrganization("),
		);

		expect(roleUpdate).toContain("memberId: string");
		expect(roleUpdate).toContain('"member.id": memberId');
		expect(roleUpdate).toContain('requiredRole: "owner"');
		expect(source).not.toContain("export async function removeMember(");
		expect(source).not.toContain("export async function toggleEmployeeStatus(");
	});

	it("requests balance rebuilds after changing the organization timezone", async () => {
		memberFindFirstMock.mockResolvedValue({
			id: "member-owner",
			userId: "user-admin",
			organizationId: "org-1",
			role: "owner",
		});

		const result = await updateOrganizationTimezone(
			"org-1",
			"America/New_York",
		);

		expect(result).toMatchObject({ success: true });
		expect(requestOrganizationWorkBalanceFullRebuildMock).toHaveBeenCalledWith(
			{ organizationId: "org-1" },
			{ dbClient: transactionClient },
		);
		expect(transactionMock).toHaveBeenCalledTimes(1);
	});

	it("rejects a direct invite target team outside the organization", async () => {
		teamFindFirstMock.mockResolvedValue(null);

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

	it("passes the normalized email to Better Auth", async () => {
		const result = await sendInvitation({
			organizationId: "org-1",
			email: "  Invitee@Example.COM  ",
			role: "member",
		});

		expect(result).toMatchObject({ success: true });
		const requestHeaders = await headersMock.mock.results[0]?.value;
		expect(createInvitationMock).toHaveBeenCalledWith({
			body: {
				organizationId: "org-1",
				email: "invitee@example.com",
				role: "member",
				resend: false,
			},
			headers: requestHeaders,
		});
	});

	it("translates a pre-creation Better Auth send failure safely", async () => {
		const secretText = "email=invitee@example.com&token=auth-secret";
		const authError = new Error(secretText);
		createInvitationMock.mockRejectedValue(authError);

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Failed to send invitation",
		});
		expect(result).not.toMatchObject({ error: authError.message });
		expect(loggerErrorMock).toHaveBeenCalledWith(
			{
				operation: "sendInvitation",
				failurePhase: "createInvitation",
				organizationId: "org-1",
			},
			"Failed to send invitation",
		);
		expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
			secretText,
		);
		const telemetryError = spanRecordExceptionMock.mock.calls[0]?.[0];
		expect(telemetryError).toEqual(new Error("Invitation send failed"));
		expect(telemetryError).not.toBe(authError);
	});

	it("requires an approved actor membership to send an invitation", async () => {
		memberFindFirstMock.mockImplementation(async ({ where }) => {
			const query = new PgDialect().sqlToQuery(where);
			return query.params.includes("approved")
				? null
				: {
						id: "member-admin",
						userId: "user-admin",
						organizationId: "org-1",
						role: "admin",
						status: "pending",
					};
		});

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
		});

		expect(result).toMatchObject({ success: false });
		expect(createInvitationMock).not.toHaveBeenCalled();
	});

	it("rejects sending for an inactive employee in the actor organization", async () => {
		employeeFindFirstMock.mockResolvedValue({
			id: "employee-inactive",
			organizationId: "org-1",
			userId: "user-admin",
			isActive: false,
		});

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
		});

		expect(result).toMatchObject({ success: false });
		const predicate = employeeFindFirstMock.mock.calls[0]?.[0].where;
		expect(new PgDialect().sqlToQuery(predicate).params).toEqual([
			"user-admin",
			"org-1",
		]);
		expect(createInvitationMock).not.toHaveBeenCalled();
	});

	it("repairs app-owned fields on an existing actionable invitation without sending again", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-existing",
			organizationId: "org-1",
			status: "pending",
			expiresAt: new Date("2100-01-01T00:00:00.000Z"),
		});

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
			canCreateOrganizations: true,
			targetTeamId: "11111111-1111-4111-8111-111111111111",
		});

		expect(result).toMatchObject({
			success: false,
			error: "An invitation for this email is already pending",
		});
		expect(createInvitationMock).not.toHaveBeenCalled();
		expect(persistEmployeeInvitationDraftMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				invitationId: "invite-existing",
				canCreateOrganizations: true,
				targetTeamId: "11111111-1111-4111-8111-111111111111",
			}),
		);
	});

	it("reattaches a missing stable draft on an existing actionable invitation without sending again", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-existing",
			organizationId: "org-1",
			status: "pending",
			expiresAt: new Date("2100-01-01T00:00:00.000Z"),
		});

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "  Invitee@Example.COM  ",
			role: "admin",
			targetTeamId: "11111111-1111-4111-8111-111111111111",
		});

		expect(result).toMatchObject({
			success: false,
			error: "An invitation for this email is already pending",
		});
		expect(createInvitationMock).not.toHaveBeenCalled();
		expect(persistEmployeeInvitationDraftMock).toHaveBeenCalledWith(
			expect.anything(),
			{
				organizationId: "org-1",
				normalizedEmail: "invitee@example.com",
				invitationId: "invite-existing",
				canCreateOrganizations: false,
				targetTeamId: "11111111-1111-4111-8111-111111111111",
				initialRole: "admin",
				updatedBy: "user-admin",
			},
		);
	});

	it("does not block on an expired database-pending invitation", async () => {
		invitationFindFirstMock.mockResolvedValueOnce({
			id: "invite-expired",
			organizationId: "org-1",
			status: "pending",
			expiresAt: new Date("2000-01-01T00:00:00.000Z"),
		});

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
		});

		expect(result).toMatchObject({ success: true });
		expect(createInvitationMock).toHaveBeenCalledOnce();
	});

	it("uses the invitation ID returned directly by Better Auth", async () => {
		createInvitationMock.mockResolvedValue({ id: "better-auth-invitation" });

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
		});

		expect(result).toMatchObject({ success: true });
		expect(persistEmployeeInvitationDraftMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ invitationId: "better-auth-invitation" }),
		);
		expect(invitationFindFirstMock).toHaveBeenCalledOnce();
	});

	it("persists returned send state through the shared transactional helper", async () => {
		createInvitationMock.mockResolvedValue({ id: "better-auth-invitation" });

		const result = await sendInvitation({
			organizationId: "org-1",
			email: " Invitee@Example.COM ",
			role: "admin",
			canCreateOrganizations: true,
			targetTeamId: "11111111-1111-4111-8111-111111111111",
		});

		expect(result).toMatchObject({ success: true });
		expect(persistEmployeeInvitationDraftMock).toHaveBeenCalledWith(
			expect.anything(),
			{
				organizationId: "org-1",
				normalizedEmail: "invitee@example.com",
				invitationId: "better-auth-invitation",
				canCreateOrganizations: true,
				targetTeamId: "11111111-1111-4111-8111-111111111111",
				initialRole: "admin",
				updatedBy: "user-admin",
			},
		);
		expect(attachInvitationToEmployeeDraftMock).not.toHaveBeenCalled();
	});

	it("treats acceptance between Better Auth send and app persistence as completed", async () => {
		createInvitationMock.mockResolvedValue({ id: "better-auth-invitation" });
		persistEmployeeInvitationDraftMock.mockResolvedValue({
			outcome: "consumed",
		});

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(createInvitationMock).toHaveBeenCalledOnce();
		expect(attachInvitationToEmployeeDraftMock).not.toHaveBeenCalled();
	});

	it("repairs post-email persistence on retry without sending another email", async () => {
		createInvitationMock.mockResolvedValue({ id: "better-auth-invitation" });
		persistEmployeeInvitationDraftMock
			.mockRejectedValueOnce(new Error("database detail"))
			.mockResolvedValueOnce({ outcome: "persisted" });

		const firstResult = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
		});
		expect(firstResult).toMatchObject({
			success: false,
			error: "Failed to send invitation",
		});

		invitationFindFirstMock.mockResolvedValue({
			id: "better-auth-invitation",
			organizationId: "org-1",
			email: "invitee@example.com",
			status: "pending",
			expiresAt: new Date("2100-01-01T00:00:00.000Z"),
		});
		const retryResult = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
		});

		expect(retryResult).toMatchObject({
			success: false,
			error: "An invitation for this email is already pending",
		});
		expect(createInvitationMock).toHaveBeenCalledOnce();
		expect(persistEmployeeInvitationDraftMock).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
			"database detail",
		);
	});

	it("scopes app-owned invitation updates by returned ID and organization", async () => {
		createInvitationMock.mockResolvedValue({ id: "better-auth-invitation" });

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
			canCreateOrganizations: true,
		});

		expect(result).toMatchObject({ success: true });
		expect(persistEmployeeInvitationDraftMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				invitationId: "better-auth-invitation",
				organizationId: "org-1",
			}),
		);
	});

	it("returns a safe error and logs authoritative IDs when send app-field persistence fails", async () => {
		const secretText = "select * where email=invitee@example.com";
		const databaseError = new Error(secretText);
		createInvitationMock.mockResolvedValue({ id: "better-auth-invitation" });
		persistEmployeeInvitationDraftMock.mockRejectedValue(databaseError);

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Failed to send invitation",
		});
		expect(result).not.toMatchObject({ error: databaseError.message });
		expect(loggerErrorMock).toHaveBeenCalledWith(
			{
				operation: "sendInvitation",
				failurePhase: "persistInvitationState",
				organizationId: "org-1",
				invitationId: "better-auth-invitation",
			},
			"Failed to send invitation",
		);
		expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
			secretText,
		);
		expect(spanRecordExceptionMock.mock.calls[0]?.[0]).toEqual(
			new Error("Invitation send failed"),
		);
	});

	it("attaches by organization and normalized identity without local draft upsert", async () => {
		createInvitationMock.mockResolvedValue({ id: "better-auth-invitation" });

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "  Invitee@Example.COM  ",
			role: "admin",
			targetTeamId: "11111111-1111-4111-8111-111111111111",
		});

		expect(result).toMatchObject({ success: true });
		expect(persistEmployeeInvitationDraftMock).toHaveBeenCalledWith(
			expect.anything(),
			{
				organizationId: "org-1",
				normalizedEmail: "invitee@example.com",
				invitationId: "better-auth-invitation",
				canCreateOrganizations: false,
				targetTeamId: "11111111-1111-4111-8111-111111111111",
				initialRole: "admin",
				updatedBy: "user-admin",
			},
		);
		expect(insertValuesMock).not.toHaveBeenCalled();
	});

	it("returns a safe error and logs authoritative IDs when send draft attachment fails", async () => {
		const secretText = "draft email=invitee@example.com salary=secret";
		const attachmentError = new Error(secretText);
		createInvitationMock.mockResolvedValue({ id: "better-auth-invitation" });
		persistEmployeeInvitationDraftMock.mockRejectedValue(attachmentError);

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Failed to send invitation",
		});
		expect(result).not.toMatchObject({ error: attachmentError.message });
		expect(loggerErrorMock).toHaveBeenCalledWith(
			{
				operation: "sendInvitation",
				failurePhase: "persistInvitationState",
				organizationId: "org-1",
				invitationId: "better-auth-invitation",
			},
			"Failed to send invitation",
		);
		expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
			secretText,
		);
		expect(spanRecordExceptionMock.mock.calls[0]?.[0]).toEqual(
			new Error("Invitation send failed"),
		);
	});

	it("treats the same email in another organization independently", async () => {
		invitationFindFirstMock.mockResolvedValueOnce({
			id: "other-org-invitation",
			organizationId: "org-2",
			status: "pending",
			expiresAt: new Date("2100-01-01T00:00:00.000Z"),
		});

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
		});

		expect(result).toMatchObject({ success: true });
		expect(createInvitationMock).toHaveBeenCalledOnce();
	});

	it("rejects resending an invitation outside the requested organization", async () => {
		invitationFindFirstMock.mockResolvedValue(null);

		const result = await resendInvitation("org-1", "other-org-invitation");

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		const predicate = invitationFindFirstMock.mock.calls[0]?.[0].where;
		const query = new PgDialect().sqlToQuery(predicate);
		expect(query.params).toEqual(["other-org-invitation", "org-1"]);
		expect(memberFindFirstMock).toHaveBeenCalledOnce();
		expect(createInvitationMock).not.toHaveBeenCalled();
	});

	it("requires an approved owner or admin to resend an invitation", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
			targetTeamId: null,
			canCreateOrganizations: false,
		});
		memberFindFirstMock.mockResolvedValue({
			id: "member-admin",
			userId: "user-admin",
			organizationId: "org-1",
			role: "admin",
			status: "pending",
		});

		const result = await resendInvitation("org-1", "invite-1");

		expect(result).toMatchObject({ success: false });
		expect(createInvitationMock).not.toHaveBeenCalled();
	});

	it("rejects resending for an inactive employee in the invitation organization", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-old",
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
			status: "pending",
			expiresAt: new Date("2100-01-01T00:00:00.000Z"),
			targetTeamId: null,
			canCreateOrganizations: true,
		});
		employeeFindFirstMock.mockResolvedValue({
			id: "employee-inactive",
			organizationId: "org-1",
			userId: "user-admin",
			isActive: false,
		});

		const result = await resendInvitation("org-1", "invite-old");

		expect(result).toMatchObject({ success: false });
		const predicate = employeeFindFirstMock.mock.calls[0]?.[0].where;
		expect(new PgDialect().sqlToQuery(predicate).params).toEqual([
			"user-admin",
			"org-1",
		]);
		expect(createInvitationMock).not.toHaveBeenCalled();
	});

	it("resends through Better Auth with normalized email and the same role without canceling", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			email: "  Invitee@Example.COM  ",
			role: "admin",
			status: "pending",
			targetTeamId: null,
			canCreateOrganizations: false,
		});
		createInvitationMock.mockResolvedValue({ id: "invite-1" });
		employeeInvitationDraftFindFirstMock.mockResolvedValue({
			invitationId: "invite-1",
		});

		const result = await resendInvitation("org-1", "invite-1");

		expect(result).toMatchObject({ success: true });
		expect(createInvitationMock).toHaveBeenCalledWith({
			body: {
				organizationId: "org-1",
				email: "invitee@example.com",
				role: "admin",
				resend: true,
			},
			headers: await headersMock.mock.results[0]?.value,
		});
		expect(cancelInvitationMock).not.toHaveBeenCalled();
	});

	it("persists returned resend state through the shared transactional helper", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-old",
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "admin",
			status: "pending",
			targetTeamId: "11111111-1111-4111-8111-111111111111",
			canCreateOrganizations: true,
		});
		createInvitationMock.mockResolvedValue({ id: "invite-replacement" });

		const result = await resendInvitation("org-1", "invite-old");

		expect(result).toMatchObject({ success: true });
		expect(persistEmployeeInvitationDraftMock).toHaveBeenCalledWith(
			expect.anything(),
			{
				organizationId: "org-1",
				normalizedEmail: "invitee@example.com",
				invitationId: "invite-replacement",
				canCreateOrganizations: true,
				targetTeamId: "11111111-1111-4111-8111-111111111111",
				initialRole: "admin",
				updatedBy: "user-admin",
			},
		);
		expect(attachInvitationToEmployeeDraftMock).not.toHaveBeenCalled();
	});

	it("rejects a stale pending resend source that no longer owns the stable draft", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-stale",
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
			status: "pending",
			expiresAt: new Date("2100-01-01T00:00:00.000Z"),
			targetTeamId: null,
			canCreateOrganizations: false,
		});
		employeeInvitationDraftFindFirstMock.mockResolvedValue({
			invitationId: "invite-current",
		});

		const result = await resendInvitation("org-1", "invite-stale");

		expect(result).toMatchObject({
			success: false,
			error: "Invitation cannot be resent",
		});
		expect(createInvitationMock).not.toHaveBeenCalled();
	});

	it.each([
		"canceled",
		"accepted",
		"rejected",
	])("rejects an anomalously linked %s resend source", async (status) => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-old",
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
			status,
			expiresAt: new Date("2100-01-01T00:00:00.000Z"),
			targetTeamId: null,
			canCreateOrganizations: false,
		});

		const result = await resendInvitation("org-1", "invite-old");

		expect(result).toMatchObject({
			success: false,
			error: "Invitation cannot be resent",
		});
		expect(createInvitationMock).not.toHaveBeenCalled();
	});

	it("allows an expired pending resend source that still owns the stable draft", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-old",
			organizationId: "org-1",
			email: "  Invitee@Example.COM  ",
			role: "member",
			status: "pending",
			expiresAt: new Date("2000-01-01T00:00:00.000Z"),
			targetTeamId: null,
			canCreateOrganizations: false,
		});
		createInvitationMock.mockResolvedValue({ id: "invite-replacement" });

		const result = await resendInvitation("org-1", "invite-old");

		expect(result).toMatchObject({ success: true });
		expect(createInvitationMock).toHaveBeenCalledOnce();
		expect(employeeInvitationDraftFindFirstMock).toHaveBeenCalledOnce();
		const predicate =
			employeeInvitationDraftFindFirstMock.mock.calls[0]?.[0].where;
		const query = new PgDialect().sqlToQuery(predicate);
		expect(query.params).toEqual(["org-1", "invitee@example.com"]);
		expect(persistEmployeeInvitationDraftMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ invitationId: "invite-replacement" }),
		);
	});

	it("translates a pre-creation Better Auth resend failure safely", async () => {
		const secretText = "email=invitee@example.com&token=resend-secret";
		const authError = new Error(secretText);
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-old",
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
			status: "pending",
			targetTeamId: null,
			canCreateOrganizations: false,
		});
		createInvitationMock.mockRejectedValue(authError);

		const result = await resendInvitation("org-1", "invite-old");

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Failed to resend invitation",
		});
		expect(result).not.toMatchObject({ error: authError.message });
		expect(loggerErrorMock).toHaveBeenCalledWith(
			{
				operation: "resendInvitation",
				failurePhase: "createInvitation",
				organizationId: "org-1",
				invitationId: "invite-old",
			},
			"Failed to resend invitation",
		);
		expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
			secretText,
		);
		expect(spanRecordExceptionMock.mock.calls[0]?.[0]).toEqual(
			new Error("Invitation resend failed"),
		);
	});

	it("copies app-owned fields to a replacement invitation scoped by ID and organization", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-old",
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
			status: "pending",
			targetTeamId: "11111111-1111-4111-8111-111111111111",
			canCreateOrganizations: true,
		});
		createInvitationMock.mockResolvedValue({ id: "invite-replacement" });

		const result = await resendInvitation("org-1", "invite-old");

		expect(result).toMatchObject({ success: true });
		expect(persistEmployeeInvitationDraftMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				invitationId: "invite-replacement",
				organizationId: "org-1",
				targetTeamId: "11111111-1111-4111-8111-111111111111",
				canCreateOrganizations: true,
			}),
		);
	});

	it("returns success and logs repair context when post-email resend persistence fails", async () => {
		const secretText = "update invitation email=invitee@example.com";
		const databaseError = new Error(secretText);
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-old",
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
			status: "pending",
			targetTeamId: null,
			canCreateOrganizations: true,
		});
		createInvitationMock.mockResolvedValue({ id: "invite-replacement" });
		persistEmployeeInvitationDraftMock.mockRejectedValue(databaseError);

		const result = await resendInvitation("org-1", "invite-old");

		expect(result).toEqual({ success: true, data: undefined });
		expect(createInvitationMock).toHaveBeenCalledOnce();
		expect(loggerWarnMock).toHaveBeenCalledWith(
			{
				operation: "repairResentInvitationPersistence",
				organizationId: "org-1",
				invitationId: "invite-replacement",
			},
			"Resent invitation requires app-state repair",
		);
		expect(JSON.stringify(loggerWarnMock.mock.calls)).not.toContain(secretText);
		expect(spanRecordExceptionMock).not.toHaveBeenCalled();
	});

	it("relinks the same identity-based draft to the returned invitation", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-old",
			organizationId: "org-1",
			email: "  Invitee@Example.COM  ",
			role: "admin",
			status: "pending",
			targetTeamId: "11111111-1111-4111-8111-111111111111",
			canCreateOrganizations: true,
		});
		createInvitationMock.mockResolvedValue({ id: "invite-replacement" });

		const result = await resendInvitation("org-1", "invite-old");

		expect(result).toMatchObject({ success: true });
		expect(persistEmployeeInvitationDraftMock).toHaveBeenCalledWith(
			expect.anything(),
			{
				organizationId: "org-1",
				normalizedEmail: "invitee@example.com",
				invitationId: "invite-replacement",
				canCreateOrganizations: true,
				targetTeamId: "11111111-1111-4111-8111-111111111111",
				initialRole: "admin",
				updatedBy: "user-admin",
			},
		);
		expect(insertValuesMock).not.toHaveBeenCalled();
	});

	it("does not expose post-email draft persistence failure as a resend failure", async () => {
		const secretText = "draft email=invitee@example.com salary=secret";
		const attachmentError = new Error(secretText);
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-old",
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
			status: "pending",
			targetTeamId: null,
			canCreateOrganizations: false,
		});
		createInvitationMock.mockResolvedValue({ id: "invite-replacement" });
		persistEmployeeInvitationDraftMock.mockRejectedValue(attachmentError);

		const result = await resendInvitation("org-1", "invite-old");

		expect(result).toEqual({ success: true, data: undefined });
		expect(createInvitationMock).toHaveBeenCalledOnce();
		expect(loggerWarnMock).toHaveBeenCalledWith(
			{
				operation: "repairResentInvitationPersistence",
				organizationId: "org-1",
				invitationId: "invite-replacement",
			},
			"Resent invitation requires app-state repair",
		);
		expect(JSON.stringify(loggerWarnMock.mock.calls)).not.toContain(secretText);
		expect(spanRecordExceptionMock).not.toHaveBeenCalled();
	});

	it("persists target team and organization creation permission after creating an invitation", async () => {
		invitationFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
			id: "invite-created",
			organizationId: "org-1",
			status: "pending",
		});

		const result = await sendInvitation({
			organizationId: "org-1",
			email: "invitee@example.com",
			role: "member",
			canCreateOrganizations: true,
			targetTeamId: "11111111-1111-4111-8111-111111111111",
		});

		expect(result).toMatchObject({ success: true });
		expect(createInvitationMock).toHaveBeenCalledOnce();
		expect(persistEmployeeInvitationDraftMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				canCreateOrganizations: true,
				targetTeamId: "11111111-1111-4111-8111-111111111111",
			}),
		);
	});

	it("allows an admin to update the target team for a pending invitation", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			email: "invitee@example.com",
			status: "pending",
		});

		const result = await updateInvitationTargetTeam({
			invitationId: "invite-1",
			organizationId: "org-1",
			targetTeamId: "11111111-1111-4111-8111-111111111111",
		});

		expect(result).toMatchObject({ success: true });
		expect(syncInvitationTargetTeamMock).toHaveBeenCalledWith(
			expect.anything(),
			{
				organizationId: "org-1",
				invitationId: "invite-1",
				email: "invitee@example.com",
				targetTeamId: "11111111-1111-4111-8111-111111111111",
			},
		);
	});

	it("rejects invalid target teams when updating a pending invitation", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			email: "invitee@example.com",
			status: "pending",
		});
		teamFindFirstMock.mockResolvedValue(null);

		const result = await updateInvitationTargetTeam({
			invitationId: "invite-1",
			organizationId: "org-1",
			targetTeamId: "22222222-2222-4222-8222-222222222222",
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Target team not found in this organization",
		});
		expect(updateSetMock).not.toHaveBeenCalled();
	});

	it("rejects malformed target team ids before updating an invitation", async () => {
		const result = await updateInvitationTargetTeam({
			invitationId: "invite-1",
			organizationId: "org-1",
			targetTeamId: "not-a-uuid",
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Invalid target team",
		});
		expect(invitationFindFirstMock).not.toHaveBeenCalled();
		expect(teamFindFirstMock).not.toHaveBeenCalled();
		expect(updateSetMock).not.toHaveBeenCalled();
	});

	it("requires admin or owner role to update an invitation target team", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			email: "invitee@example.com",
			status: "pending",
		});
		memberFindFirstMock.mockResolvedValue({
			id: "member-regular",
			userId: "user-admin",
			organizationId: "org-1",
			role: "member",
		});

		const result = await updateInvitationTargetTeam({
			invitationId: "invite-1",
			organizationId: "org-1",
			targetTeamId: "11111111-1111-4111-8111-111111111111",
		});

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
			error: "Only admins and owners can update invitations",
		});
		expect(updateSetMock).not.toHaveBeenCalled();
	});

	it("rejects target-team updates for an inactive employee in the invitation organization", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			status: "pending",
		});
		employeeFindFirstMock.mockResolvedValue({
			id: "employee-inactive",
			organizationId: "org-1",
			userId: "user-admin",
			isActive: false,
		});

		const result = await updateInvitationTargetTeam({
			invitationId: "invite-1",
			organizationId: "org-1",
			targetTeamId: "11111111-1111-4111-8111-111111111111",
		});

		expect(result).toMatchObject({ success: false });
		const predicate = employeeFindFirstMock.mock.calls[0]?.[0].where;
		expect(new PgDialect().sqlToQuery(predicate).params).toEqual([
			"user-admin",
			"org-1",
		]);
		expect(updateSetMock).not.toHaveBeenCalled();
	});

	it.each([
		"pending",
		"rejected",
	])("does not update an invitation target team for a %s admin membership", async (status) => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			status: "pending",
		});
		memberFindFirstMock.mockImplementation(async ({ where }) => {
			const query = new PgDialect().sqlToQuery(where);
			return query.params.includes("approved")
				? null
				: {
						id: "member-admin",
						userId: "user-admin",
						organizationId: "org-1",
						role: "admin",
						status,
					};
		});

		const result = await updateInvitationTargetTeam({
			invitationId: "invite-1",
			organizationId: "org-1",
			targetTeamId: "11111111-1111-4111-8111-111111111111",
		});

		expect(result).toMatchObject({ success: false });
		const predicate = memberFindFirstMock.mock.calls[0]?.[0].where;
		expect(new PgDialect().sqlToQuery(predicate).params).toEqual([
			"user-admin",
			"org-1",
			"approved",
		]);
		expect(updateSetMock).not.toHaveBeenCalled();
		expect(cancelInvitationMock).not.toHaveBeenCalled();
	});

	it("allows clearing the target team from a pending invitation", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			email: "invitee@example.com",
			status: "pending",
		});

		const result = await updateInvitationTargetTeam({
			invitationId: "invite-1",
			organizationId: "org-1",
			targetTeamId: null,
		});

		expect(result).toMatchObject({ success: true });
		expect(teamFindFirstMock).not.toHaveBeenCalled();
		expect(syncInvitationTargetTeamMock).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				email: "invitee@example.com",
				targetTeamId: null,
			}),
		);
	});

	it("does not update when no pending invitation exists for the organization", async () => {
		invitationFindFirstMock.mockResolvedValue(null);

		const result = await updateInvitationTargetTeam({
			invitationId: "invite-1",
			organizationId: "wrong-org",
			targetTeamId: "11111111-1111-4111-8111-111111111111",
		});

		expect(result).toMatchObject({
			success: false,
			code: "NotFoundError",
			error: "Invitation not found",
		});
		expect(memberFindFirstMock).toHaveBeenCalledOnce();
		expect(teamFindFirstMock).not.toHaveBeenCalled();
		expect(updateSetMock).not.toHaveBeenCalled();
	});

	it.each([
		"pending",
		"rejected",
	])("does not cancel an invitation for a %s admin membership", async (status) => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			status: "pending",
		});
		memberFindFirstMock.mockImplementation(async ({ where }) => {
			const query = new PgDialect().sqlToQuery(where);
			return query.params.includes("approved")
				? null
				: {
						id: "member-admin",
						userId: "user-admin",
						organizationId: "org-1",
						role: "admin",
						status,
					};
		});

		const result = await cancelInvitation("invite-1");

		expect(result).toMatchObject({ success: false });
		const predicate = memberFindFirstMock.mock.calls[0]?.[0].where;
		expect(new PgDialect().sqlToQuery(predicate).params).toEqual([
			"user-admin",
			"org-1",
			"approved",
		]);
		expect(updateSetMock).not.toHaveBeenCalled();
		expect(cancelInvitationMock).not.toHaveBeenCalled();
	});

	it("rejects cancellation for an inactive employee in the invitation organization", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			status: "pending",
		});
		employeeFindFirstMock.mockResolvedValue({
			id: "employee-inactive",
			organizationId: "org-1",
			userId: "user-admin",
			isActive: false,
		});

		const result = await cancelInvitation("invite-1");

		expect(result).toMatchObject({ success: false });
		const predicate = employeeFindFirstMock.mock.calls[0]?.[0].where;
		expect(new PgDialect().sqlToQuery(predicate).params).toEqual([
			"user-admin",
			"org-1",
		]);
		expect(cancelInvitationMock).not.toHaveBeenCalled();
	});

	it("allows an approved admin without an employee row to cancel an invitation", async () => {
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			status: "pending",
		});

		const result = await cancelInvitation("invite-1");

		expect(result).toMatchObject({ success: true });
		expect(employeeFindFirstMock).toHaveBeenCalledOnce();
		expect(cancelInvitationMock).toHaveBeenCalledOnce();
	});

	it("returns and logs a fixed safe error when Better Auth cancellation fails", async () => {
		const secretText = "token=cancel-secret&postgres=internal-host";
		invitationFindFirstMock.mockResolvedValue({
			id: "invite-1",
			organizationId: "org-1",
			status: "pending",
		});
		cancelInvitationMock.mockRejectedValue(new Error(secretText));

		const result = await cancelInvitation("invite-1");

		expect(result).toEqual({
			success: false,
			code: "ValidationError",
			error: "Failed to cancel invitation",
		});
		expect(loggerErrorMock).toHaveBeenCalledWith(
			{
				operation: "cancelInvitation",
				invitationId: "invite-1",
				organizationId: "org-1",
			},
			"Failed to cancel invitation",
		);
		expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
			secretText,
		);
		expect(spanRecordExceptionMock.mock.calls[0]?.[0]).toEqual(
			new Error("Invitation cancellation failed"),
		);
	});

	it("allows an admin to update the organization default notification language", async () => {
		const result = await updateOrganizationDefaultNotificationLanguage(
			"org-1",
			"de",
		);

		expect(result).toMatchObject({ success: true });
		expect(updateSetMock).not.toHaveBeenCalledWith({ defaultLanguage: "de" });
		expect(insertValuesMock).toHaveBeenCalledWith({
			organizationId: "org-1",
			defaultLanguage: "de",
		});
		expect(onConflictDoUpdateMock).toHaveBeenCalledWith(
			expect.objectContaining({ set: { defaultLanguage: "de" } }),
		);
	});

	it("rejects unsupported organization default notification languages", async () => {
		const result = await updateOrganizationDefaultNotificationLanguage(
			"org-1",
			"xx",
		);

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Unsupported language",
		});
		expect(memberFindFirstMock).not.toHaveBeenCalled();
		expect(updateSetMock).not.toHaveBeenCalled();
		expect(insertValuesMock).not.toHaveBeenCalled();
		expect(onConflictDoUpdateMock).not.toHaveBeenCalled();
	});

	it("requires admin or owner role to update organization default notification language", async () => {
		memberFindFirstMock.mockResolvedValue({
			id: "member-regular",
			userId: "user-admin",
			organizationId: "org-1",
			role: "member",
		});

		const result = await updateOrganizationDefaultNotificationLanguage(
			"org-1",
			"de",
		);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(updateSetMock).not.toHaveBeenCalled();
		expect(insertValuesMock).not.toHaveBeenCalled();
		expect(onConflictDoUpdateMock).not.toHaveBeenCalled();
	});

	it.each([
		"",
		" Europe/Berlin",
		"Europe/Berlin ",
		"+05:45",
		"Not/A_Zone",
	])("rejects invalid organization timezone %j before updating", async (timezone) => {
		memberFindFirstMock.mockResolvedValue({
			id: "member-owner",
			userId: "user-admin",
			organizationId: "org-1",
			role: "owner",
		});
		const result = await updateOrganizationTimezone("org-1", timezone);

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Timezone must be a valid timezone",
		});
		expect(updateSetMock).not.toHaveBeenCalled();
	});

	it.each([
		"UTC",
		"Europe/Berlin",
		"America/New_York",
	])("updates organization timezone %s for an owner", async (timezone) => {
		memberFindFirstMock.mockResolvedValue({
			id: "member-owner",
			userId: "user-admin",
			organizationId: "org-1",
			role: "owner",
		});
		const result = await updateOrganizationTimezone("org-1", timezone);

		expect(result).toMatchObject({ success: true });
		expect(updateSetMock).toHaveBeenCalledWith({ timezone });
	});
});
