import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mockState = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	clockinTestConnection: vi.fn(),
	clockinGetEmployees: vi.fn(),
	clockinSearchWorkdays: vi.fn(),
	clockinSearchAbsences: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mockState.caller));
});

vi.mock("@/lib/clockin/client", () => ({
	ClockinClient: class {
		testConnection = mockState.clockinTestConnection;
		getEmployees = mockState.clockinGetEmployees;
		searchWorkdays = mockState.clockinSearchWorkdays;
		searchAbsences = mockState.clockinSearchAbsences;
	},
}));

const { fetchClockinEmployees, importClockinData, validateClockinCredentials } = await import(
	"./clockin-actions"
);

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org_123",
	membershipRole: "admin",
	employee: null,
};

describe("Clockin actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.caller = orgAdmin;
		mockState.clockinTestConnection.mockResolvedValue({ success: true });
		mockState.clockinGetEmployees.mockResolvedValue([]);
		mockState.clockinSearchWorkdays.mockResolvedValue([]);
		mockState.clockinSearchAbsences.mockResolvedValue([]);
	});

	it("refuses a caller who is not an org admin before contacting Clockin", async () => {
		mockState.caller = { ...orgAdmin, membershipRole: "member" };

		const result = await validateClockinCredentials({ token: "token" });

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.clockinTestConnection).not.toHaveBeenCalled();
	});

	it("requires an API token", async () => {
		await expect(validateClockinCredentials({ token: "  " })).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "API token is required",
		});
		expect(mockState.clockinTestConnection).not.toHaveBeenCalled();
	});

	it("fetches provider employees for authorized admins", async () => {
		mockState.clockinGetEmployees.mockResolvedValue([
			{ id: 1, first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" },
		]);

		const result = await fetchClockinEmployees({ token: "token" });

		expect(result).toEqual({
			success: true,
			data: [{ id: 1, name: "Ada Lovelace", email: "ada@example.com" }],
		});
	});

	it("disables direct Clockin production imports", async () => {
		await expect(importClockinData()).resolves.toMatchObject({
			success: false,
			error: "Direct Clockin imports are disabled. Start an import review scan instead.",
		});
	});
});
