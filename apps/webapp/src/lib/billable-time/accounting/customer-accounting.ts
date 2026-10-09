import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import {
	accountingConnection,
	accountingContactLink,
	auditLog,
	customer,
	customerTaxTreatment,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import { isUuid } from "../input";
import { lockBillableTimeSettings } from "../settings";
import {
	type AccountingDependencies,
	type AccountingReader,
	type ActiveAccountingConnection,
	getActiveAccountingConnection,
	type OpenAccountingProviderRefusal,
	openAccountingProvider,
} from "./connection-store";
import { type AccountingContact, AccountingProviderError } from "./provider";
import {
	type EffectiveTaxTreatment,
	effectiveTaxTreatment,
	formatTaxRate,
	parseTaxTreatment,
	type TaxTreatment,
	taxTreatmentFromStored,
} from "./tax-treatment";

/**
 * A customer's accounting side (#903): its contact link to an existing contact
 * in the accounting tool (searched through the provider port; Z8 never creates
 * contacts, ADR 0002) and its tax treatment override. Every change is audited
 * in the same transaction. Callers authorize the actor as an org admin of
 * `organizationId` first.
 */

export interface ContactLink {
	contactId: string;
	contactName: string;
	contactNumber: string | null;
	linkedAt: Instant;
}

/** Whether an untrusted value is a customer id (a uuid). */
export const isCustomerId = isUuid;

async function customerInOrganization(
	reader: AccountingReader,
	organizationId: string,
	customerId: string,
): Promise<{ id: string; name: string } | null> {
	const [row] = await reader
		.select({ id: customer.id, name: customer.name })
		.from(customer)
		.where(and(eq(customer.id, customerId), eq(customer.organizationId, organizationId)))
		.limit(1);
	return row ?? null;
}

function linkScope(organizationId: string, connection: ActiveAccountingConnection) {
	return and(
		eq(accountingContactLink.organizationId, organizationId),
		eq(accountingContactLink.providerKind, connection.providerKind),
		eq(accountingContactLink.accountRef, connection.accountRef),
	);
}

function linkFromRow(row: typeof accountingContactLink.$inferSelect): ContactLink {
	return {
		contactId: row.contactId,
		contactName: row.contactName,
		contactNumber: row.contactNumber,
		linkedAt: instantFromDate(row.linkedAt),
	};
}

/**
 * A customer's contact link for the active connection's tool account, or null
 * (no connection, or not linked for this account). A customer without one
 * cannot be handed off.
 */
export async function getCustomerContactLink(
	reader: AccountingReader,
	organizationId: string,
	customerId: string,
): Promise<ContactLink | null> {
	const connection = await getActiveAccountingConnection(reader, organizationId);
	if (!connection) return null;
	const [row] = await reader
		.select()
		.from(accountingContactLink)
		.where(
			and(linkScope(organizationId, connection), eq(accountingContactLink.customerId, customerId)),
		)
		.limit(1);
	return row ? linkFromRow(row) : null;
}

/** A customer's own tax treatment override, or null. */
export async function getCustomerTaxTreatmentOverride(
	reader: AccountingReader,
	organizationId: string,
	customerId: string,
): Promise<TaxTreatment | null> {
	const [row] = await reader
		.select()
		.from(customerTaxTreatment)
		.where(
			and(
				eq(customerTaxTreatment.organizationId, organizationId),
				eq(customerTaxTreatment.customerId, customerId),
			),
		)
		.limit(1);
	return row ? taxTreatmentFromStored(row.taxTreatment, row.taxRate) : null;
}

/**
 * The tax treatment a customer's hand-off uses: its override, else the active
 * connection's default. Null without an active connection.
 */
export async function getEffectiveCustomerTaxTreatment(
	reader: AccountingReader,
	organizationId: string,
	customerId: string,
): Promise<EffectiveTaxTreatment | null> {
	const connection = await getActiveAccountingConnection(reader, organizationId);
	if (!connection) return null;
	const override = await getCustomerTaxTreatmentOverride(reader, organizationId, customerId);
	return effectiveTaxTreatment(connection.defaultTaxTreatment, override);
}

/** One customer's accounting state, for the settings overview and the customer panel. */
export interface CustomerAccounting {
	customerId: string;
	name: string;
	isActive: boolean;
	contactLink: ContactLink | null;
	taxOverride: TaxTreatment | null;
}

/**
 * Every customer of the organization with its contact link (for the active
 * connection's account) and tax override: active customers, plus inactive ones
 * that still have a link or an override. Sorted by name.
 */
export async function listCustomerAccounting(
	reader: AccountingReader,
	organizationId: string,
	options: { customerIds?: readonly string[] } = {},
): Promise<CustomerAccounting[]> {
	const connection = await getActiveAccountingConnection(reader, organizationId);
	const customerCondition = options.customerIds
		? and(
				eq(customer.organizationId, organizationId),
				inArray(customer.id, [...options.customerIds]),
			)
		: eq(customer.organizationId, organizationId);
	if (options.customerIds?.length === 0) return [];

	const [customers, links, overrides] = await Promise.all([
		reader
			.select({ id: customer.id, name: customer.name, isActive: customer.isActive })
			.from(customer)
			.where(customerCondition)
			.orderBy(asc(customer.name)),
		connection
			? reader.select().from(accountingContactLink).where(linkScope(organizationId, connection))
			: Promise.resolve([]),
		reader
			.select()
			.from(customerTaxTreatment)
			.where(eq(customerTaxTreatment.organizationId, organizationId)),
	]);
	const linkByCustomer = new Map(links.map((row) => [row.customerId, linkFromRow(row)]));
	const overrideByCustomer = new Map(
		overrides.map((row) => [row.customerId, taxTreatmentFromStored(row.taxTreatment, row.taxRate)]),
	);
	return customers
		.map((row) => ({
			customerId: row.id,
			name: row.name,
			isActive: row.isActive,
			contactLink: linkByCustomer.get(row.id) ?? null,
			taxOverride: overrideByCustomer.get(row.id) ?? null,
		}))
		.filter((entry) => entry.isActive || entry.contactLink || entry.taxOverride);
}

type ProviderCallRefusal =
	| { reason: OpenAccountingProviderRefusal }
	/** The tool refused the stored API key: the connection must be replaced. */
	| { reason: "credentials_refused" }
	| { reason: "tool_unreachable"; message: string };

function providerCallRefusal(error: unknown): ProviderCallRefusal {
	if (error instanceof AccountingProviderError) {
		return error.failure === "unauthorized"
			? { reason: "credentials_refused" }
			: { reason: "tool_unreachable", message: error.message };
	}
	throw error;
}

export type ContactSearchOutcome =
	| { ok: true; contacts: AccountingContact[]; truncated: boolean }
	| ({ ok: false } & (
			| ProviderCallRefusal
			| { reason: "query_too_short"; minLength: number }
			| { reason: "billable_time_off" }
	  ));

/** Searches the accounting tool's contacts for the contact picker. */
export async function searchAccountingContacts(
	reader: AccountingReader,
	dependencies: AccountingDependencies,
	input: { organizationId: string; query: unknown },
): Promise<ContactSearchOutcome> {
	const opened = await openAccountingProvider(reader, dependencies, input.organizationId);
	if (!opened.ok) return { ok: false, reason: opened.reason };
	const query = typeof input.query === "string" ? input.query.trim().slice(0, 200) : "";
	const minLength = opened.provider.capabilities.contactSearchMinLength;
	if (query.length < minLength) return { ok: false, reason: "query_too_short", minLength };
	try {
		const result = await opened.provider.searchContacts(query);
		return { ok: true, contacts: result.contacts, truncated: result.truncated };
	} catch (error) {
		return { ok: false, ...providerCallRefusal(error) };
	}
}

async function writeAudit(
	tx: Transaction,
	input: {
		organizationId: string;
		actorUserId: string;
		entityType: string;
		customerId: string;
		action: AuditAction;
		changes: Record<string, unknown>;
	},
) {
	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: input.entityType,
		entityId: input.customerId,
		action: input.action,
		performedBy: input.actorUserId,
		changes: JSON.stringify(input.changes),
	});
}

