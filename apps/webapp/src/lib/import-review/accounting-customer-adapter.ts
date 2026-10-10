import { mapConcurrently } from "@/lib/async/map-concurrently";
import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { accountingContactLink, customer } from "@/db/schema";
import {
	type AccountingDependencies,
	type AccountingReader,
	defaultAccountingDependencies,
	type OpenAccountingProviderRefusal,
	openAccountingProvider,
} from "@/lib/billable-time/accounting/connection-store";
import {
	type AccountingContact,
	type CustomerContactPage,
	isAccountingProviderError,
} from "@/lib/billable-time/accounting/provider";
import { systemClock } from "@/lib/datetime/temporal-core";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { planCustomerImportRows } from "./customer-import-plan";
import {
	createImportBatch,
	createImportBatchJob,
	insertStagedRows,
	updateImportBatchStatus,
} from "./repository";
import type { AccountingCustomerScanJobData } from "./types";

/**
 * The scan of a customer import (#906): reads every customer contact of the
 * organization's accounting connection through the provider port's paged
 * `listCustomerContacts`, and stages one customer row per contact that is not
 * linked yet (see `customer-import-plan.ts`). Read-only towards the tool: Z8
 * never writes back. Re-running a scan of the same batch stages nothing twice.
 */

/** Far above any tool's paging (Lexware caps listings at 10,000 contacts = 40 pages). */
const MAX_CONTACT_PAGES = 1_000;
const INSERT_CHUNK = 500;

function scanFailure(message: string) {
	return new Error(message);
}

async function listEveryContact(
	listCustomerContacts: (page: { cursor: string | null }) => Promise<CustomerContactPage>,
): Promise<AccountingContact[]> {
	const contacts: AccountingContact[] = [];
	const cursors = new Set<string>();
	let cursor: string | null = null;
	for (let page = 0; page < MAX_CONTACT_PAGES; page++) {
		let result: CustomerContactPage;
		try {
			result = await listCustomerContacts({ cursor });
		} catch (error) {
			if (!isAccountingProviderError(error)) throw error;
			throw scanFailure(
				error.failure === "unauthorized"
					? "The accounting tool refused the stored API key. Replace the connection"
					: `The accounting tool could not list its customers: ${error.message}`,
			);
		}
		contacts.push(...result.contacts);
		if (result.nextCursor === null) return contacts;
		if (cursors.has(result.nextCursor)) {
			throw scanFailure("The accounting tool returned the same page of customers twice");
		}
		cursors.add(result.nextCursor);
		cursor = result.nextCursor;
	}
	throw scanFailure("The accounting tool returned too many pages of customers");
}

export type StartCustomerImportOutcome =
	| { ok: true; batchId: string }
	| {
			ok: false;
			reason:
				| OpenAccountingProviderRefusal
				/** The connected tool's connector cannot list contacts (yet). */
				| "import_not_supported";
	  };

export type CreateCustomerImportOutcome =
	| { ok: true; batchId: string; scanJob: AccountingCustomerScanJobData }
	| Extract<StartCustomerImportOutcome, { ok: false }>;

type CustomerImportReader = AccountingReader;

/** Today in the organization's time zone (UTC when it has none). */
async function organizationToday(
	reader: CustomerImportReader,
	organizationId: string,
): Promise<string> {
	const [row] = await reader
		.select({ timezone: organization.timezone })
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);
	const zone = resolveEffectiveTimezone(undefined, row?.timezone);
	return systemClock.nowInstant().toZonedDateTimeISO(zone).toPlainDate().toString();
}

/**
 * Creates a customer import from the organization's active accounting
 * connection: a review batch in `scanning` with one scan job. The caller has
 * authorized an org admin and checked that Billable Time is on, then queues
 * `scanJob` (`enqueueImportScanJob`), and marks the batch failed with
 * `failAccountingCustomerImportStart` when queueing fails.
 */
