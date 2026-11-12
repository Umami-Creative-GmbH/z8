import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	createOrganizationApiKey: vi.fn(),
	getOrganizationApiKey: vi.fn(),
	listOrganizationApiKeys: vi.fn(),
	revokeOrganizationApiKey: vi.fn(),
	updateOrganizationApiKey: vi.fn(),
	listRecentKeyRequests: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: {} }));
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/public-api/keys/key-store", () => ({
	createOrganizationApiKey: mocks.createOrganizationApiKey,
	getOrganizationApiKey: mocks.getOrganizationApiKey,
	listOrganizationApiKeys: mocks.listOrganizationApiKeys,
	revokeOrganizationApiKey: mocks.revokeOrganizationApiKey,
	updateOrganizationApiKey: mocks.updateOrganizationApiKey,
}));
vi.mock("@/lib/public-api/request-log", () => ({
	listRecentKeyRequests: mocks.listRecentKeyRequests,
}));

const { createApiKey, deleteApiKey, getApiKeyDetail, listApiKeys, updateApiKey } = await import(
	"./actions"
);

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
});

describe("API key actions", () => {
	it.each([
		["listApiKeys", () => listApiKeys()],
		["getApiKeyDetail", () => getApiKeyDetail({ keyId: "key-1" })],
		["createApiKey", () => createApiKey({ name: "CI", scopes: [] } as never)],
		["updateApiKey", () => updateApiKey({ keyId: "key-1", enabled: false })],
		["deleteApiKey", () => deleteApiKey({ keyId: "key-1" })],
	] as const)("%s refuses a scoped manager", async (_name, call) => {
		mocks.caller = {
			...orgAdmin,
			membershipRole: "member",
			employee: { id: "employee-1", role: "manager", former: false },
		};

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.listOrganizationApiKeys).not.toHaveBeenCalled();
		expect(mocks.getOrganizationApiKey).not.toHaveBeenCalled();
		expect(mocks.createOrganizationApiKey).not.toHaveBeenCalled();
		expect(mocks.updateOrganizationApiKey).not.toHaveBeenCalled();
		expect(mocks.revokeOrganizationApiKey).not.toHaveBeenCalled();
	});

	it("lists the keys of the session's organization", async () => {
		mocks.listOrganizationApiKeys.mockResolvedValue([]);

		await expect(listApiKeys()).resolves.toEqual({ success: true, data: [] });
		expect(mocks.listOrganizationApiKeys).toHaveBeenCalledWith(expect.anything(), "org-1");
	});

	it("reports a key of another organization as not found", async () => {
		mocks.getOrganizationApiKey.mockResolvedValue(null);

		await expect(getApiKeyDetail({ keyId: "key-9" })).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(mocks.getOrganizationApiKey).toHaveBeenCalledWith(expect.anything(), "org-1", "key-9");
	});

	it("revokes a key of the session's organization as the caller", async () => {
		mocks.revokeOrganizationApiKey.mockResolvedValue({ ok: true });

		await expect(deleteApiKey({ keyId: "key-1" })).resolves.toEqual({
			success: true,
			data: undefined,
		});
		expect(mocks.revokeOrganizationApiKey).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			actorUserId: "user-1",
			keyId: "key-1",
		});
	});

	it("updates a key with the validated change only", async () => {
		mocks.updateOrganizationApiKey.mockResolvedValue({ ok: true });

		await updateApiKey({ keyId: "key-1", enabled: false });

		expect(mocks.updateOrganizationApiKey).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			actorUserId: "user-1",
			keyId: "key-1",
			change: { enabled: false },
		});
	});
});
