import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const EMPLOYEE_ID = "7d3c8f8e-2b7a-4f7e-9a51-0d6f1c2b3a4e";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	listAdminPersonalDataExports: vi.fn(),
	requestPersonalDataExport: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: {} }));
});
vi.mock("@/lib/personal-data-export/store", () => ({
	listAdminPersonalDataExports: mocks.listAdminPersonalDataExports,
	requestPersonalDataExport: mocks.requestPersonalDataExport,
}));

const { getEmployeePersonalDataExportsAction, requestEmployeePersonalDataExportAction } =
	await import("./personal-data-export.actions");

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "user-2",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-1", role: "manager", former: false },
};

describe("admin personal data export actions (#811)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = null;
	});

	it("lists the employee's admin exports in the org admin's organization", async () => {
		mocks.caller = orgAdmin;
		mocks.listAdminPersonalDataExports.mockResolvedValue({ ok: true, exports: [] });

		await expect(getEmployeePersonalDataExportsAction(EMPLOYEE_ID)).resolves.toEqual({
			success: true,
			data: [],
		});
		expect(mocks.listAdminPersonalDataExports).toHaveBeenCalledWith(
			{},
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: EMPLOYEE_ID,
				actorUserId: "user-1",
			}),
		);
	});

	it("refuses the admin's own record", async () => {
		mocks.caller = orgAdmin;
		mocks.listAdminPersonalDataExports.mockResolvedValue({ ok: false, reason: "own_record" });

		await expect(getEmployeePersonalDataExportsAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
			error: "Export your own data from My data instead",
		});
	});

	it("refuses a scoped manager, one level below org admin", async () => {
		mocks.caller = scopedManager;

		await expect(getEmployeePersonalDataExportsAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		await expect(requestEmployeePersonalDataExportAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.listAdminPersonalDataExports).not.toHaveBeenCalled();
		expect(mocks.requestPersonalDataExport).not.toHaveBeenCalled();
	});
});
