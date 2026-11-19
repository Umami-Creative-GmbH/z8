import { IconArrowLeft } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PayslipBatchLoadingHeading } from "@/components/personnel-file/payslip-batch-loading-heading";
import { PayslipBatchWorkspace } from "@/components/personnel-file/payslip-batch-workspace";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { loadOwnPayslipBatch } from "@/lib/personnel-file/payslip-batch-store";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

interface PayslipBatchPageProps {
	params: Promise<{ batchId: string }>;
}

/** One payslip batch (#868), only for the officer who started it. */
async function PayslipBatchContent({ params }: PayslipBatchPageProps) {
	const [t, current, { batchId }] = await Promise.all([
		getTranslate(),
		loadCurrentPersonnelFileAccess(),
		params,
	]);
	if (current.status !== "resolved" || !isCanonicalUuid(batchId)) notFound();
	const batch = await loadOwnPayslipBatch(db, current.access, batchId);
	if (!batch) notFound();

	return (
		<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-6">
			<PageHeader
				title={t("settings.personnelFiles.batch.title", "Payslip batch")}
				scope={
					<Link
						href="/personnel-files/payslip-batches"
						className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
					>
						<IconArrowLeft aria-hidden="true" className="size-4" />
						{t("settings.personnelFiles.batch.back", "Payslip batches")}
					</Link>
				}
			/>
			<PayslipBatchWorkspace
				batchId={batch.id}
				userId={current.access.userId}
				organizationId={current.access.organizationId}
			/>
		</div>
	);
}

function PayslipBatchLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.personnelFiles.batch.loadingBatch",
				labelDefault: "Loading the payslip batch",
			}}
			className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-6"
			role="status"
		>
			<PayslipBatchLoadingHeading />
			<Skeleton aria-hidden="true" className="h-64 w-full" />
		</LoadingRegion>
	);
}

export default function PayslipBatchPage(props: PayslipBatchPageProps) {
	return (
		<Suspense fallback={<PayslipBatchLoading />}>
			<PayslipBatchContent {...props} />
		</Suspense>
	);
}
