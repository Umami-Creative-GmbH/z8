import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	loadGoLiveViewer: vi.fn(),
	rehearse: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, { db: { marker: "db" } }),
	);
});
vi.mock("./queries", () => ({ loadGoLiveViewer: mocks.loadGoLiveViewer }));
vi.mock("@/lib/implementation-checklist/go-live/rehearsal", () => ({
	rehearseGoLiveMember: mocks.rehearse,
}));

const { rehearseGoLiveMemberAction } = await import("./go-live-rehearsal-actions");

const viewer = { asOf: { timezone: "Europe/Berlin" }, fixLink: () => null };

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};

describe("rehearseGoLiveMemberAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdmin;
		mocks.loadGoLiveViewer.mockResolvedValue(viewer);
	});

	it("rehearses the member in the caller's own organization", async () => {
		mocks.rehearse.mockResolvedValue({ ok: true, rehearsal: { marker: "trace" } });

		await expect(rehearseGoLiveMemberAction("employee:e-1")).resolves.toEqual({
			success: true,
			data: { marker: "trace" },
		});
		expect(mocks.loadGoLiveViewer).toHaveBeenCalledWith("org-1", expect.anything());
		expect(mocks.rehearse).toHaveBeenCalledWith(
			{ marker: "db" },
			expect.objectContaining({
				organizationId: "org-1",
				memberKey: "employee:e-1",
				asOf: viewer.asOf,
				fixLink: viewer.fixLink,
			}),
		);
	});

	it("refuses a scoped manager, one level below org admin, without rehearsing", async () => {
		mocks.caller = scopedManager;

		await expect(rehearseGoLiveMemberAction("employee:e-1")).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.rehearse).not.toHaveBeenCalled();
	});

	it("refuses a member who isn't checked", async () => {
		mocks.rehearse.mockResolvedValue({ ok: false, refusal: "member_not_checked" });

		await expect(rehearseGoLiveMemberAction("employee:elsewhere")).resolves.toMatchObject({
			success: false,
			refusal: "member_not_checked",
		});
	});

	it.each([42, null, "x".repeat(201)])("refuses a malformed member key %#", async (memberKey) => {
		await expect(rehearseGoLiveMemberAction(memberKey as string)).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
		});
		expect(mocks.rehearse).not.toHaveBeenCalled();
	});

	it("is unavailable, never a partial trace, when a lookup fails", async () => {
		mocks.rehearse.mockRejectedValue(new Error("connection terminated"));

		const result = await rehearseGoLiveMemberAction("employee:e-1");

		expect(result).toMatchObject({ success: false });
		expect(result).not.toHaveProperty("data");
		expect(result).not.toHaveProperty("refusal");
	});
});
