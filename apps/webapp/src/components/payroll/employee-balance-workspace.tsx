"use client";

import { IconArrowLeft, IconRefresh } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { getPayrollEmployeeBalanceAction } from "@/app/[locale]/(app)/payroll/work-balances/[employeeId]/actions";
import {
	cancelBalanceAdjustmentAction,
	recordOvertimePayoutAction,
	setOpeningBalanceAction,
} from "@/app/[locale]/(app)/settings/employees/work-balance-actions";
import { CancelBalanceAdjustmentDialog } from "@/components/settings/work-balance/cancel-balance-adjustment-dialog";
import { RecordOvertimePayoutPanel } from "@/components/settings/work-balance/record-overtime-payout-dialog";
import { SetOpeningBalancePanel } from "@/components/settings/work-balance/set-opening-balance-dialog";
import {
	BalanceAdjustmentActionError,
	EMPLOYEE_WORK_BALANCE_QUERY_KEY,
	isRefusal,
} from "@/components/settings/work-balance/use-employee-work-balance";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
	BalanceAdjustmentHistory,
	useBalanceAdjustmentLabels,
} from "@/components/work-balance/balance-adjustment-history";
import { useOrganization } from "@/hooks/use-organization";
import type { BalanceAdjustmentGrantEmployee } from "@/lib/payroll-access/adjustment-coverage";
import {
	type BalanceAdjustmentActionResult,
	balanceAdjustmentFailureOf,
} from "@/lib/work-balance/adjustments/types";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";
import { Link } from "@/navigation";
import { EmployeeBalanceLoadingHeading } from "./employee-balance-loading-heading";
import { EmployeeBalanceProjection } from "./employee-balance-projection";

type Props = { employee: BalanceAdjustmentGrantEmployee; organizationId: string; userId: string };
async function unwrap<T>(action: Promise<BalanceAdjustmentActionResult<T>>) {
	const result = await action;
	if (!result.success) {
		const failure = balanceAdjustmentFailureOf(result);
		throw new BalanceAdjustmentActionError(failure.code, failure.details);
	}
	return result.data;
}

async function refreshAfter<T>(
	action: Promise<BalanceAdjustmentActionResult<T>>,
	refresh: () => Promise<unknown>,
) {
	try {
		return await unwrap(action);
	} finally {
		await refresh();
	}
}

/** The server admits the target through payroll coverage; display scope never authorizes a command. */
export function EmployeeBalanceWorkspace(props: Props) {
	const scope = useOrganization();
	const { t } = useTranslate();
	if (
		scope.isLoading ||
		scope.userId !== props.userId ||
		scope.activeOrganizationId !== props.organizationId
	)
		return (
			<div className="@container/main page-frame flex flex-1 flex-col gap-6">
				<EmployeeBalanceLoadingHeading />
				<p role="status">
					{t("payroll.workBalances.scopeChanged", "Loading the current payroll scope…")}
				</p>
			</div>
		);
	return (
		<EmployeeBalanceArrival
			key={JSON.stringify([props.organizationId, props.userId, props.employee.id])}
			{...props}
		/>
	);
}

