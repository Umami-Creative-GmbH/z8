import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/effect/errors";
import type { StubCaller } from "@/test/organization-action";

/**
 * Travel expense settings actions on the organization action module (#1617):
 * org admins configure travel expenses; the stores are stubbed.
 */

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	selectRows: vi.fn(),
	insert: vi.fn(),
	transaction: vi.fn(),
	store: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

const store = (name: string) => {
	mocks.store[name] ??= vi.fn();
	return mocks.store[name];
};

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	// A select query: its builder steps return itself, awaiting it yields `selectRows()`.
	const rows = () => {
		const query = Promise.resolve().then(() => mocks.selectRows());
		const steps = ["from", "innerJoin", "where", "orderBy", "limit"];
		return Object.assign(query, Object.fromEntries(steps.map((step) => [step, () => query])));
	};
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				select: () => rows(),
				insert: mocks.insert,
				transaction: mocks.transaction,
			},
		}),
	);
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit-logger", () => ({
	AuditAction: new Proxy({}, { get: (_target, name) => String(name) }),
	logAudit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/travel-expenses/allowance-policy-store", () => ({
	activateMileagePolicyVersion: store("activateMileagePolicyVersion"),
	loadMileagePolicyVersions: store("loadMileagePolicyVersions"),
	withdrawMileagePolicyVersion: store("withdrawMileagePolicyVersion"),
}));
vi.mock("@/lib/travel-expenses/per-diem-policy-store", () => ({
	activatePerDiemPolicyVersion: store("activatePerDiemPolicyVersion"),
	loadPerDiemPolicyVersions: store("loadPerDiemPolicyVersions"),
	withdrawPerDiemPolicyVersion: store("withdrawPerDiemPolicyVersion"),
}));
vi.mock("@/lib/travel-expenses/reference-rate-read", () => ({
	loadReferenceRatePolicy: store("loadReferenceRatePolicy"),
	loadReferenceRateProviderStatus: store("loadReferenceRateProviderStatus"),
}));
vi.mock("@/lib/travel-expenses/reference-rate-store", () => ({
	approveReferenceRatePolicy: store("approveReferenceRatePolicy"),
	revokeReferenceRatePolicy: store("revokeReferenceRatePolicy"),
}));
vi.mock("@/lib/travel-expenses/conversion-read", () => ({
	loadOrganizationReimbursementCurrency: store("loadOrganizationReimbursementCurrency"),
}));
vi.mock("@/lib/travel-expenses/conversion-store", () => ({
	authorizeManualConversionRate: store("authorizeManualConversionRate"),
	clearItemConversion: store("clearItemConversion"),
	listForeignDraftItems: store("listForeignDraftItems"),
	saveOrganizationReimbursementCurrency: store("saveOrganizationReimbursementCurrency"),
}));
vi.mock("@/lib/travel-expenses/allowance-override-store", () => ({
	authorizeAllowanceOverride: store("authorizeAllowanceOverride"),
	listAllowanceExceptionItems: store("listAllowanceExceptionItems"),
	revokeAllowanceOverride: store("revokeAllowanceOverride"),
}));
vi.mock("@/lib/travel-expenses/project-attribution-exception-store", () => ({
	authorizeProjectAttributionException: store("authorizeProjectAttributionException"),
	listProjectAttributionExceptions: store("listProjectAttributionExceptions"),
}));
vi.mock("@/lib/travel-expenses/expense-officer-grant-store", () => ({
	listActiveExpenseOfficerGrants: store("listActiveExpenseOfficerGrants"),
	revokeExpenseOfficerGrant: store("revokeExpenseOfficerGrant"),
	saveExpenseOfficerGrant: store("saveExpenseOfficerGrant"),
}));
vi.mock("@/lib/travel-expenses/receipt-exception-read", () => ({
	loadReceiptExceptionsAllowed: store("loadReceiptExceptionsAllowed"),
}));

