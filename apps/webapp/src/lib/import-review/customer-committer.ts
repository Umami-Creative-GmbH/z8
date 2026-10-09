import "server-only";

import { and, eq, sql } from "drizzle-orm";
import {
	accountingConnection,
	accountingContactLink,
	auditLog,
	customer,
	type importStagedRow,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { lockBillableTimeSettings } from "@/lib/billable-time/settings";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import { readStagedCustomer } from "./staged-customer";
import type { ImportCommitJobData } from "./types";

/**
 * Commits one accepted customer row of a customer import (#906), inside the
 * row's commit transaction:
 *
 * - accepted without a choice: creates a customer with the contact's name, VAT
 *   ID, email and formatted address, and links it to the contact;
 * - accepted with `{ kind: "link", targetId }`: links that existing customer.
 *
 * The row is held (never an error) when it can no longer commit as reviewed:
 * Billable Time is off, the accounting connection changed, the contact got
 * linked meanwhile, a customer with the same name (ignoring case) exists, or
 * the link target is gone or already linked to another contact. The unique
 * customer name is checked under a per-organization lock and the insert skips
 * on conflict, so the constraint never errors. Every change is audited in the
 * same transaction. Z8 never writes to the accounting tool.
 */

export const CUSTOMER_IMPORT_HOLD_REASONS = [
	"billable_time_off",
	"connection_changed",
	"contact_already_linked",
	"customer_name_taken",
	"customer_already_linked",
	"link_target_missing",
	"invalid_row",
] as const;

export type CustomerImportHoldReason = (typeof CUSTOMER_IMPORT_HOLD_REASONS)[number];

export interface CustomerImportHold extends Record<string, unknown> {
	reason: CustomerImportHoldReason;
	customerId?: string;
	customerName?: string;
}

export type CustomerCommitOutcome =
	| { kind: "committed"; customerId: string }
	| { kind: "held"; hold: CustomerImportHold };

type StagedRow = typeof importStagedRow.$inferSelect;

const held = (hold: CustomerImportHold): CustomerCommitOutcome => ({ kind: "held", hold });

export async function commitCustomerRow(
	tx: Transaction,
	row: StagedRow,
	job: ImportCommitJobData,
): Promise<CustomerCommitOutcome> {
	const organizationId = job.organizationId;
	const staged = readStagedCustomer(row);
	if (!staged.contactId || !staged.name || !staged.connectionId) {
		return held({ reason: "invalid_row" });
	}

	const settings = await lockBillableTimeSettings(tx, organizationId, "share");
	if (!settings.enabled) return held({ reason: "billable_time_off" });

	const [connection] = await tx
		.select({
			id: accountingConnection.id,
			providerKind: accountingConnection.providerKind,
			accountRef: accountingConnection.accountRef,
		})
		.from(accountingConnection)
		.where(
			and(
				eq(accountingConnection.organizationId, organizationId),
				eq(accountingConnection.status, "active"),
			),
		)
		.limit(1)
		.for("share");
	if (
		!connection ||
		connection.providerKind !== staged.providerKind ||
		connection.accountRef !== staged.accountRef
	) {
		return held({ reason: "connection_changed" });
	}

	// Serializes customer imports of the organization: name checks and links.
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`customer-import:${organizationId}`}, 0))`,
	);

	const accountLinks = and(
		eq(accountingContactLink.organizationId, organizationId),
		eq(accountingContactLink.providerKind, connection.providerKind),
		eq(accountingContactLink.accountRef, connection.accountRef),
	);
	const choice = row.commitChoice;
	const [contactLinked] = await tx
		.select({ customerId: accountingContactLink.customerId })
		.from(accountingContactLink)
		.where(and(accountLinks, eq(accountingContactLink.contactId, staged.contactId)))
		.limit(1);
	if (contactLinked) {
		if (choice?.kind === "link" && contactLinked.customerId === choice.targetId) {
			return { kind: "committed", customerId: choice.targetId };
		}
		return held({ reason: "contact_already_linked", customerId: contactLinked.customerId });
	}

	let customerId: string;
	if (choice?.kind === "link") {
		const [target] = await tx
			.select({ id: customer.id, name: customer.name })
			.from(customer)
			.where(and(eq(customer.id, choice.targetId), eq(customer.organizationId, organizationId)))
			.limit(1)
			.for("share");
		if (!target) return held({ reason: "link_target_missing" });
		const [targetLinked] = await tx
			.select({ contactId: accountingContactLink.contactId })
			.from(accountingContactLink)
			.where(and(accountLinks, eq(accountingContactLink.customerId, target.id)))
			.limit(1);
		if (targetLinked) {
			return held({
				reason: "customer_already_linked",
				customerId: target.id,
				customerName: target.name,
			});
		}
		customerId = target.id;
	} else {
		const created = await createCustomer(tx, staged, job);
		if (created.kind === "held") return created;
		customerId = created.customerId;
	}

	await tx.insert(accountingContactLink).values({
		organizationId,
		customerId,
		providerKind: connection.providerKind,
		accountRef: connection.accountRef,
		contactId: staged.contactId,
		contactName: staged.name,
		contactNumber: staged.customerNumber,
		linkedBy: job.committedBy,
	});
	await tx.insert(auditLog).values({
		organizationId,
		entityType: "accounting_contact_link",
		entityId: customerId,
		action: AuditAction.CONTACT_LINK_SET,
		performedBy: job.committedBy,
		changes: JSON.stringify({
			customerId,
			providerKind: connection.providerKind,
			accountRef: connection.accountRef,
			contact: {
				from: null,
				to: { contactId: staged.contactId, name: staged.name, number: staged.customerNumber },
			},
		}),
		metadata: JSON.stringify({ source: "customer_import", batchId: job.batchId, rowId: row.id }),
	});
	return { kind: "committed", customerId };
}

async function createCustomer(
	tx: Transaction,
	staged: ReturnType<typeof readStagedCustomer>,
	job: ImportCommitJobData,
): Promise<CustomerCommitOutcome> {
	const name = staged.name.trim();
	const [taken] = await tx
		.select({ id: customer.id, name: customer.name })
		.from(customer)
		.where(
			and(
				eq(customer.organizationId, job.organizationId),
				sql`lower(btrim(${customer.name})) = lower(${name})`,
			),
		)
		.limit(1);
	if (taken) {
		return held({ reason: "customer_name_taken", customerId: taken.id, customerName: taken.name });
	}
	const [created] = await tx
		.insert(customer)
		.values({
			organizationId: job.organizationId,
			name,
			address: staged.address,
			vatId: staged.vatId,
			email: staged.email,
			isActive: true,
			createdBy: job.committedBy,
			updatedAt: new Date(),
		})
		.onConflictDoNothing({ target: [customer.organizationId, customer.name] })
		.returning({ id: customer.id });
	if (!created) return held({ reason: "customer_name_taken" });
	await tx.insert(auditLog).values({
		organizationId: job.organizationId,
		entityType: "customer",
		entityId: created.id,
		action: AuditAction.CUSTOMER_CREATED,
		performedBy: job.committedBy,
		changes: JSON.stringify({
			name,
			vatId: staged.vatId,
			email: staged.email,
			address: staged.address,
		}),
		metadata: JSON.stringify({
			source: "customer_import",
			batchId: job.batchId,
			providerKind: staged.providerKind,
			contactId: staged.contactId,
		}),
	});
	return { kind: "committed", customerId: created.id };
}
