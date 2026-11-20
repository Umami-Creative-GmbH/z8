"use client";

import { IconUsers } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import type { PayrollTranslate } from "./state";

/** The current scope and the team and employee sheets that narrow it. */
export function PayrollScopeControls({
	isPending,
	onApplyEmployees,
	onApplyTeams,
	scopedEmployees,
	selectedEmployeeIds,
	selectedTeamNames,
	teamOptions,
	t,
}: {
	isPending: boolean;
	onApplyEmployees: (employeeIds: string[], onSuccess?: () => void) => void;
	onApplyTeams: (teamNames: string[], onSuccess?: () => void) => void;
	scopedEmployees: PayrollWorkspaceSummary["employees"];
	selectedEmployeeIds: string[];
	selectedTeamNames: string[];
	teamOptions: string[];
	t: PayrollTranslate;
}) {
	const scopeSummary = getPayrollScopeSummary({
		selectedEmployeeIds,
		selectedTeamNames,
		t,
	});

	return (
		<div
			data-payroll-scope-controls=""
			className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
		>
			<div className="flex min-w-0 items-start gap-2">
				<IconUsers aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0">
					<h2 className="font-medium text-sm">{t("payroll.scope.title", "Payroll scope")}</h2>
					<p className="text-muted-foreground text-sm">{scopeSummary}</p>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-2 sm:flex">
				<ScopeSheet
					description={t(
						"payroll.scope.specificTeamsDescription",
						"Choose teams to include in this payroll scope.",
					)}
					emptyText={t("payroll.scope.noAssignedTeams", "No assigned teams in this payroll scope.")}
					isPending={isPending}
					onApply={onApplyTeams}
					options={teamOptions.map((teamName, index) => ({
						value: teamName,
						label: teamName,
						checkboxId: `payroll-scope-team-${index}`,
					}))}
					selected={selectedTeamNames}
					title={t("payroll.scope.specificTeams", "Specific teams")}
					t={t}
				/>
				<ScopeSheet
					description={t(
						"payroll.scope.specificEmployeesDescription",
						"Choose employees to include in this payroll scope.",
					)}
					emptyText={t(
						"payroll.scope.noAssignedEmployees",
						"No assigned employees in this payroll scope.",
					)}
					isPending={isPending}
					onApply={onApplyEmployees}
					options={scopedEmployees.map((employee) => ({
						value: employee.id,
						label: employee.name,
						checkboxId: `payroll-scope-employee-${employee.id}`,
					}))}
					selected={selectedEmployeeIds}
					title={t("payroll.scope.specificEmployees", "Specific employees")}
					t={t}
				/>
			</div>
		</div>
	);
}

/** A sheet of checkboxes whose draft is applied only on Apply. */
function ScopeSheet({
	description,
	emptyText,
	isPending,
	onApply,
	options,
	selected,
	title,
	t,
}: {
	description: string;
	emptyText: string;
	isPending: boolean;
	onApply: (values: string[], onSuccess?: () => void) => void;
	options: { value: string; label: string; checkboxId: string }[];
	selected: string[];
	title: string;
	t: PayrollTranslate;
}) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(selected);
	const draftSet = new Set(draft);

	function openSheet(nextOpen: boolean) {
		setOpen(nextOpen);
		if (nextOpen) setDraft(selected);
	}

	function toggle(value: string, checked: boolean) {
		setDraft((current) =>
			checked ? [...current, value] : current.filter((currentValue) => currentValue !== value),
		);
	}

	function applyDraft() {
		const selectedSet = new Set(selected);
		const draftChanged =
			draft.length !== selected.length || draft.some((value) => !selectedSet.has(value));

		if (draftChanged) {
			onApply(draft, () => setOpen(false));
			return;
		}

		setOpen(false);
	}

	return (
		<Sheet onOpenChange={openSheet} open={open}>
			<SheetTrigger asChild>
				<Button disabled={isPending} type="button" variant="outline" size="sm">
					{title}
				</Button>
			</SheetTrigger>
			<SheetContent className="overflow-y-auto">
				<SheetHeader>
					<SheetTitle>{title}</SheetTitle>
					<SheetDescription>{description}</SheetDescription>
				</SheetHeader>
				<div className="space-y-3 px-4 pb-4">
					{options.map((option) => (
						<div key={option.value} className="flex items-center gap-2">
							<Checkbox
								checked={draftSet.has(option.value)}
								disabled={isPending}
								id={option.checkboxId}
								onCheckedChange={(checked) => toggle(option.value, checked === true)}
							/>
							<label className="cursor-pointer font-medium text-sm" htmlFor={option.checkboxId}>
								{option.label}
							</label>
						</div>
					))}
					{options.length > 0 ? null : <p className="text-muted-foreground text-sm">{emptyText}</p>}
				</div>
				<SheetFooter>
					<Button disabled={isPending} type="button" onClick={applyDraft}>
						{t("payroll.scope.apply", "Apply")}
					</Button>
					<SheetClose asChild>
						<Button disabled={isPending} type="button" variant="outline">
							{t("payroll.scope.cancel", "Cancel")}
						</Button>
					</SheetClose>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

function getPayrollScopeSummary({
	selectedEmployeeIds,
	selectedTeamNames,
	t,
}: {
	selectedEmployeeIds: string[];
	selectedTeamNames: string[];
	t: PayrollTranslate;
}) {
	if (selectedEmployeeIds.length === 0 && selectedTeamNames.length === 0) {
		return t("payroll.scope.allManaged", "All employees and teams I manage");
	}

	const parts: string[] = [];

	if (selectedTeamNames.length > 0) {
		parts.push(
			t("payroll.scope.selectedTeamsCount", "{count} teams", {
				count: selectedTeamNames.length,
			}),
		);
	}

	if (selectedEmployeeIds.length > 0) {
		parts.push(
			t("payroll.scope.selectedEmployeesCount", "{count} employees", {
				count: selectedEmployeeIds.length,
			}),
		);
	}

	return t("payroll.scope.selectedSummary", "{summary} selected", {
		summary: parts.join(", "),
	});
}
