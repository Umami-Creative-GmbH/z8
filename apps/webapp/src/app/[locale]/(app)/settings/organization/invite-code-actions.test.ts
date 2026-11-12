import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	inviteCodes: {
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		getById: vi.fn(),
		list: vi.fn(),
		getUsageStats: vi.fn(),
		generateCode: vi.fn(),
	},
	pendingMembers: {
		listPending: vi.fn(),
		countPending: vi.fn(),
		approve: vi.fn(),
		reject: vi.fn(),
		bulkApprove: vi.fn(),
		bulkReject: vi.fn(),
	},
	qrCodes: { generateInviteQR: vi.fn() },
	baseUrl: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller));
});
// Each service method answers what its mock returns, as an Effect.
const effectOf = (methods: Record<string, ReturnType<typeof vi.fn>>) => () =>
	Object.fromEntries(
		Object.entries(methods).map(([name, method]) => [
			name,
			(...args: unknown[]) => Effect.suspend(() => method(...args) as Effect.Effect<unknown>),
		]),
	);
vi.mock("@/lib/effect/services/invite-code.service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/effect/services/invite-code.service")>();
	const { Layer } = await import("effect");
	return {
		...actual,
		InviteCodeServiceLive: Layer.sync(
			actual.InviteCodeService,
			effectOf(mocks.inviteCodes) as never,
		),
	};
});
vi.mock("@/lib/effect/services/pending-member.service", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/effect/services/pending-member.service")>();
	const { Layer } = await import("effect");
	return {
		...actual,
		PendingMemberServiceLive: Layer.sync(
			actual.PendingMemberService,
			effectOf(mocks.pendingMembers) as never,
		),
	};
});
vi.mock("@/lib/effect/services/qrcode.service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/effect/services/qrcode.service")>();
	const { Layer } = await import("effect");
	return {
		...actual,
		QRCodeServiceLive: Layer.sync(actual.QRCodeService, effectOf(mocks.qrCodes) as never),
	};
});
vi.mock("@/lib/app-url", () => ({ getOrganizationBaseUrl: mocks.baseUrl }));

const actions = await import("./invite-code-actions");

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
const inviteCode = { id: "code-1", code: "JOIN-ABC123", organizationId: "org-1" };

const calls = [
	["createInviteCode", () => actions.createInviteCode({ label: "Front desk" })],
	[
		"updateInviteCode",
		() => actions.updateInviteCode({ inviteCodeId: "code-1", label: "Renamed" }),
	],
	["deleteInviteCode", () => actions.deleteInviteCode("code-1")],
	["listInviteCodes", () => actions.listInviteCodes()],
	["getInviteCodeStats", () => actions.getInviteCodeStats("code-1")],
	[
		"generateInviteQRCode",
		() => actions.generateInviteQRCode({ inviteCodeId: "code-1", format: "svg" }),
	],
	["generateRandomCode", () => actions.generateRandomCode()],
	["getInviteBaseUrl", () => actions.getInviteBaseUrl()],
	["listPendingMembers", () => actions.listPendingMembers()],
	["getPendingMemberCount", () => actions.getPendingMemberCount()],
	["approvePendingMember", () => actions.approvePendingMember({ memberId: "member-1" })],
	["rejectPendingMember", () => actions.rejectPendingMember({ memberId: "member-1" })],
	[
		"bulkApprovePendingMembers",
		() => actions.bulkApprovePendingMembers({ memberIds: ["member-1"] }),
	],
	["bulkRejectPendingMembers", () => actions.bulkRejectPendingMembers({ memberIds: ["member-1"] })],
] as const;

const allMethods = () => [
	...Object.values(mocks.inviteCodes),
	...Object.values(mocks.pendingMembers),
	mocks.qrCodes.generateInviteQR,
	mocks.baseUrl,
];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.inviteCodes.create.mockReturnValue(Effect.succeed({ id: "code-1" }));
	mocks.inviteCodes.update.mockReturnValue(Effect.succeed({ id: "code-1" }));
	mocks.inviteCodes.delete.mockReturnValue(Effect.void);
	mocks.inviteCodes.getById.mockReturnValue(Effect.succeed(inviteCode));
	mocks.inviteCodes.list.mockReturnValue(Effect.succeed([inviteCode]));
	mocks.inviteCodes.getUsageStats.mockReturnValue(
		Effect.succeed({ total: 1, pending: 0, approved: 1, rejected: 0 }),
	);
	mocks.inviteCodes.generateCode.mockReturnValue(Effect.succeed("JOIN-XYZ789"));
	mocks.pendingMembers.listPending.mockReturnValue(Effect.succeed([]));
	mocks.pendingMembers.countPending.mockReturnValue(Effect.succeed(2));
	mocks.pendingMembers.approve.mockReturnValue(Effect.succeed({ success: true }));
	mocks.pendingMembers.reject.mockReturnValue(Effect.succeed({ success: true }));
	mocks.pendingMembers.bulkApprove.mockReturnValue(Effect.succeed({ approved: 1, failed: 0 }));
	mocks.pendingMembers.bulkReject.mockReturnValue(Effect.succeed({ rejected: 1, failed: 0 }));
	mocks.qrCodes.generateInviteQR.mockReturnValue(Effect.succeed({ data: "<svg/>", format: "svg" }));
	mocks.baseUrl.mockResolvedValue("https://acme.example.com");
});

