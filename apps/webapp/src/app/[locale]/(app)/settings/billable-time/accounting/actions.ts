"use server";

import { Effect } from "effect";
import {
	type AccountingDependencies,
	type ActiveAccountingConnection,
	type ConnectAccountingRefusal,
	commitAccountingConnection,
	defaultAccountingDependencies,
	finishAccountingConnection,
	getActiveAccountingConnectionSummary,
	hasAccountingApiKey,
	prepareAccountingConnection,
	removeAccountingConnection,
	updateAccountingConnectionDefaults,
} from "@/lib/billable-time/accounting/connection-store";
import { listAccountingContactPersons as listToolContactPersons } from "@/lib/billable-time/accounting/contact-persons";
import {
	type ContactLink,
	type CustomerAccounting,
	isCustomerId,
	linkCustomerToContact,
	listCustomerAccounting,
	unlinkCustomerContact as removeCustomerContactLink,
	searchAccountingContacts,
	setCustomerTaxTreatment as storeCustomerTaxTreatment,
} from "@/lib/billable-time/accounting/customer-accounting";
import {
	ACCOUNTING_PROVIDER_KINDS,
	type AccountingContact,
	type AccountingContactPerson,
} from "@/lib/billable-time/accounting/provider";
import {
	type AccountingConnectionView,
	type AccountingProviderOption,
	type ContactLinkView,
	type CustomerAccountingView,
	type TaxTreatmentView,
	taxTreatmentView,
} from "@/lib/billable-time/accounting/views";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import {
	ConflictError,
	ExternalServiceError,
	NotFoundError,
	QueueError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	createAccountingCustomerImport,
	failAccountingCustomerImportStart,
} from "@/lib/import-review/accounting-customer-adapter";
import { enqueueImportScanJob } from "@/lib/import-review/queue";
import { activeOrganizationActor } from "../action-actor";

/**
 * Accounting connection, contact links and tax treatment (#903 pass A). Every
 * action acts on the session's active organization, for owners and admins
 * only, with the module on. The API key is accepted by `connectAccountingTool`
 * and never returned, logged or audited.
 */

const ADMIN_ONLY = "Only owners and admins can manage the accounting connection";

export interface AccountingSettings {
	currency: BillableCurrency;
	connection: AccountingConnectionView | null;
	providers: AccountingProviderOption[];
	customers: CustomerAccountingView[];
}

const actor = (action: string) =>
	activeOrganizationActor({ requiredRole: "admin", message: ADMIN_ONLY, action });

const billableTimeOff = () =>
	new ValidationError({ message: "Billable Time is switched off", field: "billableTimeEnabled" });

/** A failure of the accounting tool or the secret store outside a mapped refusal. */
const accountingServiceError = (operation: string, cause: unknown) =>
	new ExternalServiceError({
		message: "The accounting tool or the secret store failed. Try again later",
		service: "accounting",
		operation,
		cause,
	});

const notConnected = () =>
	new ValidationError({
		message: "Connect an accounting tool first",
		field: "accountingConnection",
	});

const customerNotFound = () =>
	new NotFoundError({ message: "The customer was not found", entityType: "customer" });

const invalidTaxTreatment = () =>
	new ValidationError({
		message:
			"Choose a tax treatment. Domestic rates need a rate above 0 and at most 100 %, with at most two decimals",
		field: "taxTreatment",
	});

function requireModuleOn(organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const settings = yield* dbService.query("billableTime.accounting.settings", () =>
			getBillableTimeSettings(organizationId, dbService.db),
		);
		if (!settings.enabled || settings.currency === null) {
			return yield* Effect.fail(billableTimeOff());
		}
		return { currency: settings.currency };
	});
}

const customerIdOf = (input: unknown) =>
	isCustomerId(input)
		? Effect.succeed(input)
		: Effect.fail(new ValidationError({ message: "Choose a customer", field: "customerId" }));

function providerOptions(dependencies: AccountingDependencies): AccountingProviderOption[] {
	return ACCOUNTING_PROVIDER_KINDS.map((kind) => {
		const connector = dependencies.registry.get(kind);
		return { kind, available: connector !== null, capabilities: connector?.capabilities ?? null };
	});
}