const describeLink = (link: Pick<ContactLink, "contactId" | "contactName" | "contactNumber">) => ({
	contactId: link.contactId,
	name: link.contactName,
	number: link.contactNumber,
});

export type LinkContactOutcome =
	| { ok: true; changed: boolean; link: ContactLink }
	| ({ ok: false } & (
			| ProviderCallRefusal
			| { reason: "billable_time_off" }
			| { reason: "customer_not_found" }
			| { reason: "contact_not_found" }
			/** The connection was replaced or removed while linking. */
			| { reason: "connection_changed" }
	  ));

/**
 * Links a customer to an existing contact in the accounting tool, replacing its
 * link for the active connection's account. The contact is read from the tool
 * through the port (never trusted from the client). Audited when it changes.
 */
export async function linkCustomerToContact(
	database: typeof db,
	dependencies: AccountingDependencies,
	input: { organizationId: string; actorUserId: string; customerId: string; contactId: unknown },
): Promise<LinkContactOutcome> {
	const contactId = typeof input.contactId === "string" ? input.contactId.trim() : "";
	if (contactId === "" || contactId.length > 200) return { ok: false, reason: "contact_not_found" };
	if (!(await customerInOrganization(database, input.organizationId, input.customerId))) {
		return { ok: false, reason: "customer_not_found" };
	}
	const opened = await openAccountingProvider(database, dependencies, input.organizationId);
	if (!opened.ok) return { ok: false, reason: opened.reason };
	let contact: AccountingContact | null;
	try {
		contact = await opened.provider.getContact(contactId);
	} catch (error) {
		return { ok: false, ...providerCallRefusal(error) };
	}
	if (!contact) return { ok: false, reason: "contact_not_found" };
	const found = contact;
	const connection = opened.connection;

	return database.transaction(async (tx) => {
		const settings = await lockBillableTimeSettings(tx, input.organizationId, "share");
		if (!settings.enabled) return { ok: false, reason: "billable_time_off" } as const;
		const [still] = await tx
			.select({ id: accountingConnection.id })
			.from(accountingConnection)
			.where(
				and(
					eq(accountingConnection.id, connection.id),
					eq(accountingConnection.organizationId, input.organizationId),
					eq(accountingConnection.status, "active"),
				),
			)
			.limit(1)
			.for("share");
		if (!still) return { ok: false, reason: "connection_changed" } as const;

		const scope = and(
			linkScope(input.organizationId, connection),
			eq(accountingContactLink.customerId, input.customerId),
		);
		const [existing] = await tx
			.select()
			.from(accountingContactLink)
			.where(scope)
			.limit(1)
			.for("update");
		const values = {
			contactId: found.id,
			contactName: found.name,
			contactNumber: found.customerNumber,
			linkedAt: sql`now()`,
			linkedBy: input.actorUserId,
		};
		const existingRow = (id: string) =>
			and(
				eq(accountingContactLink.id, id),
				eq(accountingContactLink.organizationId, input.organizationId),
			);
		if (existing && existing.contactId === found.id) {
			const [row] = await tx
				.update(accountingContactLink)
				.set({ contactName: found.name, contactNumber: found.customerNumber })
				.where(existingRow(existing.id))
				.returning();
			return { ok: true, changed: false, link: linkFromRow(row) } as const;
		}
		const [row] = existing
			? await tx
					.update(accountingContactLink)
					.set(values)
					.where(existingRow(existing.id))
					.returning()
			: await tx
					.insert(accountingContactLink)
					.values({
						...values,
						organizationId: input.organizationId,
						customerId: input.customerId,
						providerKind: connection.providerKind,
						accountRef: connection.accountRef,
					})
					.returning();
		await writeAudit(tx, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			entityType: "accounting_contact_link",
			customerId: input.customerId,
			action: AuditAction.CONTACT_LINK_SET,
			changes: {
				customerId: input.customerId,
				providerKind: connection.providerKind,
				accountRef: connection.accountRef,
				contact: {
					from: existing ? describeLink(linkFromRow(existing)) : null,
					to: describeLink(linkFromRow(row)),
				},
			},
		});
		return { ok: true, changed: true, link: linkFromRow(row) } as const;
	});
}

