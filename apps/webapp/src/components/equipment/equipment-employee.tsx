"use client";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { BackLink } from "@/components/travel-expenses/back-link";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import type { EquipmentView } from "@/lib/organization/equipment/contracts";
import { EquipmentAssignmentsCard } from "./equipment-assignments-card";
import { EquipmentEmployeeHeader } from "./equipment-employee-header";
import {
	EquipmentIssueActions,
	EquipmentRefreshButton,
} from "./equipment-header-actions";
import {
	type AssignmentFilters,
	DEFAULT_ASSIGNMENT_FILTERS,
} from "./equipment-list";
import { issuanceAvailability, useEquipmentPanels } from "./equipment-panels";

/** "2 outstanding returns · 1 overdue" for one holder. */
export function useHolderSummary(data: EquipmentView) {
	const { t } = useTranslate();
	const outstanding = data.assignments.filter((a) => a.outstanding).length;
	const overdue = data.assignments.filter(
		(a) => a.outstanding && a.overdue,
	).length;
	const parts = [
		t(
			"settings.equipment.employee.outstanding",
			"{count, plural, =0 {No outstanding returns} one {# outstanding return} other {# outstanding returns}}",
			{ count: outstanding },
		),
	];
	if (overdue)
		parts.push(
			t(
				"settings.equipment.employee.overdue",
				"{count, plural, other {# overdue}}",
				{ count: overdue },
			),
		);
	return parts.join(" · ");
}

/**
 * One employee's equipment (#1572): on its own page with the holder as heading,
 * or as a section of the employee profile. Issuance is prefilled with the holder;
 * a former employee keeps returns, history and historical records.
 */
export function EmployeeEquipment({
	data,
	employeeId,
	variant = "section",
}: {
	data: EquipmentView;
	employeeId: string;
	variant?: "page" | "section";
}) {
	const { t } = useTranslate();
	const { open, panel, pending } = useEquipmentPanels(data);
	const locale = useLocale();
	const [filters, setFilters] = useState<AssignmentFilters>({
		...DEFAULT_ASSIGNMENT_FILTERS,
		status: "all",
	});
	const summary = useHolderSummary(data);
	const { canIssue, canRecordHistorical, employee } = issuanceAvailability(
		data,
		employeeId,
	);
	const holder = data.assignments[0];
	const name = employee?.name ?? holder?.holderName ?? "";
	const former = employee?.former ?? holder?.former ?? false;
	const image = employee?.image ?? holder?.holderImage ?? null;
	const actions = (
		<EquipmentIssueActions
			canIssue={canIssue}
			canRecordHistorical={canRecordHistorical}
			disabled={pending}
			onIssue={() => open({ kind: "issue", employeeId })}
			onRecordHistorical={() => open({ kind: "historical", employeeId })}
		/>
	);
	const back = `/equipment/employees/${employeeId}`;
	const card = (
		<EquipmentAssignmentsCard
			data={data}
			filters={filters}
			onFiltersChange={setFilters}
			showHolder={false}
			defaultStatus="all"
			back={back}
			onAction={(action, assignmentId) => open({ kind: action, assignmentId })}
			emptyAction={
				canIssue ? (
					<Button onClick={() => open({ kind: "issue", employeeId })}>
						{t("settings.equipment.custody.issue", "Issue equipment")}
					</Button>
				) : null
			}
		/>
	);
	const formerHelp =
		data.canManage && former ? (
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.custody.formerHelp",
					"Former employees remain available for returns, history and recording existing holdings. New issuance is unavailable.",
				)}
			</p>
		) : null;
	if (variant === "section")
		return (
			<section
				className="min-w-0 space-y-4"
				aria-label={t("settings.equipment.title", "Equipment")}
			>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1">
						<h2 className="text-lg font-semibold">
							{t("settings.equipment.title", "Equipment")}
						</h2>
						<p className="text-sm text-muted-foreground tabular-nums">
							{summary}
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<EquipmentRefreshButton />
						{actions}
					</div>
				</div>
				{formerHelp}
				{card}
				{panel}
			</section>
		);
	return (
		<>
			{data.canManage ? (
				<div>
					<BackLink href="/equipment">
						{t("settings.equipment.detail.back", "Back to equipment")}
					</BackLink>
				</div>
			) : null}
			<div className="flex items-start gap-3.5">
				<div className="shrink-0 pt-1">
					<UserAvatar
						seed={employeeId}
						image={image}
						name={name}
						size="md"
						showClockStatus={false}
					/>
				</div>
				<EquipmentEmployeeHeader
					name={name}
					former={former}
					calendar={data}
					description={summary}
					actions={
						<>
							<EquipmentRefreshButton />
							{actions}
						</>
					}
				/>
			</div>
			{formerHelp}
			<section
				aria-label={t(
					"settings.equipment.employee.returns",
					"Employee returns",
				)}
				className="grid grid-cols-1 overflow-hidden rounded-xl border bg-card text-card-foreground @sm/main:grid-cols-2"
			>
				<button
					type="button"
					aria-label={t(
						"settings.equipment.kpi.showOutstanding",
						"Show outstanding returns",
					)}
					aria-pressed={filters.status === "outstanding"}
					onClick={() => setFilters({ ...filters, status: "outstanding" })}
					className="flex min-w-0 flex-col items-start gap-2 p-4 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-pressed:bg-primary/5 lg:p-5"
				>
					<span className="text-sm font-medium">
						{t("settings.equipment.filters.outstanding", "Outstanding returns")}
					</span>
					<span className="text-2xl font-semibold tabular-nums">
						{data.assignments
							.filter((a) => a.outstanding)
							.length.toLocaleString(locale)}
					</span>
				</button>
				<button
					type="button"
					aria-label={t(
						"settings.equipment.kpi.showOverdue",
						"Show overdue returns",
					)}
					aria-pressed={filters.status === "overdue"}
					onClick={() => setFilters({ ...filters, status: "overdue" })}
					className="flex min-w-0 flex-col items-start gap-2 border-t p-4 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-pressed:bg-primary/5 lg:p-5 @sm/main:border-t-0 @sm/main:border-l"
				>
					<span className="text-sm font-medium">
						{t("settings.equipment.custody.overdue", "Overdue")}
					</span>
					<span className="text-2xl font-semibold tabular-nums">
						{data.assignments
							.filter((a) => a.outstanding && a.overdue)
							.length.toLocaleString(locale)}
					</span>
				</button>
			</section>
			<div>{card}</div>
			{panel}
		</>
	);
}