function linkView(link: ContactLink | null): ContactLinkView | null {
	return (
		link && {
			contactId: link.contactId,
			contactName: link.contactName,
			contactNumber: link.contactNumber,
		}
	);
}

function customerView(entry: CustomerAccounting): CustomerAccountingView {
	return {
		customerId: entry.customerId,
		name: entry.name,
		isActive: entry.isActive,
		contactLink: linkView(entry.contactLink),
		taxOverride: entry.taxOverride && taxTreatmentView(entry.taxOverride),
	};
}

function connectionView(
	dependencies: AccountingDependencies,
	connection: ActiveAccountingConnection & { connectedByName: string | null },
	apiKeyStored: boolean,
): AccountingConnectionView {
	const connector = dependencies.registry.get(connection.providerKind);
	return {
		id: connection.id,
		providerKind: connection.providerKind,
		accountLabel: connection.accountLabel,
		defaultTaxTreatment: taxTreatmentView(connection.defaultTaxTreatment),
		connectedAt: connection.connectedAt.toISOString(),
		connectedByName: connection.connectedByName,
		apiKeyStored,
		providerAvailable: connector !== null,
		capabilities: connector?.capabilities ?? null,
	};
}

function readConnectionView(organizationId: string, dependencies: AccountingDependencies) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService.query("billableTime.accounting.connection", async () => {
			const connection = await getActiveAccountingConnectionSummary(dbService.db, organizationId);
			if (!connection) return null;
			const stored = await hasAccountingApiKey(dependencies, organizationId, connection.id);
			return connectionView(dependencies, connection, stored);
		});
	});
}

/** The accounting settings of the active organization: connection, tools and customers. */
export async function getAccountingSettings(): Promise<ServerActionResult<AccountingSettings>> {
	const effect = Effect.gen(function* () {
		const { organizationId } = yield* actor("readAccountingSettings");
		const { currency } = yield* requireModuleOn(organizationId);
		const dependencies = defaultAccountingDependencies();
		const connection = yield* readConnectionView(organizationId, dependencies);
		const dbService = yield* DatabaseService;
		const customers = yield* dbService.query("billableTime.accounting.customers", () =>
			listCustomerAccounting(dbService.db, organizationId),
		);
		return {
			currency,
			connection,
			providers: providerOptions(dependencies),
			customers: customers.map(customerView),
		};
	});
	return runServerActionSafe(effect);
}

function connectRefusalError(refusal: ConnectAccountingRefusal) {
	switch (refusal.reason) {
		case "billable_time_off":
			return billableTimeOff();
		case "invalid_provider":
			return new ValidationError({ message: "Choose an accounting tool", field: "providerKind" });
		case "provider_unavailable":
			return new ValidationError({
				message: "This accounting tool can't be connected yet",
				field: "providerKind",
			});
		case "invalid_api_key":
			return new ValidationError({ message: "Enter the API key", field: "apiKey" });
		case "invalid_tax_treatment":
			return invalidTaxTreatment();
		case "credentials_refused":
			return new ValidationError({
				message: "The accounting tool refused this API key",
				field: "apiKey",
			});
		case "tool_unreachable":
			return new ValidationError({
				message: `The accounting tool could not be reached: ${refusal.message}`,
				field: "apiKey",
			});
		case "connection_refused":
			return new ValidationError({ message: refusal.message, field: "providerKind" });
		case "concurrent_change":
			return new ConflictError({
				message: "The accounting connection was changed at the same time. Reload and try again",
				conflictType: "accounting_connection",
			});
	}
}

/**
 * Connects the active organization to an accounting tool, or replaces its
 * connection. The API key goes into the organization secret store only.
 */
