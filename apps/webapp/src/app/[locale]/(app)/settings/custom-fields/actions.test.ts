import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	changeCustomFields: vi.fn(),
	listCustomFieldDefinitions: vi.fn(),
	readCustomFieldSection: vi.fn(),
	loadCustomFieldViewerLevel: vi.fn(),
	employeeFindFirst: vi.fn(),
	projectFindFirst: vi.fn(),
	customerFindFirst: vi.fn(),
	select: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				query: {
					employee: { findFirst: mocks.employeeFindFirst },
					project: { findFirst: mocks.projectFindFirst },
					customer: { findFirst: mocks.customerFindFirst },
				},
				select: mocks.select,
			},
		}),
	);
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/organization/custom-fields/definitions", () => ({
	changeCustomFields: mocks.changeCustomFields,
	listCustomFieldDefinitions: mocks.listCustomFieldDefinitions,
}));

vi.mock("@/lib/organization/custom-fields/values", () => ({
	readCustomFieldSection: mocks.readCustomFieldSection,
	loadCustomFieldViewerLevel: mocks.loadCustomFieldViewerLevel,
}));

const { changeCustomFields, getCustomFieldDefinitions } = await import("./actions");
const { getCustomFieldSection, getOwnCustomFieldValues } = await import("./value-actions");

const recordId = "6f1c7a1e-0d7b-4b1a-9c55-2f4f0b6a1d11";

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};
const orgMember: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};

const section = { fields: [], values: {}, missingRequiredFieldIds: [], history: {}, today: "" };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.readCustomFieldSection.mockResolvedValue(section);
	mocks.loadCustomFieldViewerLevel.mockResolvedValue("admin");
});

describe("custom field settings actions", () => {
	it.each([
		["getCustomFieldDefinitions", scopedManager, () => getCustomFieldDefinitions()],
		[
			"changeCustomFields",
			scopedManager,
			() => changeCustomFields({ kind: "archive", fieldId: recordId }),
		],
		[
			"getCustomFieldSection",
			orgMember,
			() => getCustomFieldSection({ entity: "employee", recordId }),
		],
		[
			"getOwnCustomFieldValues",
			{ ...orgMember, membershipRole: null },
			() => getOwnCustomFieldValues(),
		],
	] as const)("%s refuses a caller one level below", async (_name, caller, call) => {
		mocks.caller = caller;

		await expect(call()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.changeCustomFields).not.toHaveBeenCalled();
		expect(mocks.listCustomFieldDefinitions).not.toHaveBeenCalled();
		expect(mocks.readCustomFieldSection).not.toHaveBeenCalled();
	});

	it("applies a change to the session's organization as the caller", async () => {
		mocks.changeCustomFields.mockResolvedValue({ ok: false, reason: "field_not_found" });

		await changeCustomFields({ kind: "archive", fieldId: recordId });

		expect(mocks.changeCustomFields).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				organizationId: "org-1",
				actorUserId: "user-1",
				change: { kind: "archive", fieldId: recordId },
			}),
		);
	});

	it("fails a refused change with its refusal code and details", async () => {
		mocks.changeCustomFields.mockResolvedValue({
			ok: false,
			reason: "used_as_payroll_identifier",
			configurations: ["Sage Lohn"],
		});

		expect(await changeCustomFields({ kind: "archive", fieldId: recordId })).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "used_as_payroll_identifier",
			details: { configurations: ["Sage Lohn"] },
		});
	});

	it("returns every definition after an accepted change", async () => {
		mocks.changeCustomFields.mockResolvedValue({ ok: true, fields: [] });

		expect(await changeCustomFields({ kind: "archive", fieldId: recordId })).toEqual({
			success: true,
			data: [],
		});
	});

	it("reads an employee section of the session's organization only", async () => {
		mocks.employeeFindFirst.mockResolvedValue(undefined);

		await expect(getCustomFieldSection({ entity: "employee", recordId })).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(mocks.readCustomFieldSection).not.toHaveBeenCalled();
	});

	it("lets only an org admin open the section of an employee being created", async () => {
		mocks.caller = scopedManager;
		await expect(
			getCustomFieldSection({ entity: "employee", recordId: null }),
		).resolves.toMatchObject({ success: false, code: "AuthorizationError" });

		mocks.caller = orgAdmin;
		await expect(getCustomFieldSection({ entity: "employee", recordId: null })).resolves.toEqual({
			success: true,
			data: section,
		});
	});

	it("refuses an unknown record kind", async () => {
		await expect(
			getCustomFieldSection({ entity: "invoice" as never, recordId: null }),
		).resolves.toMatchObject({ success: false, code: "ValidationError" });
	});
});
