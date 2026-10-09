import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { createFakeAccountingTool, fakeAccountingProviderRegistry } from "./fake-provider";
import { buildInvoiceDraft, type InvoiceDraft, workLine } from "./invoice-draft";
import { AccountingProviderError } from "./provider";

const contacts = [
	{
		id: "c-1",
		customerNumber: "10001",
		name: "Acme GmbH",
		address: "Hauptstr. 1\n10115 Berlin",
		vatId: "DE123456789",
	},
	{ id: "c-2", customerNumber: "10002", name: "Beta AG", address: null, vatId: null },
	{ id: "c-3", customerNumber: null, name: "Acme Schweiz AG", address: null, vatId: null },
];

function draft(contactId = "c-1"): InvoiceDraft {
	const result = buildInvoiceDraft({
		contactId,
		currency: "EUR",
		taxTreatment: { kind: "domestic_standard", rateBasisPoints: 1900 },
		servicePeriod: {
			from: Temporal.PlainDate.from("2026-09-01"),
			to: Temporal.PlainDate.from("2026-09-30"),
		},
		title: "Invoice",
		introduction: null,
		remark: null,
		lines: [
			workLine({
				projectId: "p-1",
				projectName: "Website",
				text: "Website",
				durationMs: 3_600_000,
				unitPrice: BigInt(10000),
			}),
		],
	});
	if (!result.ok) throw new Error(result.problem);
	return result.draft;
}

const context = { organizationId: "org-1", billableCurrency: "EUR" } as const;

describe("fake accounting provider", () => {
	it("searches contacts by name or customer number, case-insensitively", async () => {
		const tool = createFakeAccountingTool({ contacts });
		const provider = tool.connector.open({ apiKey: "key", settings: {} });

		await expect(provider.searchContacts("acme")).resolves.toEqual({
			contacts: [contacts[0], contacts[2]],
			truncated: false,
		});
		await expect(provider.searchContacts("10002")).resolves.toEqual({
			contacts: [contacts[1]],
			truncated: false,
		});
		await expect(provider.getContact("c-2")).resolves.toEqual(contacts[1]);
		await expect(provider.getContact("missing")).resolves.toBeNull();
	});

	it("refuses a query shorter than the declared minimum", async () => {
		const provider = createFakeAccountingTool({ contacts }).connector.open({
			apiKey: "key",
			settings: {},
		});
		await expect(provider.searchContacts("ac")).rejects.toMatchObject({ failure: "rejected" });
	});

	it("creates one draft per idempotency key", async () => {
		const tool = createFakeAccountingTool({ contacts });
		const provider = tool.connector.open({ apiKey: "key", settings: {} });

		const first = await provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" });
		const again = await provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" });
		const other = await provider.createInvoiceDraft(draft(), { idempotencyKey: "k-2" });

		expect(again).toEqual(first);
		expect(other.externalId).not.toBe(first.externalId);
		expect(tool.drafts().map((entry) => entry.idempotencyKey)).toEqual(["k-1", "k-2"]);
		expect(tool.createCalls()).toBe(3);
	});

	it("simulates a timeout after the tool created the draft; a retry with the same key finds it", async () => {
		const tool = createFakeAccountingTool({ contacts });
		const provider = tool.connector.open({ apiKey: "key", settings: {} });
		tool.simulateTimeout();

		const failure = await provider
			.createInvoiceDraft(draft(), { idempotencyKey: "k-1" })
			.catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(AccountingProviderError);
		expect(failure).toMatchObject({ failure: "outcome_unknown" });
		expect(tool.drafts()).toHaveLength(1);

		const retried = await provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" });
		expect(retried.externalId).toBe(tool.drafts()[0].externalId);
		expect(tool.drafts()).toHaveLength(1);
	});

	it("can fail a call without performing it", async () => {
		const tool = createFakeAccountingTool({ contacts });
		const provider = tool.connector.open({ apiKey: "key", settings: {} });
		tool.failNext("createInvoiceDraft", "not_performed");

		await expect(
			provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" }),
		).rejects.toMatchObject({ failure: "not_performed" });
		expect(tool.drafts()).toHaveLength(0);
	});

	it("rejects a draft for an unknown contact or beyond its capabilities", async () => {
		const tool = createFakeAccountingTool({
			contacts,
			capabilities: { supportedCurrencies: ["CHF"] },
		});
		const provider = tool.connector.open({ apiKey: "key", settings: {} });

		await expect(
			provider.createInvoiceDraft(draft("missing"), { idempotencyKey: "k-1" }),
		).rejects.toMatchObject({ failure: "rejected" });
		await expect(
			provider.createInvoiceDraft(draft(), { idempotencyKey: "k-2" }),
		).rejects.toMatchObject({ failure: "rejected" });
		expect(tool.drafts()).toHaveLength(0);
	});

	it("reports a draft's status, gone after deletion, unsupported without a status check", async () => {
		const tool = createFakeAccountingTool({ contacts });
		const provider = tool.connector.open({ apiKey: "key", settings: {} });
		const { externalId } = await provider.createInvoiceDraft(draft(), { idempotencyKey: "k-1" });

		await expect(provider.getInvoiceDraftStatus(externalId)).resolves.toEqual({
			kind: "status",
			status: "draft",
			toolStatus: "draft",
		});
		tool.setDraftStatus(externalId, "finalized");
		await expect(provider.getInvoiceDraftStatus(externalId)).resolves.toMatchObject({
			kind: "status",
			status: "finalized",
		});
		tool.deleteDraft(externalId);
		await expect(provider.getInvoiceDraftStatus(externalId)).resolves.toEqual({ kind: "gone" });

		const blind = createFakeAccountingTool({ capabilities: { draftStatusCheck: false } });
		await expect(
			blind.connector.open({ apiKey: "key", settings: {} }).getInvoiceDraftStatus("any"),
		).resolves.toEqual({ kind: "unsupported" });
	});

	it("validates a connection: refuses a wrong key and an unsupported billable currency", async () => {
		const tool = createFakeAccountingTool({
			apiKey: "right",
			accountRef: "acct-1",
			capabilities: { supportedCurrencies: ["EUR"] },
		});

		await expect(
			tool.connector.validateConnection({ apiKey: "right", settings: {}, context }),
		).resolves.toEqual({ ok: true, accountRef: "acct-1", accountLabel: "Fake tool", settings: {} });
		await expect(
			tool.connector.validateConnection({ apiKey: "wrong", settings: {}, context }),
		).rejects.toMatchObject({ failure: "unauthorized" });
		await expect(
			tool.connector.validateConnection({
				apiKey: "right",
				settings: {},
				context: { ...context, billableCurrency: "CHF" },
			}),
		).resolves.toMatchObject({ ok: false, code: "currency_not_supported" });
	});

	it("never puts the API key into its errors", async () => {
		const tool = createFakeAccountingTool({ apiKey: "secret-key-123" });
		const error = await tool.connector
			.validateConnection({ apiKey: "secret-key-456", settings: {}, context })
			.catch((caught: unknown) => caught);
		expect(JSON.stringify(error)).not.toContain("secret-key");
		expect(String(error)).not.toContain("secret-key");
	});

	it("registers the fake under a provider kind", () => {
		const tool = createFakeAccountingTool({ kind: "sevdesk" });
		const registry = fakeAccountingProviderRegistry(tool);
		expect(registry.get("sevdesk")).toBe(tool.connector);
		expect(registry.get("lexware_office")).toBeNull();
		expect(registry.availableKinds()).toEqual(["sevdesk"]);
	});
});