export async function connectAccountingTool(input: {
	providerKind: string;
	apiKey: string;
	defaultTaxTreatment: TaxTreatmentView;
	settings?: Record<string, unknown>;
}): Promise<ServerActionResult<AccountingConnectionView>> {
	const effect = Effect.gen(function* () {
		const { organizationId, userId } = yield* actor("connectAccounting");
		const { currency } = yield* requireModuleOn(organizationId);
		const dependencies = defaultAccountingDependencies();
		// The tool and the secret store first, outside the database work.
		const preparation = yield* Effect.tryPromise({
			try: () =>
				prepareAccountingConnection(dependencies, {
					organizationId,
					actorUserId: userId,
					billableCurrency: currency,
					providerKind: input.providerKind,
					apiKey: input.apiKey,
					settings: input.settings ?? {},
					defaultTaxTreatment: input.defaultTaxTreatment,
				}),
			catch: (cause) =>
				accountingServiceError("billableTime.accounting.prepareConnection", cause),
		});
		if (!preparation.ok) return yield* Effect.fail(connectRefusalError(preparation));
		const { prepared } = preparation;
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService
			.query("billableTime.accounting.connect", () =>
				commitAccountingConnection(dbService.db, prepared),
			)
			.pipe(
				Effect.tapError(() =>
					Effect.promise(() => finishAccountingConnection(dependencies, prepared, null)),
				),
			);
		yield* Effect.promise(() => finishAccountingConnection(dependencies, prepared, outcome));
		if (!outcome.ok) return yield* Effect.fail(connectRefusalError(outcome));
		const view = yield* readConnectionView(organizationId, dependencies);
		if (!view) return yield* Effect.fail(notConnected());
		return view;
	});
	return runServerActionSafe(effect);
}

/**
 * The users of the tool account behind an API key that is about to be
 * connected, for the contact person choice (sevdesk). The key is not stored.
 */
export async function listAccountingContactPersons(input: {
	providerKind: string;
	apiKey: string;
}): Promise<ServerActionResult<AccountingContactPerson[]>> {
	const effect = Effect.gen(function* () {
		const { organizationId } = yield* actor("listAccountingContactPersons");
		yield* requireModuleOn(organizationId);
		const outcome = yield* Effect.tryPromise({
			try: () => listToolContactPersons(defaultAccountingDependencies(), input),
			catch: (cause) => accountingServiceError("billableTime.accounting.contactPersons", cause),
		});
		if (outcome.ok) return outcome.persons;
		return yield* Effect.fail(connectRefusalError(outcome));
	});
	return runServerActionSafe(effect);
}

/** Changes the active connection's default tax treatment. */
export async function updateAccountingDefaults(input: {
	connectionId: string;
	defaultTaxTreatment: TaxTreatmentView;
}): Promise<ServerActionResult<AccountingConnectionView>> {
	const effect = Effect.gen(function* () {
		const { organizationId, userId } = yield* actor("updateAccountingDefaults");
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.accounting.updateDefaults", () =>
			updateAccountingConnectionDefaults(dbService.db, {
				organizationId,
				actorUserId: userId,
				connectionId: String(input.connectionId),
				defaultTaxTreatment: input.defaultTaxTreatment,
			}),
		);
		if (!outcome.ok) {
			return yield* Effect.fail(
				outcome.reason === "billable_time_off"
					? billableTimeOff()
					: outcome.reason === "not_connected"
						? notConnected()
						: invalidTaxTreatment(),
			);
		}
		const view = yield* readConnectionView(organizationId, defaultAccountingDependencies());
		if (!view) return yield* Effect.fail(notConnected());
		return view;
	});
	return runServerActionSafe(effect);
}

/** Removes the active connection and deletes its API key from the secret store. */
export async function removeAccountingTool(input: {
	connectionId: string;
}): Promise<ServerActionResult<{ removed: true }>> {
	const effect = Effect.gen(function* () {
		const { organizationId, userId } = yield* actor("removeAccountingConnection");
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.accounting.remove", () =>
			removeAccountingConnection(dbService.db, defaultAccountingDependencies(), {
				organizationId,
				actorUserId: userId,
				connectionId: String(input.connectionId),
			}),
		);
		if (!outcome.ok) return yield* Effect.fail(notConnected());
		return { removed: true as const };
	});
	return runServerActionSafe(effect);
}

export interface ContactSearchView {
	contacts: AccountingContact[];
	truncated: boolean;
}

