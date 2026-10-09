import { IconArrowLeft } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PayslipBatchWorkspace } from "@/components/personnel-file/payslip-batch-workspace";
import { LoadingRegion } from "@/components/ui/loading-region";
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
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
			<header className="space-y-2">
				<Link
					href="/personnel-files/payslip-batches"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<IconArrowLeft aria-hidden="true" className="size-4" />
					{t("settings.personnelFiles.batch.back", "Payslip batches")}
				</Link>
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.personnelFiles.batch.title", "Payslip batch")}
				</h1>
			</header>
			<PayslipBatchWorkspace batchId={batch.id} />
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
			className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-48" />
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
