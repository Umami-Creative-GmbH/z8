import { IconArrowLeft, IconChevronRight } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Temporal } from "temporal-polyfill";
import { PayslipBatchStart } from "@/components/personnel-file/payslip-batch-start";
import { PayslipBatchesHeading } from "@/components/personnel-file/payslip-batches-heading";
import {
	PayslipBatchesRetry,
	PayslipBatchesScope,
} from "@/components/personnel-file/payslip-batches-scope";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { loadOrganizationDay } from "@/lib/personnel-file/organization-day";
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
async function PayslipBatchesContent({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const [t, current, { locale }] = await Promise.all([
		getTranslate(),
		loadCurrentPersonnelFileAccess(),
		params,
	]);
	if (current.status !== "resolved" || !canRunPayslipBatches(current.access))
		notFound();
	const [{ today }, history] = await Promise.all([
		loadOrganizationDay(db, {
			organizationId: current.access.organizationId,
			now: systemClock.nowInstant(),
		}),
		listOwnPayslipBatches(db, current.access)
			.then((batches) => ({ batches, failed: false }))
			.catch(() => ({ batches: [], failed: true })),
	]);

	const batches = history.batches;
	const expectedScope = {
		userId: current.access.userId,
		organizationId: current.access.organizationId,
	};
	return (
		<PayslipBatchesScope {...expectedScope}>
			<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-6">
				<PageHeader
					title={t(
						"settings.personnelFiles.batch.pageTitle",
						"Payslip batches",
					)}
					scope={
						<Link
							href="/personnel-files"
							className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
						>
							<IconArrowLeft aria-hidden="true" className="size-4" />
							{t("settings.personnelFiles.area.back", "Personnel files")}
						</Link>
					}
				/>
				<PayslipBatchStart
					expectedScope={expectedScope}
					defaultPayPeriod={{ year: today.year, month: today.month }}
				/>
				<section
					aria-labelledby="batch-history-heading"
					className="min-w-0 space-y-3"
				>
					<h2
						id="batch-history-heading"
						className="text-lg font-semibold tracking-tight"
					>
						{t("settings.personnelFiles.batch.recent", "Your batches")}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.personnelFiles.batch.historyScope",
							"Your 20 most recent batches in this organization. Only the person who started a batch can open it.",
						)}
					</p>
					{history.failed ? (
						<div role="alert" className="space-y-3 rounded-lg border p-4">
							<p>
								{t(
									"settings.personnelFiles.batch.historyFailed",
									"Could not load your batches. Retry to refresh the history; your start form choices are kept.",
								)}
							</p>
							<PayslipBatchesRetry />
						</div>
					) : batches.length === 0 ? (
						<p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
							{t(
								"settings.personnelFiles.batch.historyEmpty",
								"You have not started any payslip batches in this organization.",
							)}
						</p>
					) : (
						<Card className="py-0">
							<CardContent className="px-0">
								<ul className="divide-y">
									{batches.map((batch) => (
										<li key={batch.id}>
											<Link
												href={`/personnel-files/payslip-batches/${batch.id}`}
												className="flex min-w-0 flex-wrap items-center gap-3 rounded-sm px-4 py-4 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
											>
												<span className="min-w-0 flex-[1_1_10rem]">
													<span className="block break-words font-medium tabular-nums">
														{formatPlainDate(
															Temporal.PlainDate.from({
																...batch.payPeriod,
																day: 1,
															}),
															locale,
															"monthYear",
														)}
													</span>
													<span className="block text-sm text-muted-foreground tabular-nums">
														{t(
															"settings.personnelFiles.batch.fileCount",
															"{count} files",
															{
																count: batch.fileCount,
															},
														)}
													</span>
												</span>
												<Badge
													variant={
														batch.status === "open" ? "outline" : "secondary"
													}
												>
													{batch.status === "open"
														? t(
																"settings.personnelFiles.batch.statusOpen",
																"Not confirmed",
															)
														: t(
																"settings.personnelFiles.batch.statusConfirmed",
																"Confirmed",
															)}
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
					)}
				</section>
			</div>
		</PayslipBatchesScope>
	);
}

function PayslipBatchesLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.personnelFiles.batch.loading",
				labelDefault: "Loading payslip batches",
			}}
			className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-6"
			role="status"
		>
			<PayslipBatchesHeading />
			<Skeleton aria-hidden="true" className="h-64 w-full" />
		</LoadingRegion>
	);
}

export default function PayslipBatchesPage(props: {
	params: Promise<{ locale: string }>;
}) {
	return (
		<Suspense fallback={<PayslipBatchesLoading />}>
			<PayslipBatchesContent {...props} />
		</Suspense>
	);
}