const mileage = await import("./mileage-policy-actions");
const perDiem = await import("./per-diem-policy-actions");
const referenceRate = await import("./reference-rate-actions");
const conversion = await import("./conversion-actions");
const allowance = await import("./allowance-override-actions");
const projectException = await import("./project-exception-actions");
const expenseOfficer = await import("./expense-officer-actions");
const receiptException = await import("./receipt-exception-actions");
const approver = await import("./approver-actions");

const REPORT = "00000000-0000-4000-8000-000000000001";
const ITEM = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE = "00000000-0000-4000-8000-000000000003";
const PROJECT = "00000000-0000-4000-8000-000000000004";
const VERSION = "00000000-0000-4000-8000-000000000005";
const OVERRIDE = "00000000-0000-4000-8000-000000000006";

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "admin-employee", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "manager-employee", role: "manager", former: false },
};

const item = { reportId: REPORT, itemId: ITEM, expectedVersion: 1 };
const policyVersion = { source: "organization" as const, effectiveFrom: "2026-01-01" };

const everyAction: [string, () => Promise<unknown>][] = [
	["getMileagePolicySettings", () => mileage.getMileagePolicySettings()],
	[
		"activateMileagePolicyVersionAction",
		() => mileage.activateMileagePolicyVersionAction(policyVersion),
	],
	[
		"withdrawMileagePolicyVersionAction",
		() => mileage.withdrawMileagePolicyVersionAction({ versionId: VERSION }),
	],
	["getPerDiemPolicySettings", () => perDiem.getPerDiemPolicySettings()],
	[
		"activatePerDiemPolicyVersionAction",
		() => perDiem.activatePerDiemPolicyVersionAction(policyVersion),
	],
	[
		"withdrawPerDiemPolicyVersionAction",
		() => perDiem.withdrawPerDiemPolicyVersionAction({ versionId: VERSION }),
	],
	["getReferenceRateSettings", () => referenceRate.getReferenceRateSettings()],
	[
		"approveReferenceRateSource",
		() => referenceRate.approveReferenceRateSource({ provider: "ecb", acknowledged: true }),
	],
	["revokeReferenceRateSource", () => referenceRate.revokeReferenceRateSource()],
	["getReimbursementCurrencySetting", () => conversion.getReimbursementCurrencySetting()],
	[
		"saveReimbursementCurrencySetting",
		() => conversion.saveReimbursementCurrencySetting({ currency: "EUR" }),
	],
	["getForeignDraftExpenses", () => conversion.getForeignDraftExpenses()],
	[
		"authorizeManualConversionRateAction",
		() =>
			conversion.authorizeManualConversionRateAction({
				...item,
				rate: {
					base: "USD",
					quote: "EUR",
					rate: "0.9",
					rateDate: "2026-01-01",
					reason: "r",
					evidence: "e",
				},
			}),
	],
	["clearItemConversionAction", () => conversion.clearItemConversionAction(item)],
	["getAllowanceExceptionItems", () => allowance.getAllowanceExceptionItems()],
	[
		"authorizeAllowanceOverrideAction",
		() =>
			allowance.authorizeAllowanceOverrideAction({
				...item,
				amount: "10.00",
				reason: "r",
				evidence: "e",
				calculationBasis: "c",
			}),
	],
	[
		"revokeAllowanceOverrideAction",
		() => allowance.revokeAllowanceOverrideAction({ ...item, overrideId: OVERRIDE }),
	],
	[
		"getProjectAttributionExceptionSettings",
		() => projectException.getProjectAttributionExceptionSettings(),
	],
	[
		"authorizeProjectAttributionExceptionAction",
		() =>
			projectException.authorizeProjectAttributionExceptionAction({
				employeeId: EMPLOYEE,
				projectId: PROJECT,
				validFrom: "2026-01-01",
				validTo: "2026-01-31",
				reason: "r",
				evidence: "e",
			}),
	],
	["getExpenseOfficerAdminData", () => expenseOfficer.getExpenseOfficerAdminData()],
	[
		"saveExpenseOfficerGrantAction",
		() =>
			expenseOfficer.saveExpenseOfficerGrantAction({
				officerEmployeeId: EMPLOYEE,
				scope: "all",
				teamIds: [],
				employeeIds: [],
				canExport: true,
				canRecordReimbursements: false,
			}),
	],
	[
		"revokeExpenseOfficerGrantAction",
		() => expenseOfficer.revokeExpenseOfficerGrantAction({ grantId: VERSION }),
	],
	["getReceiptExceptionSettings", () => receiptException.getReceiptExceptionSettings()],
	[
		"saveReceiptExceptionSettings",
		() => receiptException.saveReceiptExceptionSettings({ missingReceiptExceptionsAllowed: true }),
	],
	["getTravelExpenseApproverSettings", () => approver.getTravelExpenseApproverSettings()],
	[
		"saveTravelExpenseApprover",
		() => approver.saveTravelExpenseApprover({ expenseApproverEmployeeId: null }),
	],
];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.selectRows.mockResolvedValue([]);
	mocks.insert.mockReturnValue({
		values: () => ({ onConflictDoUpdate: async () => undefined }),
	});
	mocks.transaction.mockImplementation(async (run: (tx: unknown) => unknown) => run({}));
});

