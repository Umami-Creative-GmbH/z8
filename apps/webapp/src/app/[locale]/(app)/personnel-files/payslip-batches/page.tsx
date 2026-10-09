import { IconArrowLeft, IconChevronRight } from "@tabler/icons-react";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Temporal } from "temporal-polyfill";
import { PayslipBatchStart } from "@/components/personnel-file/payslip-batch-start";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { systemClock } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { todayInOrganization } from "@/lib/personnel-file/document-rules";
import {
	canRunPayslipBatches,
	listOwnPayslipBatches,
} from "@/lib/personnel-file/payslip-batch-store";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

/**
 * Payslip batches (#868): start a batch for one pay period, and return to the
 * batches started before. Only for owners, admins and officers who manage
 * payslips; not found for everyone else.
 */
async function PayslipBatchesContent({ params }: { params: Promise<{ locale: string }> }) {
	const [t, current, { locale }] = await Promise.all([
		getTranslate(),
		loadCurrentPersonnelFileAccess(),
		params,
	]);
	if (current.status !== "resolved" || !canRunPayslipBatches(current.access)) notFound();
	const [[org], batches] = await Promise.all([
		db
			.select({ timezone: organization.timezone })
			.from(organization)
			.where(eq(organization.id, current.access.organizationId))
			.limit(1),
		listOwnPayslipBatches(db, current.access),
	]);
	const [year, month] = todayInOrganization(systemClock.nowInstant(), org?.timezone)
		.split("-")
		.map(Number);

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
			<header className="space-y-2">
				<Link
					href="/personnel-files"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<IconArrowLeft aria-hidden="true" className="size-4" />
					{t("settings.personnelFiles.area.back", "Personnel files")}
				</Link>
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.personnelFiles.batch.pageTitle", "Payslip batches")}
				</h1>
			</header>
			<PayslipBatchStart defaultPayPeriod={{ year: year ?? 2000, month: month ?? 1 }} />
			{batches.length > 0 ? (
				<section className="space-y-3">
					<h2 className="text-lg font-semibold">
						{t("settings.personnelFiles.batch.recent", "Your batches")}
					</h2>
					<Card className="py-0">
						<CardContent className="px-0">
							<ul className="divide-y">
								{batches.map((batch) => (
									<li key={batch.id}>
										<Link
											href={`/personnel-files/payslip-batches/${batch.id}`}
											className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
										>
											<span className="min-w-0 flex-1">
												<span className="block truncate font-medium">
													{formatPlainDate(
														Temporal.PlainDate.from({ ...batch.payPeriod, day: 1 }),
														locale,
														"monthYear",
													)}
												</span>
												<span className="block text-sm text-muted-foreground tabular-nums">
													{t("settings.personnelFiles.batch.fileCount", "{count} files", {
														count: batch.fileCount,
													})}
												</span>
											</span>
											<Badge variant={batch.status === "open" ? "outline" : "secondary"}>
												{batch.status === "open"
													? t("settings.personnelFiles.batch.statusOpen", "Not confirmed")
													: t("settings.personnelFiles.batch.statusConfirmed", "Confirmed")}
											</Badge>
											<IconChevronRight
												aria-hidden="true"
												className="size-4 shrink-0 text-muted-foreground"
											/>
										</Link>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				</section>
			) : null}
		</div>
	);
}

function PayslipBatchesLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.personnelFiles.batch.loading",
				labelDefault: "Loading payslip batches",
			}}
			className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-48" />
			<Skeleton aria-hidden="true" className="h-64 w-full" />
		</LoadingRegion>
	);
}

export default function PayslipBatchesPage(props: { params: Promise<{ locale: string }> }) {
	return (
		<Suspense fallback={<PayslipBatchesLoading />}>
			<PayslipBatchesContent {...props} />
		</Suspense>
	);
}