function EmployeeBalanceArrival({ employee, organizationId, userId }: Props) {
	const { t } = useTranslate();
	const label = useBalanceAdjustmentLabels();
	const client = useQueryClient();
	const arrival = useId();
	const queryKey = [
		...EMPLOYEE_WORK_BALANCE_QUERY_KEY,
		employee.id,
		organizationId,
		userId,
		arrival,
	];
	const section = useQuery({
		queryKey,
		queryFn: async ({ signal }) => {
			const data = await unwrap(getPayrollEmployeeBalanceAction({ employeeId: employee.id }));
			signal.throwIfAborted();
			return data;
		},
		retry: false,
	});
	const [task, setTask] = useState<"opening" | "payout" | null>(null);
	const [cancelling, setCancelling] = useState<{ id: string; summary: string } | null>(null);
	const refused = section.isError && isRefusal(section.error);
	const data = refused ? undefined : section.data;
	const fresh = !!data && !section.isError && !section.isFetching;
	const canManage = !!data?.canManage;
	const balance = data?.balance;
	const changed = async <T,>(action: () => Promise<BalanceAdjustmentActionResult<T>>) => {
		if (!fresh || !canManage) throw new BalanceAdjustmentActionError("failed");
		return refreshAfter(action(), () =>
			client.invalidateQueries({
				queryKey: [...EMPLOYEE_WORK_BALANCE_QUERY_KEY, employee.id],
			}),
		);
	};

	return (
		<div className="@container/main page-frame flex flex-1 flex-col gap-6">
			<PageHeader
				title={
					<span className="flex flex-wrap items-center gap-2">
						{employee.name}
						{employee.isActive ? null : (
							<Badge variant="secondary">
								{t("payroll.workBalances.former", "Former employee")}
							</Badge>
						)}
					</span>
				}
				scope={
					<Link
						href="/payroll/work-balances"
						className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
					>
						<IconArrowLeft className="size-4" aria-hidden="true" />
						{t("payroll.workBalances.back", "Work balances")}
					</Link>
				}
				description={t(
					"settings.employees.workBalance.description",
					"Completed work minus required time, together with the opening balance and overtime payouts. Adjustments are never edited: a mistaken one is cancelled.",
				)}
				actions={
					<Button
						type="button"
						variant="outline"
						aria-label={t("payroll.workBalances.refresh", "Refresh work balance")}
						disabled={section.isFetching}
						onClick={() => void section.refetch()}
					>
						<IconRefresh aria-hidden="true" className="size-4" />
						{t("common.refresh", "Refresh")}
					</Button>
				}
			/>
			<EmployeeBalanceFeedback section={section} hasData={!!data} />
			{section.isPending ? (
				<p role="status">{t("settings.employees.workBalance.loading", "Loading work balance")}</p>
			) : null}
			{data ? (
				<>
					<EmployeeBalanceProjection
						balance={balance ?? null}
						timezone={data.timezone}
						actions={canManage ? { enabled: fresh, open: setTask } : null}
					/>
					{section.isFetching ? (
						<p role="status" className="text-sm text-muted-foreground">
							{t("payroll.workBalances.refreshing", "Refreshing work balance…")}
						</p>
					) : null}
					<section
						aria-labelledby="payroll-balance-ledger"
						className="min-w-0 space-y-3 wrap-anywhere"
					>
						<h2 id="payroll-balance-ledger" className="text-lg font-semibold">
							{t("settings.employees.workBalance.history", "Balance adjustments")}
						</h2>
						<BalanceAdjustmentHistory
							adjustments={data.adjustments}
							onCancel={
								canManage && fresh
									? (adjustment) =>
											setCancelling({
												id: adjustment.id,
												summary: `${label.kind(adjustment)} ${formatSignedWorkBalance(adjustment.minutes)}, ${label.day(adjustment.day)}`,
											})
									: undefined
							}
						/>
					</section>
					{canManage ? (
						<>
							<SetOpeningBalancePanel
								open={task === "opening"}
								onOpenChange={(open) => setTask(open ? "opening" : null)}
								today={data.today}
								replacesCurrent={data.adjustments.some(
									(a) => a.kind === "opening_balance" && !a.cancellation,
								)}
								onSet={(input) =>
									changed(() => setOpeningBalanceAction({ ...input, employeeId: employee.id }))
								}
							/>
							<RecordOvertimePayoutPanel
								open={task === "payout"}
								onOpenChange={(open) => setTask(open ? "payout" : null)}
								today={data.today}
								onRecord={(input) =>
									changed(() => recordOvertimePayoutAction({ ...input, employeeId: employee.id }))
								}
							/>
							<CancelBalanceAdjustmentDialog
								adjustment={cancelling}
								onOpenChange={(open) => {
									if (!open) setCancelling(null);
								}}
								onCancelAdjustment={(input) =>
									changed(() =>
										cancelBalanceAdjustmentAction({ ...input, employeeId: employee.id }),
									)
								}
							/>
						</>
					) : null}
				</>
			) : null}
		</div>
	);
}
function EmployeeBalanceFeedback({
	section,
	hasData,
}: {
	section: {
		isError: boolean;
		isFetching: boolean;
		error: unknown;
		refetch: () => Promise<unknown>;
	};
	hasData: boolean;
}) {
	const { t } = useTranslate();
	const refused = isRefusal(section.error);
	return (
		<>
			{section.isError ? (
				<div
					role="alert"
					className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-4"
				>
					<p className="text-sm">
						{refused
							? t(
									"payroll.workBalances.accessChanged",
									"This work balance is no longer available in your payroll scope.",
								)
							: hasData
								? t(
										"payroll.workBalances.stale",
										"Could not refresh. Previously loaded records are shown; refresh before making changes.",
									)
								: t(
										"settings.employees.workBalance.loadFailed",
										"The work balance could not be loaded.",
									)}
					</p>
					<Button
						type="button"
						variant="outline"
						onClick={() => void section.refetch()}
						disabled={section.isFetching}
						aria-label={t("payroll.workBalances.retry", "Retry work balance")}
					>
						{t("common.retry", "Retry")}
					</Button>
				</div>
			) : null}
		</>
	);
}
