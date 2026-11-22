"use client";

import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { OpeningBalanceUploadPanel } from "@/components/settings/work-balance/opening-balance-upload-panel";
import { isMarkedFormer } from "@/components/former-employees/former-employee-ui";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import type { BalanceAdjustmentGrantEmployee } from "@/lib/payroll-access/adjustment-coverage";
import { Link } from "@/navigation";

export function WorkBalancesHeader({ actions }: { actions?: ReactNode }) {
	const { t } = useTranslate();
	return (
		<PageHeader
			title={t("payroll.workBalances.title", "Work balances")}
			scope={
				<Link
					href="/payroll"
					className="inline-flex items-center gap-2 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
				>
					<IconArrowLeft aria-hidden="true" className="size-4" />
					{t("payroll.workBalances.backToPayroll", "Payroll")}
				</Link>
			}
			description={t(
				"payroll.workBalances.description",
				"Record and cancel overtime payouts for the employees your payroll access covers, including employees who have left.",
			)}
			actions={actions}
		/>
	);
}

/** Display scope only; the server grant reader and actions retain all authority. */
export function WorkBalancesView({
	employees,
	userId,
	organizationId,
}: {
	employees: BalanceAdjustmentGrantEmployee[];
	userId: string;
	organizationId: string;
}) {
	const current = useOrganization();
	const { t } = useTranslate();
	if (current.userId !== userId || current.activeOrganizationId !== organizationId) return null;
	return (
		<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-6">
			<WorkBalancesHeader
				actions={employees.length > 0 ? <OpeningBalanceUploadPanel /> : undefined}
			/>
			{employees.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("payroll.workBalances.empty", "No employees are in your payroll access scope yet.")}
				</p>
			) : (
				<ul className="divide-y rounded-lg border bg-card">
					{employees.map((employee) => (
						<li key={employee.id}>
							<Link
								href={`/payroll/work-balances/${employee.id}`}
								className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
							>
								<span className="min-w-0 flex-[1_1_16rem] space-y-1 break-words">
									<span className="block font-medium">{employee.name}</span>
									{employee.employeeNumber ? (
										<span className="block text-sm text-muted-foreground tabular-nums">
											{employee.employeeNumber}
										</span>
									) : null}
								</span>
								{isMarkedFormer(employee) ? (
									<Badge variant="secondary">
										{t("payroll.workBalances.former", "Former employee")}
									</Badge>
								) : null}
								<span className="inline-flex items-center gap-2 text-sm text-foreground">
									{t("payroll.workBalances.openEmployee", "Open employee balance")}
									<IconArrowRight aria-hidden="true" className="size-4 shrink-0" />
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
