"use client";

import { IconAlertCircle, IconCircleCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { OpeningBalanceUploadRow } from "@/lib/work-balance/adjustments/types";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";
import { useOpeningBalanceUploadMessages } from "./use-opening-balance-upload-messages";

/** The rows of a bulk opening balance upload with each row's errors (#999). */
export function OpeningBalanceUploadTable({ rows }: { rows: OpeningBalanceUploadRow[] }) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	const { rowError } = useOpeningBalanceUploadMessages();
	const formatDay = (day: string) =>
		formatPlainDate(parsePlainDate(day), displayContext.locale, "dateMedium");

	return (
		<div className="max-h-[50vh] overflow-auto rounded-md border">
			<Table>
				<TableHeader className="sticky top-0 bg-background">
					<TableRow>
						<TableHead className="w-14 text-right">
							{t("settings.employees.workBalance.upload.columns.row", "Row")}
						</TableHead>
						<TableHead>
							{t("settings.employees.workBalance.upload.columns.employee", "Employee")}
						</TableHead>
						<TableHead>{t("settings.employees.workBalance.upload.columns.day", "Day")}</TableHead>
						<TableHead className="text-right">
							{t("settings.employees.workBalance.upload.columns.balance", "Balance")}
						</TableHead>
						<TableHead>
							{t("settings.employees.workBalance.upload.columns.reason", "Reason")}
						</TableHead>
						<TableHead>
							{t("settings.employees.workBalance.upload.columns.status", "Status")}
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow
							key={row.row}
							className={row.errors.length > 0 ? "bg-destructive/5" : undefined}
						>
							<TableCell className="text-right tabular-nums text-muted-foreground">
								{row.row}
							</TableCell>
							<TableCell>
								<span className="block font-medium">{row.employee?.name ?? "—"}</span>
								<span className="flex items-center gap-2 text-muted-foreground text-xs tabular-nums">
									{row.employeeNumber}
									{row.employee && !row.employee.isActive ? (
										<Badge variant="secondary">
											{t("settings.employees.workBalance.upload.former", "Former employee")}
										</Badge>
									) : null}
								</span>
							</TableCell>
							<TableCell className="whitespace-nowrap">
								{row.day ? formatDay(row.day) : "—"}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{row.minutes === null ? "—" : formatSignedWorkBalance(row.minutes)}
							</TableCell>
							<TableCell className="max-w-56 truncate" title={row.reason}>
								{row.reason}
							</TableCell>
							<TableCell className="min-w-56">
								{row.errors.length > 0 ? (
									<ul className="space-y-1 text-destructive text-sm">
										{row.errors.map((error) => (
											<li key={error.code} className="flex gap-1.5">
												<IconAlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
												<span>
													{rowError(error.code)}
													{error.conflictingPayouts?.length ? (
														<span className="block tabular-nums">
															{error.conflictingPayouts
																.map(
																	(payout) =>
																		`${formatDay(payout.day)}: ${formatSignedWorkBalance(payout.minutes)}`,
																)
																.join(", ")}
														</span>
													) : null}
												</span>
											</li>
										))}
									</ul>
								) : (
									<span className="flex gap-1.5 text-sm">
										<IconCircleCheck
											aria-hidden="true"
											className="mt-0.5 size-4 shrink-0 text-emerald-600"
										/>
										{row.replaces
											? t(
													"settings.employees.workBalance.upload.replaces",
													"Replaces the opening balance of {balance} on {day}",
													{
														balance: formatSignedWorkBalance(row.replaces.minutes),
														day: formatDay(row.replaces.day),
													},
												)
											: t("settings.employees.workBalance.upload.ready", "Ready")}
									</span>
								)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
