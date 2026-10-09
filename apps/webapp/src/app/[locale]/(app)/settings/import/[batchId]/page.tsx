import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ImportReviewPage } from "@/components/settings/import/import-review-page";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { importBatch } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getBillableTimeSettings } from "@/lib/billable-time/settings";
import {
	getImportReviewSummary,
	listImportReviewRows,
} from "@/lib/import-review/repository";
import { importRowBillability } from "@/lib/import-review/staged-work-billability";

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

	const [summary, rows, billableTime] = await Promise.all([
		getImportReviewSummary({ batchId: batch.id, organizationId }),
		listImportReviewRows({
			batchId: batch.id,
			organizationId,
			limit: 100,
			offset: 0,
		}),
		getBillableTimeSettings(organizationId),
	]);
	const showBillability = billableTime.enabled;

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
