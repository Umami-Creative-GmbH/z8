import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	select: vi.fn(),
	testConnection: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, { db: { select: mocks.select } }),
	);
});

vi.mock("@/lib/clockodo/client", () => ({
	ClockodoClient: vi.fn(function ClockodoClient() {
		return { testConnection: mocks.testConnection };
	}),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

const { importClockodoData, saveProjectMappings, validateClockodoCredentials } = await import(
	"./actions"
);

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
});

describe("Clockodo import actions", () => {
	it("disables direct production imports", async () => {
		await expect(importClockodoData()).resolves.toMatchObject({
			success: false,
			error: "Direct Clockodo imports are disabled. Start an import review scan instead.",
		});
	});

	it.each([
		["an org member", { ...orgAdmin, membershipRole: "member" }],
		[
			"a scoped manager",
			{
				...orgAdmin,
				membershipRole: "member",
				employee: { id: "e-1", role: "manager" as const, former: false },
			},
		],
		[
			"an owner who is a former employee",
			{ ...orgAdmin, employee: { id: "e-1", role: "admin" as const, former: true } },
		],
	])("refuses %s before contacting Clockodo", async (_case, caller) => {
		mocks.caller = caller;

		await expect(
			validateClockodoCredentials({ email: "admin@example.com", apiKey: "key" }),
		).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.testConnection).not.toHaveBeenCalled();
	});

	it("requires an email and an API key", async () => {
		await expect(validateClockodoCredentials({ email: " ", apiKey: "key" })).resolves.toMatchObject(
			{ success: false, code: "ValidationError", error: "Email and API key are required" },
		);
		expect(mocks.testConnection).not.toHaveBeenCalled();
	});

	it("refuses invalid credentials", async () => {
		mocks.testConnection.mockResolvedValueOnce(false);

		await expect(
			validateClockodoCredentials({ email: "admin@example.com", apiKey: "key" }),
		).resolves.toMatchObject({
			success: false,
			error: "Invalid credentials. Check your Clockodo email and API key.",
		});
	});

	it("refuses project mappings that are not project IDs before touching the database", async () => {
		await expect(
			saveProjectMappings({
				mappings: [{ clockodoProjectId: 31, clockodoProjectName: "Website", projectId: "nope" }],
			} as never),
		).resolves.toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.select).not.toHaveBeenCalled();
	});

	it("refuses projects of another organization", async () => {
		mocks.select.mockReturnValue({
			from: () => ({ where: async () => [] }),
		});

		await expect(
			saveProjectMappings({
				mappings: [
					{
						clockodoProjectId: 31,
						clockodoProjectName: "Website",
						projectId: "8a6e0804-2bd0-4672-b79d-d97027f53070",
					},
				],
			} as never),
		).resolves.toMatchObject({
			success: false,
			error: "One or more projects do not belong to this organization",
		});
	});
});