export type UnlinkContactOutcome =
	| { ok: true; changed: boolean }
	| { ok: false; reason: "customer_not_found" | "not_connected" };

/** Removes a customer's contact link for the active connection's account. Audited. */
export async function unlinkCustomerContact(
	database: typeof db,
	input: { organizationId: string; actorUserId: string; customerId: string },
): Promise<UnlinkContactOutcome> {
	return database.transaction(async (tx) => {
		if (!(await customerInOrganization(tx, input.organizationId, input.customerId))) {
			return { ok: false, reason: "customer_not_found" } as const;
		}
		const [connectionRow] = await tx
			.select()
			.from(accountingConnection)
			.where(
				and(
					eq(accountingConnection.organizationId, input.organizationId),
					eq(accountingConnection.status, "active"),
				),
			)
			.limit(1)
			.for("share");
		if (!connectionRow) return { ok: false, reason: "not_connected" } as const;
		const [removed] = await tx
			.delete(accountingContactLink)
			.where(
				and(
					eq(accountingContactLink.organizationId, input.organizationId),
					eq(accountingContactLink.customerId, input.customerId),
					eq(accountingContactLink.providerKind, connectionRow.providerKind),
					eq(accountingContactLink.accountRef, connectionRow.accountRef),
				),
			)
			.returning();
		if (!removed) return { ok: true, changed: false } as const;
		await writeAudit(tx, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			entityType: "accounting_contact_link",
			customerId: input.customerId,
			action: AuditAction.CONTACT_LINK_REMOVED,
			changes: {
				customerId: input.customerId,
				providerKind: connectionRow.providerKind,
				accountRef: connectionRow.accountRef,
				contact: { from: describeLink(linkFromRow(removed)), to: null },
			},
		});
		return { ok: true, changed: true } as const;
	});
}