describe("travel expense settings require an org admin", () => {
	it.each(everyAction)(
		"%s refuses a scoped manager before any read or write",
		async (_name, call) => {
			mocks.caller = scopedManager;

			await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
			for (const fn of Object.values(mocks.store)) expect(fn).not.toHaveBeenCalled();
			expect(mocks.selectRows).not.toHaveBeenCalled();
			expect(mocks.insert).not.toHaveBeenCalled();
		},
	);

	it("refuses a former employee who is an owner", async () => {
		mocks.caller = {
			...orgAdmin,
			membershipRole: "owner",
			employee: { id: "admin-employee", role: "admin", former: true },
		};

		await expect(mileage.getMileagePolicySettings()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});
});

describe("writes attributed to the administrator's employee profile", () => {
	it("refuses an org admin without one before authorizing an override", async () => {
		mocks.caller = { ...orgAdmin, employee: null };

		await expect(
			allowance.authorizeAllowanceOverrideAction({
				...item,
				amount: "10.00",
				reason: "r",
				evidence: "e",
				calculationBasis: "c",
			}),
		).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "An employee profile in this organization is required",
		});
		expect(store("authorizeAllowanceOverride")).not.toHaveBeenCalled();
	});

	it("attributes an override to the administrator in the session's organization", async () => {
		store("authorizeAllowanceOverride").mockResolvedValue({ kind: "stale" });

		await expect(
			allowance.authorizeAllowanceOverrideAction({
				...item,
				amount: "10.00",
				reason: "r",
				evidence: "e",
				calculationBasis: "c",
			}),
		).resolves.toEqual({ success: true, data: { kind: "stale" } });
		expect(store("authorizeAllowanceOverride")).toHaveBeenCalledWith(
			expect.anything(),
			{ organizationId: "org-1", userId: "user-1", employeeId: "admin-employee" },
			expect.objectContaining({ reportId: REPORT, itemId: ITEM }),
		);
	});

	it("lets an org admin without an employee profile save a mileage policy", async () => {
		mocks.caller = { ...orgAdmin, employee: null };
		store("activateMileagePolicyVersion").mockResolvedValue({ kind: "stale_replacement" });

		await expect(
			mileage.activateMileagePolicyVersionAction({
				source: "organization",
				effectiveFrom: "2026-01-01",
				currency: "EUR",
				ratesPerKm: { car: "0.30" },
			}),
		).resolves.toEqual({ success: true, data: { status: "stale_replacement" } });
		expect(store("activateMileagePolicyVersion")).toHaveBeenCalledWith(
			expect.anything(),
			{ organizationId: "org-1", userId: "user-1" },
			expect.anything(),
		);
	});
});

