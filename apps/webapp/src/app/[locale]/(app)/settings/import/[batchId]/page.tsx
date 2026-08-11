import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ImportReviewPage } from "@/components/settings/import/import-review-page";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { importBatch } from "@/db/schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import {
	getImportReviewSummary,
	listImportReviewRows,
} from "@/lib/import-review/repository";

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

	const [summary, rows] = await Promise.all([
		getImportReviewSummary({ batchId: batch.id, organizationId }),
		listImportReviewRows({
			batchId: batch.id,
			organizationId,
			limit: 100,
			offset: 0,
		}),
	]);

	return (
		<div className="p-6">
			<div className="mx-auto max-w-6xl">
				<ImportReviewPage
					organizationId={organizationId}
					batchId={batch.id}
					summary={summary}
					rows={rows}
				/>
			</div>
		</div>
	);
}

function ImportReviewRouteLoading() {
	return (
		<div className="p-6" role="status" aria-label="Loading import review">
			<div className="mx-auto max-w-6xl space-y-6">
				<div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
					{IMPORT_REVIEW_SUMMARY_LOADING_KEYS.map((key) => (
						<Skeleton key={key} aria-hidden="true" className="h-24 w-full" />
					))}
				</div>
				<Skeleton aria-hidden="true" className="h-80 w-full" />
			</div>
		</div>
	);
}

export default function ImportReviewRoute(props: ImportReviewRouteProps) {
	return (
		<Suspense fallback={<ImportReviewRouteLoading />}>
			<ImportReviewRouteContent {...props} />
		</Suspense>
	);
}