export type CustomerTaxTreatmentOutcome =
	| { ok: true; changed: boolean; override: TaxTreatment | null }
	| { ok: false; reason: "billable_time_off" | "customer_not_found" | "invalid_tax_treatment" };

/**
 * Sets a customer's tax treatment override, or clears it (`treatment: null`) so
 * the connection's default applies again. Audited when it changes.
 */
export async function setCustomerTaxTreatment(
	database: typeof db,
	input: {
		organizationId: string;
		actorUserId: string;
		customerId: string;
		treatment: unknown;
	},
): Promise<CustomerTaxTreatmentOutcome> {
	let next: TaxTreatment | null = null;
	if (input.treatment !== null) {
		const parsed = parseTaxTreatment(input.treatment);
		if (!parsed.ok) return { ok: false, reason: "invalid_tax_treatment" };
		next = parsed.treatment;
	}
	const wanted = next;

	return database.transaction(async (tx) => {
		const settings = await lockBillableTimeSettings(tx, input.organizationId, "share");
		if (!settings.enabled) return { ok: false, reason: "billable_time_off" } as const;
		if (!(await customerInOrganization(tx, input.organizationId, input.customerId))) {
			return { ok: false, reason: "customer_not_found" } as const;
		}
		const scope = and(
			eq(customerTaxTreatment.organizationId, input.organizationId),
			eq(customerTaxTreatment.customerId, input.customerId),
		);
		const [existingRow] = await tx
			.select()
			.from(customerTaxTreatment)
			.where(scope)
			.limit(1)
			.for("update");
		const existing = existingRow
			? taxTreatmentFromStored(existingRow.taxTreatment, existingRow.taxRate)
			: null;
		const same =
			existing === null
				? wanted === null
				: wanted !== null &&
					existing.kind === wanted.kind &&
					existing.rateBasisPoints === wanted.rateBasisPoints;
		if (same) return { ok: true, changed: false, override: existing } as const;

		if (wanted === null) {
			await tx.delete(customerTaxTreatment).where(scope);
		} else {
			const values = {
				taxTreatment: wanted.kind,
				taxRate: formatTaxRate(wanted.rateBasisPoints),
				updatedAt: sql`now()`,
				updatedBy: input.actorUserId,
			};
			await tx
				.insert(customerTaxTreatment)
				.values({ ...values, customerId: input.customerId, organizationId: input.organizationId })
				.onConflictDoUpdate({ target: customerTaxTreatment.customerId, set: values });
		}
		const describe = (treatment: TaxTreatment | null) =>
			treatment && { kind: treatment.kind, rate: formatTaxRate(treatment.rateBasisPoints) };
		await writeAudit(tx, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			entityType: "customer_tax_treatment",
			customerId: input.customerId,
			action:
				wanted === null
					? AuditAction.CUSTOMER_TAX_TREATMENT_CLEARED
					: AuditAction.CUSTOMER_TAX_TREATMENT_SET,
			changes: { customerId: input.customerId, from: describe(existing), to: describe(wanted) },
		});
		return { ok: true, changed: true, override: wanted } as const;
	});
}
