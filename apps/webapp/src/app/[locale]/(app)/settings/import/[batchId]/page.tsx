import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ImportReviewPage } from "@/components/settings/import/import-review-page";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { importBatch } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { listCustomerAccounting } from "@/lib/billable-time/accounting/customer-accounting";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import {
	getImportReviewSummary,
	listImportReviewRows,
} from "@/lib/import-review/repository";
import { readStagedCustomer } from "@/lib/import-review/staged-customer";
import { importRowBillability } from "@/lib/import-review/staged-work-billability";

interface ImportReviewRouteProps {
	params: Promise<{ batchId: string }>;
	searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

/** Contacts per page of a customer import's review (`?page=`, 1-based). */
const CUSTOMER_IMPORT_PAGE_SIZE = 100;

/** The requested page, within 1…pageCount; anything unreadable is the first page. */
function customerImportPage(requested: string | string[] | undefined, totalRows: number) {
	const rows = Number.isFinite(totalRows) ? totalRows : 0;
	const pageCount = Math.max(1, Math.ceil(rows / CUSTOMER_IMPORT_PAGE_SIZE));
	const value = Array.isArray(requested) ? requested[0] : requested;
	const parsed = value && /^\d{1,6}$/.test(value) ? Number(value) : 1;
	return { page: Math.min(Math.max(parsed, 1), pageCount), pageCount };
}

const IMPORT_REVIEW_SUMMARY_LOADING_KEYS = [
	"total",
	"accepted",
	"rejected",
	"blocked",
	"committed",
	"issues",
] as const;

async function ImportReviewRouteContent({ params, searchParams }: ImportReviewRouteProps) {
	const [{ batchId }, query, { organizationId }] = await Promise.all([
		params,
		searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>),
		requireOrgAdminSettingsAccess(),
	]);
	const batch = await db.query.importBatch.findFirst({
		where: and(
			eq(importBatch.id, batchId),
			eq(importBatch.organizationId, organizationId),
		),
	});

	if (!batch) notFound();
	// A customer import from the accounting connection (#906) shows its contacts
	// page by page; a work import shows its first 100 rows.
	const isCustomerImport = batch.provider === "accounting";

	const summary = await getImportReviewSummary({ batchId: batch.id, organizationId });
	const paging = isCustomerImport ? customerImportPage(query.page, summary.totalRows) : null;
	const [rows, billableTime, customerAccounting] = await Promise.all([
		listImportReviewRows({
			batchId: batch.id,
			organizationId,
			limit: 100,
			offset: paging ? (paging.page - 1) * CUSTOMER_IMPORT_PAGE_SIZE : 0,
		}),
		getBillableTimeSettings(organizationId),
		isCustomerImport ? listCustomerAccounting(db, organizationId) : Promise.resolve([]),
	]);
	const showBillability = billableTime.enabled;
	const customerImport = paging
		? {
				paging,
				rows: rows.map((row) => ({
					id: row.id,
					rowStatus: row.rowStatus,
					issueSeverity: row.issueSeverity,
					commitChoice: row.commitChoice ?? null,
					commitHold: row.commitHold ?? null,
					customer: readStagedCustomer(row),
				})),
				// Customers that can still be linked: active and not linked for this account.
				linkTargets: customerAccounting
					.filter((entry) => entry.isActive && entry.contactLink === null)
					.map((entry) => ({ customerId: entry.customerId, name: entry.name })),
				editable: batch.status === "needs_review",
			}
		: undefined;

	return (
		<div className="p-6">
			<div className="mx-auto max-w-6xl">
				<ImportReviewPage
					organizationId={organizationId}
					batchId={batch.id}
					summary={summary}
					rows={rows.map((row) => ({
						...row,
						billability: showBillability ? importRowBillability(row) : null,
					}))}
					showBillability={showBillability}
					customerImport={customerImport}
				/>
			</div>
		</div>
	);
}

function ImportReviewRouteLoading() {
	return (
		<LoadingRegion
			className="p-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.importReview",
				labelDefault: "Loading import review",
			}}
		>
			<div className="mx-auto max-w-6xl space-y-6">
				<div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
					{IMPORT_REVIEW_SUMMARY_LOADING_KEYS.map((key) => (
						<Skeleton key={key} aria-hidden="true" className="h-24 w-full" />
					))}
				</div>
				<Skeleton aria-hidden="true" className="h-80 w-full" />
			</div>
		</LoadingRegion>
	);
}

export default function ImportReviewRoute(props: ImportReviewRouteProps) {
	return (
		<Suspense fallback={<ImportReviewRouteLoading />}>
			<ImportReviewRouteContent {...props} />
		</Suspense>
	);
}
