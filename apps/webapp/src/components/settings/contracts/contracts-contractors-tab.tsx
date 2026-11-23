"use client";

import { IconPencil, IconReceipt2 } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { listContractorCompensation } from "@/app/[locale]/(app)/settings/contracts/contractor-compensation-actions";
import { ExternalContractorBadge } from "@/components/engagement/engagement-kind-ui";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDisplayContext } from "@/hooks/use-display-context";
import type { ContractorCompensationOverviewRow } from "@/lib/contractor-compensation/store";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import {
	CONTRACTOR_COMPENSATION_REFUSALS,
	ContractorCompensationCard,
	describeCompensation,
} from "./contractor-compensation-card";

const OVERVIEW_QUERY_KEY = ["contractor-compensation", "overview"] as const;

/**
 * Settings → Contracts → Contractors (#1998): every External Contractor with
 * the rate in force today and their contracting company. Org admins only (the
 * page and the actions both require it). Editing opens the same editor as
 * Employee Detail.
 */
export function ContractsContractorsTab() {
	const { t } = useTranslate();
	const { locale } = useDisplayContext();
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState<ContractorCompensationOverviewRow | null>(null);
	const overview = useQuery({
		queryKey: OVERVIEW_QUERY_KEY,
		queryFn: async () => {
			const result = await listContractorCompensation();
			if (!result.success) {
				throw new Error(
					actionErrorMessage(t, result, CONTRACTOR_COMPENSATION_REFUSALS, () =>
						t(
							"settings.contracts.contractors.loadError",
							"Contractor compensation could not be loaded",
						),
					),
				);
			}
			return result.data;
		},
	});

	return (
		<div className="flex flex-col gap-4">
			<p className="max-w-3xl text-sm text-muted-foreground">
				{t(
					"settings.contracts.contractors.tabIntro",
					"External Contractors are paid by hour or by day under their own terms, never through employee contracts or payroll. Rates are visible to organization admins only.",
				)}
			</p>
			<Card>
				<CardContent className="p-0">
					{overview.isPending ? (
						<div className="space-y-2 p-4" role="status">
							<span className="sr-only">{t("common.loading", "Loading")}</span>
							<Skeleton className="h-8 w-full" aria-hidden="true" />
							<Skeleton className="h-8 w-full" aria-hidden="true" />
						</div>
					) : overview.isError ? (
						<div className="flex flex-wrap items-center justify-between gap-3 p-4">
							<p className="text-sm text-destructive" role="alert">
								{overview.error.message}
							</p>
							<Button
								variant="outline"
								size="sm"
								disabled={overview.isFetching}
								onClick={() => void overview.refetch()}
							>
								{t("common.retry", "Retry")}
							</Button>
						</div>
					) : overview.data.length === 0 ? (
						<div className="flex flex-col items-center gap-2 p-8 text-center">
							<IconReceipt2 aria-hidden="true" className="size-8 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">
								{t(
									"settings.contracts.contractors.none",
									"No External Contractors yet. Invite someone as an External Contractor to set their rates here.",
								)}
							</p>
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>
										{t("settings.contracts.contractors.columns.name", "Contractor")}
									</TableHead>
									<TableHead>
										{t("settings.contracts.contractors.columns.rateToday", "Rate today")}
									</TableHead>
									<TableHead className="hidden md:table-cell">
										{t("settings.contracts.contractors.columns.company", "Company")}
									</TableHead>
									<TableHead className="w-0">
										<span className="sr-only">
											{t("settings.contracts.contractors.columns.actions", "Actions")}
										</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{overview.data.map((row) => {
									const summary = row.termsToday
										? describeCompensation(t, locale, row.termsToday.compensation)
										: null;
									return (
										<TableRow key={row.employeeId}>
											<TableCell>
												<div className="flex flex-wrap items-center gap-2">
													<span className="font-medium">{row.name}</span>
													<ExternalContractorBadge engagementKind="contractor" />
													{!row.isActive && (
														<Badge variant="outline">
															{t("settings.contracts.contractors.inactive", "Inactive")}
														</Badge>
													)}
												</div>
											</TableCell>
											<TableCell>
												{summary ? (
													<div className="space-y-0.5">
														<div className="tabular-nums">{summary.rate}</div>
														{summary.rule && (
															<div className="text-xs text-muted-foreground">{summary.rule}</div>
														)}
													</div>
												) : (
													<span className="text-sm text-muted-foreground">
														{t("settings.contracts.contractors.noRateToday", "No rate in effect")}
													</span>
												)}
											</TableCell>
											<TableCell className="hidden md:table-cell">
												{row.details?.companyName ?? (
													<span className="text-muted-foreground">—</span>
												)}
											</TableCell>
											<TableCell>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => setEditing(row)}
													aria-label={t(
														"settings.contracts.contractors.editFor",
														"Edit compensation of {name}",
														{ name: row.name },
													)}
												>
													<IconPencil aria-hidden="true" className="size-4" />
												</Button>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<ActionPanel open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
				<ActionPanelContent size="wide">
					<ActionPanelHeader>
						<ActionPanelTitle>{editing?.name}</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.contracts.contractors.panelDescription",
								"Rates and contracting details",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody>
						{editing && (
							<ContractorCompensationCard
								employeeId={editing.employeeId}
								bare
								onChanged={() =>
									void queryClient.invalidateQueries({ queryKey: OVERVIEW_QUERY_KEY })
								}
							/>
						)}
					</ActionPanelBody>
				</ActionPanelContent>
			</ActionPanel>
		</div>
	);
}
