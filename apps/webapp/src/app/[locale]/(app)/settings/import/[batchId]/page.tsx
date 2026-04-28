import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ImportReviewPage } from "@/components/settings/import/import-review-page";
import { db } from "@/db";
import { importBatch } from "@/db/schema";
import { getImportReviewSummary, listImportReviewRows } from "@/lib/import-review/repository";
import { requireImportAdmin } from "../review-actions";

interface ImportReviewRouteProps {
	params: Promise<{ batchId: string }>;
}

export default async function ImportReviewRoute({ params }: ImportReviewRouteProps) {
	await connection();
	const { batchId } = await params;
	const batch = await db.query.importBatch.findFirst({
		where: eq(importBatch.id, batchId),
	});

	if (!batch) notFound();
	await requireImportAdmin(batch.organizationId);

	const [summary, rows] = await Promise.all([
		getImportReviewSummary({ batchId: batch.id, organizationId: batch.organizationId }),
		listImportReviewRows({
			batchId: batch.id,
			organizationId: batch.organizationId,
			limit: 100,
			offset: 0,
		}),
	]);

	return (
		<div className="p-6">
			<div className="mx-auto max-w-6xl">
				<ImportReviewPage
					organizationId={batch.organizationId}
					batchId={batch.id}
					summary={summary}
					rows={rows}
				/>
			</div>
		</div>
	);
}