describe("input", () => {
	it("refuses a malformed version ID as not found, before the store", async () => {
		await expect(
			mileage.withdrawMileagePolicyVersionAction({ versionId: "not-a-uuid" }),
		).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Mileage policy version not found",
		});
		expect(store("withdrawMileagePolicyVersion")).not.toHaveBeenCalled();
	});

	it("refuses an unacknowledged reference rate source", async () => {
		await expect(
			referenceRate.approveReferenceRateSource({ provider: "ecb", acknowledged: false }),
		).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Confirm how the reference rates may be used",
		});
		expect(store("approveReferenceRatePolicy")).not.toHaveBeenCalled();
	});

	it("refuses an expense that is not named by ID", async () => {
		await expect(
			conversion.clearItemConversionAction({ ...item, itemId: "item-1" }),
		).resolves.toMatchObject({ success: false, code: "ValidationError", error: "Invalid expense" });
		expect(store("clearItemConversion")).not.toHaveBeenCalled();
	});
});

describe("expense approver", () => {
	it("refuses an approver who is not an active manager or admin of the organization", async () => {
		mocks.selectRows
			// The approver is on the current roster ...
			.mockResolvedValueOnce([{ id: EMPLOYEE }])
			// ... but not one of the organization's active managers or admins.
			.mockResolvedValueOnce([{ id: "other", name: "Other", role: "manager" }]);

		await expect(
			approver.saveTravelExpenseApprover({ expenseApproverEmployeeId: EMPLOYEE }),
		).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Choose an active manager or administrator of this organization",
		});
		expect(mocks.insert).not.toHaveBeenCalled();
	});

	it("clears the approver", async () => {
		await expect(
			approver.saveTravelExpenseApprover({ expenseApproverEmployeeId: null }),
		).resolves.toEqual({ success: true, data: { expenseApproverEmployeeId: null } });
		expect(mocks.insert).toHaveBeenCalledTimes(1);
	});
});

describe("expense officers", () => {
	const grant = {
		officerEmployeeId: EMPLOYEE,
		scope: "all" as const,
		teamIds: [],
		employeeIds: [],
		canExport: true,
		canRecordReimbursements: true,
	};

	it("refuses an officer who is not on the current roster", async () => {
		mocks.selectRows.mockResolvedValueOnce([]);

		await expect(expenseOfficer.saveExpenseOfficerGrantAction(grant)).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "former_employee",
		});
		expect(store("saveExpenseOfficerGrant")).not.toHaveBeenCalled();
	});

	it("returns the store's validation message to the administrator", async () => {
		mocks.selectRows.mockResolvedValueOnce([{ id: EMPLOYEE }]);
		store("saveExpenseOfficerGrant").mockRejectedValue(
			new ValidationError({ message: "All teams must belong to the active organization" }),
		);

		await expect(
			expenseOfficer.saveExpenseOfficerGrantAction({
				officerEmployeeId: EMPLOYEE,
				scope: "specific",
				teamIds: [PROJECT],
				employeeIds: [],
				canExport: false,
				canRecordReimbursements: false,
			}),
		).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "All teams must belong to the active organization",
		});
	});

	it("saves the grant in a transaction for the session's organization", async () => {
		mocks.selectRows.mockResolvedValueOnce([{ id: EMPLOYEE }]);
		store("saveExpenseOfficerGrant").mockResolvedValue({ grantId: "grant-1" });

		await expect(expenseOfficer.saveExpenseOfficerGrantAction(grant)).resolves.toEqual({
			success: true,
			data: { grantId: "grant-1" },
		});
		expect(store("saveExpenseOfficerGrant")).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ organizationId: "org-1", actorUserId: "user-1" }),
		);
	});
});