/** Searches the connected tool's contacts for the contact picker. */
export async function searchContacts(input: {
	query: string;
}): Promise<ServerActionResult<ContactSearchView>> {
	const effect = Effect.gen(function* () {
		const { organizationId } = yield* actor("searchAccountingContacts");
		yield* requireModuleOn(organizationId);
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.accounting.searchContacts", () =>
			searchAccountingContacts(dbService.db, defaultAccountingDependencies(), {
				organizationId,
				query: input.query,
			}),
		);
		if (outcome.ok) return { contacts: outcome.contacts, truncated: outcome.truncated };
		return yield* Effect.fail(providerRefusalError(outcome));
	});
	return runServerActionSafe(effect);
}

function providerRefusalError(
	refusal:
		| { reason: "not_connected" | "provider_unavailable" | "credentials_missing" }
		| { reason: "credentials_refused" }
		| { reason: "tool_unreachable"; message: string }
		| { reason: "query_too_short"; minLength: number }
		| { reason: "billable_time_off" },
) {
	switch (refusal.reason) {
		case "billable_time_off":
			return billableTimeOff();
		case "not_connected":
			return notConnected();
		case "provider_unavailable":
			return new ValidationError({
				message: "The connected accounting tool is not available in this installation",
				field: "accountingConnection",
			});
		case "credentials_missing":
			return new ValidationError({
				message: "The API key of the accounting connection is missing. Replace the connection",
				field: "accountingConnection",
			});
		case "credentials_refused":
			return new ValidationError({
				message: "The accounting tool refused the stored API key. Replace the connection",
				field: "accountingConnection",
			});
		case "tool_unreachable":
			return new ValidationError({
				message: `The accounting tool could not be reached: ${refusal.message}`,
				field: "accountingConnection",
			});
		case "query_too_short":
			return new ValidationError({
				message: `Enter at least ${refusal.minLength} characters`,
				field: "query",
			});
	}
}

/** One customer's contact link and tax treatment, with the connection default. */
export interface CustomerAccountingDetail {
	customer: CustomerAccountingView;
	connection: Pick<
		AccountingConnectionView,
		"id" | "providerKind" | "accountLabel" | "defaultTaxTreatment" | "capabilities"
	> | null;
}

function readCustomerDetail(organizationId: string, customerId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const [entry] = yield* dbService.query("billableTime.accounting.customer", () =>
			listCustomerAccounting(dbService.db, organizationId, { customerIds: [customerId] }),
		);
		if (!entry) return yield* Effect.fail(customerNotFound());
		const dependencies = defaultAccountingDependencies();
		const connection = yield* readConnectionView(organizationId, dependencies);
		return {
			customer: customerView(entry),
			connection: connection && {
				id: connection.id,
				providerKind: connection.providerKind,
				accountLabel: connection.accountLabel,
				defaultTaxTreatment: connection.defaultTaxTreatment,
				capabilities: connection.capabilities,
			},
		};
	});
}

/** A customer's accounting side, for the customer entry points. */
export async function getCustomerAccounting(input: {
	customerId: string;
}): Promise<ServerActionResult<CustomerAccountingDetail>> {
	const effect = Effect.gen(function* () {
		const { organizationId } = yield* actor("readCustomerAccounting");
		yield* requireModuleOn(organizationId);
		const customerId = yield* customerIdOf(input.customerId);
		return yield* readCustomerDetail(organizationId, customerId);
	});
	return runServerActionSafe(effect);
}