describe("invite code and pending member actions", () => {
	it.each(calls)("lets an org admin run %s", async (_name, run) => {
		expect(await run()).toMatchObject({ success: true });
	});

	it.each(calls)("refuses %s to a scoped manager", async (_name, run) => {
		mocks.caller = scopedManager;

		expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
		for (const method of allMethods()) expect(method).not.toHaveBeenCalled();
	});

	it.each([
		[
			"a former admin",
			{ ...orgAdmin, employee: { id: "e", role: "admin" as const, former: true } },
		],
		["a pending membership", { ...orgAdmin, membershipRole: null }],
		["a signed-out caller", null],
	])("refuses %s", async (_case, caller) => {
		mocks.caller = caller;

		for (const [, run] of calls) expect(await run()).toMatchObject({ success: false });
		for (const method of allMethods()) expect(method).not.toHaveBeenCalled();
	});

	it("creates a code in the session's organization, upper-cased and attributed", async () => {
		expect(
			await actions.createInviteCode({ code: "JOIN-1234", label: "Front desk", maxUses: 5 }),
		).toEqual({ success: true, data: inviteCode });
		expect(mocks.inviteCodes.create).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				code: "JOIN-1234",
				label: "Front desk",
				maxUses: 5,
				requiresApproval: true,
				createdBy: "user-admin",
			}),
		);
		expect(mocks.inviteCodes.getById).toHaveBeenCalledWith("code-1", "org-1");
	});

	it.each([
		["a submitted organization", { label: "Front desk", organizationId: "org-other" }],
		["a malformed code", { label: "Front desk", code: "bad code!" }],
		["a missing label", { label: "" }],
	])("refuses to create a code with %s", async (_case, input) => {
		expect(
			await actions.createInviteCode(input as Parameters<typeof actions.createInviteCode>[0]),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.inviteCodes.create).not.toHaveBeenCalled();
	});

	it("scopes code reads and writes by ID and the session's organization", async () => {
		await actions.updateInviteCode({ inviteCodeId: "code-1", status: "paused" });
		await actions.deleteInviteCode("code-1");
		await actions.getInviteCodeStats("code-1");
		await actions.generateInviteQRCode({ inviteCodeId: "code-1", format: "png" });

		expect(mocks.inviteCodes.update).toHaveBeenCalledWith("code-1", "org-1", {
			status: "paused",
			updatedBy: "user-admin",
		});
		expect(mocks.inviteCodes.delete).toHaveBeenCalledWith("code-1", "org-1", "user-admin");
		expect(mocks.inviteCodes.getUsageStats).toHaveBeenCalledWith("code-1", "org-1");
		expect(mocks.inviteCodes.getById).toHaveBeenCalledWith("code-1", "org-1");
		expect(mocks.qrCodes.generateInviteQR).toHaveBeenCalledWith(
			"JOIN-ABC123",
			"https://acme.example.com",
			"png",
		);
		expect(mocks.baseUrl).toHaveBeenCalledWith("org-1");
	});

	it("treats another organization's code as not found when generating its QR code", async () => {
		mocks.inviteCodes.getById.mockReturnValue(Effect.succeed(null));

		expect(
			await actions.generateInviteQRCode({ inviteCodeId: "code-other", format: "svg" }),
		).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mocks.qrCodes.generateInviteQR).not.toHaveBeenCalled();
	});

	it("approves and rejects pending members of the session's organization only", async () => {
		await actions.approvePendingMember({ memberId: "member-1", assignedTeamId: "team-1" });
		await actions.rejectPendingMember({ memberId: "member-2", notes: "Unknown" });
		await actions.bulkApprovePendingMembers({ memberIds: ["m1", "m2"], assignedTeamId: "team-1" });
		await actions.bulkRejectPendingMembers({ memberIds: ["m3"], notes: "Spam" });

		expect(mocks.pendingMembers.approve).toHaveBeenCalledWith({
			memberId: "member-1",
			assignedTeamId: "team-1",
			organizationId: "org-1",
			approvedBy: "user-admin",
		});
		expect(mocks.pendingMembers.reject).toHaveBeenCalledWith({
			memberId: "member-2",
			notes: "Unknown",
			organizationId: "org-1",
			rejectedBy: "user-admin",
		});
		expect(mocks.pendingMembers.bulkApprove).toHaveBeenCalledWith(
			["m1", "m2"],
			"org-1",
			"user-admin",
			"team-1",
		);
		expect(mocks.pendingMembers.bulkReject).toHaveBeenCalledWith(
			["m3"],
			"org-1",
			"user-admin",
			"Spam",
		);
	});

	it("refuses a pending member approval that names another organization", async () => {
		expect(
			await actions.approvePendingMember({
				memberId: "member-1",
				organizationId: "org-other",
			} as Parameters<typeof actions.approvePendingMember>[0]),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.pendingMembers.approve).not.toHaveBeenCalled();
	});
});
