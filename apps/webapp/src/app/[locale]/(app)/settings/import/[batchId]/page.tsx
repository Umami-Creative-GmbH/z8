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
import { listImportRowBillability } from "@/lib/import-review/import-row-billability";
import {
	getImportReviewSummary,
	listImportReviewRows,
} from "@/lib/import-review/repository";
import { readStagedCustomer } from "@/lib/import-review/staged-customer";

interface ImportReviewRouteProps {
	params: Promise<{ batchId: string }>;
}

const IMPORT_REVIEW_SUMMARY_LOADING_KEYS = [
	"total",
	"accepted",
	"rejected",
	"blocked",
	"committed",
	"issues",
] as const;

async function ImportReviewRouteContent({ params }: ImportReviewRouteProps) {
	const [{ batchId }, { organizationId }] = await Promise.all([
		params,
		requireOrgAdminSettingsAccess(),
	]);
	const batch = await db.query.importBatch.findFirst({
		where: and(
			eq(importBatch.id, batchId),
			eq(importBatch.organizationId, organizationId),
		),
	});

	if (!batch) notFound();
	// A customer import from the accounting connection (#906) shows every contact.
	const isCustomerImport = batch.provider === "accounting";

	const [summary, rows, billableTime, customerAccounting] = await Promise.all([
		getImportReviewSummary({ batchId: batch.id, organizationId }),
		listImportReviewRows({
			batchId: batch.id,
			organizationId,
			limit: isCustomerImport ? 500 : 100,
			offset: 0,
		}),
		getBillableTimeSettings(organizationId, db),
		isCustomerImport ? listCustomerAccounting(db, organizationId) : Promise.resolve([]),
	]);
	const showBillability = billableTime.enabled;
	// Rows whose mapped project has no active customer now import as non-billable (#907).
	const billability = showBillability
		? await listImportRowBillability(db, organizationId, rows)
		: rows.map(() => null);
	const customerImport = isCustomerImport
		? {
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
					rows={rows.map((row, index) => ({
						...row,
						billability: billability[index] ?? null,
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