export async function createAccountingCustomerImport(
	reader: CustomerImportReader,
	dependencies: AccountingDependencies,
	input: { organizationId: string; actorUserId: string },
): Promise<CreateCustomerImportOutcome> {
	const opened = await openAccountingProvider(reader, dependencies, input.organizationId);
	if (!opened.ok) return { ok: false, reason: opened.reason };
	if (!opened.provider.listCustomerContacts) return { ok: false, reason: "import_not_supported" };
	const { connection } = opened;
	const today = await organizationToday(reader, input.organizationId);

	const batch = await createImportBatch({
		organizationId: input.organizationId,
		provider: "accounting",
		selectedScope: {
			entityTypes: ["customer"],
			connectionId: connection.id,
			providerKind: connection.providerKind,
			accountRef: connection.accountRef,
		},
		// A customer import has no period: the batch records the day it was started.
		dateRange: { startDate: today, endDate: today },
		startedBy: input.actorUserId,
	});
	try {
		const job = await createImportBatchJob({
			batchId: batch.id,
			organizationId: input.organizationId,
			kind: "scan",
			entityType: "customer",
			partitionKey: "customer:all",
		});
		if (!job) throw new Error("Failed to create the customer import scan job");
		await updateImportBatchStatus({
			batchId: batch.id,
			organizationId: input.organizationId,
			status: "scanning",
		});
		return {
			ok: true,
			batchId: batch.id,
			scanJob: {
				type: "import-review-scan",
				batchId: batch.id,
				jobId: job.id,
				organizationId: input.organizationId,
				provider: "accounting",
				entityType: "customer",
				connectionId: connection.id,
			},
		};
	} catch (error) {
		await failAccountingCustomerImportStart({
			batchId: batch.id,
			organizationId: input.organizationId,
		});
		throw error;
	}
}

/** Marks a customer import whose scan could not be queued as failed. */
export async function failAccountingCustomerImportStart(input: {
	batchId: string;
	organizationId: string;
}): Promise<void> {
	await updateImportBatchStatus({
		batchId: input.batchId,
		organizationId: input.organizationId,
		status: "scan_failed",
		errorMessage: "The customer import could not be started",
	});
}

export async function scanAccountingCustomerImport(
	job: AccountingCustomerScanJobData,
	dependencies: AccountingDependencies = defaultAccountingDependencies(),
): Promise<{ stagedRows: number; issues: number }> {
	const opened = await openAccountingProvider(db, dependencies, job.organizationId);
	if (!opened.ok) {
		throw scanFailure(
			opened.reason === "not_connected"
				? "The organization has no accounting connection"
				: opened.reason === "provider_unavailable"
					? "The connected accounting tool is not available in this installation"
					: "The API key of the accounting connection is missing. Replace the connection",
		);
	}
	if (opened.connection.id !== job.connectionId) {
		throw scanFailure("The accounting connection changed. Start the customer import again");
	}
	const listCustomerContacts = opened.provider.listCustomerContacts?.bind(opened.provider);
	if (!listCustomerContacts) {
		throw scanFailure("This accounting tool cannot list its customers for an import");
	}

	const [contacts, customers, links] = await Promise.all([
		listEveryContact(listCustomerContacts),
		db
			.select({ id: customer.id, name: customer.name })
			.from(customer)
			.where(eq(customer.organizationId, job.organizationId)),
		db
			.select({
				customerId: accountingContactLink.customerId,
				providerKind: accountingContactLink.providerKind,
				accountRef: accountingContactLink.accountRef,
				contactId: accountingContactLink.contactId,
				contactNumber: accountingContactLink.contactNumber,
			})
			.from(accountingContactLink)
			.where(eq(accountingContactLink.organizationId, job.organizationId)),
	]);
	const rows = planCustomerImportRows({
		account: {
			connectionId: opened.connection.id,
			providerKind: opened.connection.providerKind,
			accountRef: opened.connection.accountRef,
		},
		contacts,
		customers,
		links,
	});

	const chunks = Array.from({ length: Math.ceil(rows.length / INSERT_CHUNK) }, (_, chunk) =>
		rows.slice(chunk * INSERT_CHUNK, (chunk + 1) * INSERT_CHUNK),
	);
	const inserted = await mapConcurrently(chunks, 2, (chunk) =>
		insertStagedRows({
			batchId: job.batchId,
			organizationId: job.organizationId,
			rows: chunk,
		}),
	);
	const stagedRows = inserted.reduce((count, chunk) => count + chunk.length, 0);
	return { stagedRows, issues: 0 };
}