/** Links a customer to an existing contact in the connected tool. */
export async function linkCustomerContact(input: {
	customerId: string;
	contactId: string;
}): Promise<ServerActionResult<CustomerAccountingDetail>> {
	const effect = Effect.gen(function* () {
		const { organizationId, userId } = yield* actor("linkCustomerContact");
		const customerId = yield* customerIdOf(input.customerId);
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.accounting.linkContact", () =>
			linkCustomerToContact(dbService.db, defaultAccountingDependencies(), {
				organizationId,
				actorUserId: userId,
				customerId,
				contactId: input.contactId,
			}),
		);
		if (!outcome.ok) {
			switch (outcome.reason) {
				case "customer_not_found":
					return yield* Effect.fail(customerNotFound());
				case "contact_not_found":
					return yield* Effect.fail(
						new NotFoundError({
							message: "The contact was not found in the accounting tool",
							entityType: "accounting_contact",
						}),
					);
				case "connection_changed":
					return yield* Effect.fail(
						new ConflictError({
							message: "The accounting connection changed. Reload and try again",
							conflictType: "accounting_connection",
						}),
					);
				default:
					return yield* Effect.fail(providerRefusalError(outcome));
			}
		}
		return yield* readCustomerDetail(organizationId, customerId);
	});
	return runServerActionSafe(effect);
}

/** Removes a customer's contact link. */
export async function unlinkCustomerContact(input: {
	customerId: string;
}): Promise<ServerActionResult<CustomerAccountingDetail>> {
	const effect = Effect.gen(function* () {
		const { organizationId, userId } = yield* actor("unlinkCustomerContact");
		yield* requireModuleOn(organizationId);
		const customerId = yield* customerIdOf(input.customerId);
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.accounting.unlinkContact", () =>
			removeCustomerContactLink(dbService.db, { organizationId, actorUserId: userId, customerId }),
		);
		if (!outcome.ok) {
			return yield* Effect.fail(
				outcome.reason === "customer_not_found" ? customerNotFound() : notConnected(),
			);
		}
		return yield* readCustomerDetail(organizationId, customerId);
	});
	return runServerActionSafe(effect);
}

/**
 * Starts a customer import (#906) from the connected accounting tool: its
 * customer contacts are staged in a review batch; the admin decides per
 * contact on the import review page. Returns the batch to open.
 */
export async function startCustomerImport(): Promise<ServerActionResult<{ batchId: string }>> {
	const effect = Effect.gen(function* () {
		const { organizationId, userId } = yield* actor("startCustomerImport");
		yield* requireModuleOn(organizationId);
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.accounting.startCustomerImport", () =>
			createAccountingCustomerImport(dbService.db, defaultAccountingDependencies(), {
				organizationId,
				actorUserId: userId,
			}),
		);
		if (outcome.ok) {
			const { batchId, scanJob } = outcome;
			yield* Effect.tryPromise({
				try: () => enqueueImportScanJob(scanJob),
				catch: (cause) =>
					new QueueError({
						message: "The customer import could not be started",
						operation: "billableTime.accounting.enqueueCustomerImportScan",
						cause,
					}),
			}).pipe(
				Effect.tapError(() =>
					dbService.query("billableTime.accounting.failCustomerImportStart", () =>
						failAccountingCustomerImportStart({ batchId, organizationId }),
					),
				),
			);
			return { batchId };
		}
		const { reason } = outcome;
		if (reason === "import_not_supported") {
			return yield* Effect.fail(
				new ValidationError({
					message: "This accounting tool cannot import customers yet",
					field: "accountingConnection",
				}),
			);
		}
		return yield* Effect.fail(providerRefusalError({ reason }));
	});
	return runServerActionSafe(effect);
}

/** Sets a customer's tax treatment override, or clears it with `null`. */
export async function setCustomerTaxTreatment(input: {
	customerId: string;
	taxTreatment: TaxTreatmentView | null;
}): Promise<ServerActionResult<CustomerAccountingDetail>> {
	const effect = Effect.gen(function* () {
		const { organizationId, userId } = yield* actor("setCustomerTaxTreatment");
		const customerId = yield* customerIdOf(input.customerId);
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query("billableTime.accounting.customerTax", () =>
			storeCustomerTaxTreatment(dbService.db, {
				organizationId,
				actorUserId: userId,
				customerId,
				treatment: input.taxTreatment,
			}),
		);
		if (!outcome.ok) {
			return yield* Effect.fail(
				outcome.reason === "billable_time_off"
					? billableTimeOff()
					: outcome.reason === "customer_not_found"
						? customerNotFound()
						: invalidTaxTreatment(),
			);
		}
		return yield* readCustomerDetail(organizationId, customerId);
	});
	return runServerActionSafe(effect);
}
