import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	query: vi.fn(),
	setBillableTimeEnabled: vi.fn(),
	changeBillableCurrency: vi.fn(),
	changeBillableRate: vi.fn(),
	changeCostRate: vi.fn(),
}));

// Every query a refused caller could reach is recorded; none may run.
vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			query: (name, fn) => {
				mocks.query(name);
				return Effect.promise(fn);
			},
		}),
	);
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/billable-time/module-switch", () => ({
	setBillableTimeEnabled: mocks.setBillableTimeEnabled,
	changeBillableCurrency: mocks.changeBillableCurrency,
}));
vi.mock("@/lib/billable-time/billable-rates", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/billable-time/billable-rates")>()),
	changeBillableRate: mocks.changeBillableRate,
}));
vi.mock("@/lib/billable-time/cost-rates", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/billable-time/cost-rates")>()),
	changeCostRate: mocks.changeCostRate,
}));

const core = await import("./actions");
const bulk = await import("./bulk-billability-actions");
const rates = await import("./rates/actions");
const costRates = await import("./cost-rates/actions");
const accounting = await import("./accounting/actions");
const handOff = await import("./hand-off/actions");

const owner: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
const orgAdmin: StubCaller = { ...owner, membershipRole: "admin" };
const scopedManager: StubCaller = {
	...owner,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};

const id = "6f1c7a1e-0d7b-4b1a-9c55-2f4f0b6a1d11";
const handOffRequest = {
	customerId: id,
	periodFrom: "2026-10-01",
	periodTo: "2026-10-31",
	projectIds: null,
	includeTimesheet: false,
	locale: "en",
};
const taxTreatment = { kind: "domestic", ratePercent: "19" } as never;

/** Every billable-time action that needs an org admin, called with a plausible input. */
const orgAdminActions = [
	["updateBillableCurrency", () => core.updateBillableCurrency({ currency: "EUR" })],
	[
		"previewBulkBillability",
		() =>
			bulk.previewBulkBillability({
				projectId: id,
				fromDay: "2026-10-01",
				toDay: "2026-10-31",
				billable: true,
			}),
	],
	[
		"applyBulkBillability",
		() =>
			bulk.applyBulkBillability({
				projectId: id,
				fromDay: "2026-10-01",
				toDay: "2026-10-31",
				billable: true,
				fingerprint: "0".repeat(64),
			}),
	],
	[
		"getBillableRateHistory",
		() => rates.getBillableRateHistory({ target: { level: "organization" } }),
	],
	[
		"setBillableRate",
		() =>
			rates.setBillableRate({
				target: { level: "organization" },
				effectiveFrom: "2026-10-01",
				rate: "90",
			}),
	],
	[
		"endBillableRate",
		() => rates.endBillableRate({ target: { level: "organization" }, effectiveFrom: "2026-10-01" }),
	],
	["getCostRateHistory", () => costRates.getCostRateHistory({ employeeId: id })],
	[
		"setCostRate",
		() => costRates.setCostRate({ employeeId: id, effectiveFrom: "2026-10-01", rate: "40" }),
	],
	["endCostRate", () => costRates.endCostRate({ employeeId: id, effectiveFrom: "2026-10-01" })],
	["getAccountingSettings", () => accounting.getAccountingSettings()],
	[
		"connectAccountingTool",
		() =>
			accounting.connectAccountingTool({
				providerKind: "sevdesk",
				apiKey: "key",
				defaultTaxTreatment: taxTreatment,
			}),
	],
	[
		"listAccountingContactPersons",
		() => accounting.listAccountingContactPersons({ providerKind: "sevdesk", apiKey: "key" }),
	],
	[
		"updateAccountingDefaults",
		() =>
			accounting.updateAccountingDefaults({ connectionId: id, defaultTaxTreatment: taxTreatment }),
	],
	["removeAccountingTool", () => accounting.removeAccountingTool({ connectionId: id })],
	["searchContacts", () => accounting.searchContacts({ query: "Acme" })],
	["getCustomerAccounting", () => accounting.getCustomerAccounting({ customerId: id })],
	[
		"linkCustomerContact",
		() => accounting.linkCustomerContact({ customerId: id, contactId: "c-1" }),
	],
	["unlinkCustomerContact", () => accounting.unlinkCustomerContact({ customerId: id })],
	["startCustomerImport", () => accounting.startCustomerImport()],
	[
		"setCustomerTaxTreatment",
		() => accounting.setCustomerTaxTreatment({ customerId: id, taxTreatment: null }),
	],
	["getHandOffOverview", () => handOff.getHandOffOverview()],
	["previewHandOffAction", () => handOff.previewHandOffAction(handOffRequest)],
	[
		"confirmHandOffAction",
		() =>
			handOff.confirmHandOffAction({
				...handOffRequest,
				idempotencyKey: "key-1",
				fingerprint: "f",
			}),
	],
	["retryHandOffAction", () => handOff.retryHandOffAction({ draftId: id })],
	["getInvoiceDraftAction", () => handOff.getInvoiceDraftAction({ draftId: id })],
	["checkInvoiceDraftStatusAction", () => handOff.checkInvoiceDraftStatusAction({ draftId: id })],
	["releaseInvoiceDraftAction", () => handOff.releaseInvoiceDraftAction({ draftId: id })],
	[
		"downloadDraftReconciliationCsvAction",
		() => handOff.downloadDraftReconciliationCsvAction({ draftId: id }),
	],
	["downloadChangedWorkCsvAction", () => handOff.downloadChangedWorkCsvAction()],
	[
		"resolveChangedAfterInvoicingAction",
		() =>
			handOff.resolveChangedAfterInvoicingAction({
				items: [],
				explanation: "Credited",
			}),
	],
] as const;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("billable time settings actions", () => {
	it.each(orgAdminActions)("%s refuses a scoped manager before any query", async (_name, call) => {
		mocks.caller = scopedManager;

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.query).not.toHaveBeenCalled();
	});

	it("keeps switching Billable Time on or off owner-only", async () => {
		mocks.caller = orgAdmin;

		await expect(
			core.switchBillableTime({ enabled: true, currency: "EUR" }),
		).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.setBillableTimeEnabled).not.toHaveBeenCalled();
	});

	it("switches Billable Time of the session's organization for its owner", async () => {
		mocks.caller = owner;
		const settings = { enabled: true, currency: "EUR" };
		mocks.setBillableTimeEnabled.mockResolvedValue({ ok: true, settings });

		await expect(core.switchBillableTime({ enabled: true, currency: "EUR" })).resolves.toEqual({
			success: true,
			data: settings,
		});
		expect(mocks.setBillableTimeEnabled).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			enabled: true,
			currency: "EUR",
			actorUserId: "user-1",
		});
	});

	it("refuses a rate change without a target before writing", async () => {
		mocks.caller = orgAdmin;

		await expect(
			rates.setBillableRate({ target: "nonsense", effectiveFrom: "2026-10-01", rate: "90" }),
		).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Choose what the rate is for",
		});
		expect(mocks.changeBillableRate).not.toHaveBeenCalled();
	});

	it("refuses a cost rate for something that is not an employee before writing", async () => {
		mocks.caller = orgAdmin;

		await expect(
			costRates.setCostRate({ employeeId: "nope", effectiveFrom: "2026-10-01", rate: "40" }),
		).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Choose an employee",
		});
		expect(mocks.changeCostRate).not.toHaveBeenCalled();
	});
});
