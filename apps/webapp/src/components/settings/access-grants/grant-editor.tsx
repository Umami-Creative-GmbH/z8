"use client";

import { IconEdit, IconLoader2, IconPlus, IconUserOff } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { EmployeeMultiSelect, type SelectableEmployee } from "@/components/employee-select";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * Parts of the access grant editors shared by payroll access and expense
 * officer grants (#747, ADR 0001): the grant list, the revoke confirmation and
 * the scope fields (all, or named teams and employees). Each page owns its
 * form, its copy (passed in already translated) and its extra fields.
 */

export interface GrantPersonOption {
	id: string;
	name: string;
	email: string;
}

export interface GrantTeamOption {
	id: string;
	name: string;
}

export type GrantScope = "all" | "specific";

export function toSelectableEmployee(
	person: GrantPersonOption,
	{ isActive }: { isActive: boolean },
): SelectableEmployee {
	return {
		id: person.id,
		userId: person.id,
		firstName: null,
		lastName: null,
		pronouns: null,
		position: null,
		role: "employee",
		isActive,
		teamId: null,
		user: { id: person.id, name: person.name, email: person.email, image: null },
		team: null,
	};
}

export function toggleId(values: string[], id: string, checked: boolean): string[] {
	if (checked) return values.includes(id) ? values : [...values, id];
	return values.filter((value) => value !== id);
}

export interface GrantListRow {
	id: string;
	title: string;
	details: ReactNode;
}

export function GrantList({
	rows,
	canAdd,
	onAdd,
	onEdit,
	onRevoke,
	copy,
}: {
	rows: GrantListRow[];
	canAdd: boolean;
	onAdd: () => void;
	onEdit: (id: string) => void;
	onRevoke: (id: string) => void;
	copy: { add: string; empty: string; edit: string; revoke: string };
}) {
	return (
		<Card>
			<CardHeader className="flex justify-end">
				<Button type="button" onClick={onAdd} disabled={!canAdd}>
					<IconPlus className="size-4" aria-hidden="true" />
					{copy.add}
				</Button>
			</CardHeader>
			<CardContent>
				{rows.length === 0 ? (
					<p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
						{copy.empty}
					</p>
				) : (
					<div className="divide-y rounded-lg border">
						{rows.map((row) => (
							<div
								key={row.id}
								className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
							>
								<div className="space-y-1">
									<p className="font-medium text-sm">{row.title}</p>
									<div className="text-muted-foreground text-sm">{row.details}</div>
								</div>
								<div className="flex flex-wrap gap-2">
									<Button type="button" variant="outline" size="sm" onClick={() => onEdit(row.id)}>
										<IconEdit className="size-4" aria-hidden="true" />
										{copy.edit}
									</Button>
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="text-destructive hover:text-destructive"
										onClick={() => onRevoke(row.id)}
									>
										<IconUserOff className="size-4" aria-hidden="true" />
										{copy.revoke}
									</Button>
								</div>
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export function RevokeGrantDialog({
	open,
	pending,
	onConfirm,
	onClose,
	copy,
}: {
	open: boolean;
	pending: boolean;
	onConfirm: () => void;
	onClose: () => void;
	copy: { title: string; description: string; cancel: string; confirm: string };
}) {
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !pending) onClose();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{copy.title}</AlertDialogTitle>
					<AlertDialogDescription>{copy.description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>{copy.cancel}</AlertDialogCancel>
					<AlertDialogAction
						onClick={(event) => {
							event.preventDefault();
							onConfirm();
						}}
						disabled={pending}
						className="bg-destructive hover:bg-destructive/90"
					>
						{pending ? <IconLoader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
						{copy.confirm}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export interface GrantScopeCopy {
	scope: string;
	allScope: string;
	specificScope: string;
	allScopeDescription: string;
	specificScopeDescription: string;
	teams: string;
	noTeams: string;
	employees: string;
	selectEmployees: string;
	/** Shown under the employees while departed ones are selected; null hides it. */
	departedNotice: string | null;
}

/** The scope toggle and, for a specific scope, the team switches and the employee picker. */
export function GrantScopeFields({
	scope,
	onScopeChange,
	teamIds,
	onTeamIdsChange,
	employeeIds,
	onEmployeeIdsChange,
	teams,
	employeeOptions,
	disabled,
	testIdPrefix,
	copy,
}: {
	scope: GrantScope;
	onScopeChange: (scope: GrantScope) => void;
	teamIds: string[];
	onTeamIdsChange: (teamIds: string[]) => void;
	employeeIds: string[];
	onEmployeeIdsChange: (employeeIds: string[]) => void;
	teams: GrantTeamOption[];
	employeeOptions: SelectableEmployee[];
	disabled: boolean;
	testIdPrefix: string;
	copy: GrantScopeCopy;
}) {
	return (
		<>
			<fieldset className="space-y-3">
				<legend className="text-sm font-medium">{copy.scope}</legend>
				<ToggleGroup
					type="single"
					variant="outline"
					value={scope}
					onValueChange={(value) => {
						if (value === "all" || value === "specific") onScopeChange(value);
					}}
					disabled={disabled}
					className="w-full"
				>
					<ToggleGroupItem value="all" aria-label={copy.allScope}>
						{copy.allScope}
					</ToggleGroupItem>
					<ToggleGroupItem value="specific" aria-label={copy.specificScope}>
						{copy.specificScope}
					</ToggleGroupItem>
				</ToggleGroup>
				<p className="text-muted-foreground text-sm">
					{scope === "all" ? copy.allScopeDescription : copy.specificScopeDescription}
				</p>
			</fieldset>

			{scope === "specific" ? (
				<div className="grid gap-6 lg:grid-cols-2">
					<fieldset className="space-y-3">
						<legend className="text-sm font-medium">{copy.teams}</legend>
						{teams.length === 0 ? (
							<p className="text-muted-foreground text-sm">{copy.noTeams}</p>
						) : (
							<div className="grid gap-2 sm:grid-cols-2" data-testid={`${testIdPrefix}-grid`}>
								{teams.map((team) => {
									const isSelected = teamIds.includes(team.id);
									return (
										<button
											key={team.id}
											type="button"
											role="switch"
											aria-checked={isSelected}
											aria-label={team.name}
											data-testid={`${testIdPrefix}-${team.id}`}
											onClick={() => onTeamIdsChange(toggleId(teamIds, team.id, !isSelected))}
											disabled={disabled}
											className={`flex items-center justify-between gap-4 rounded-md border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
												isSelected ? "border-primary/60 bg-primary/5" : "hover:bg-accent/50"
											}`}
										>
											<span>{team.name}</span>
											<span
												aria-hidden="true"
												className={`inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors ${
													isSelected ? "bg-primary" : "bg-input dark:bg-input/80"
												}`}
											>
												<span
													className={`block size-4 rounded-full bg-background ring-0 transition-transform dark:bg-foreground ${
														isSelected
															? "translate-x-[calc(100%-2px)] dark:bg-primary-foreground"
															: "translate-x-0"
													}`}
												/>
											</span>
										</button>
									);
								})}
							</div>
						)}
					</fieldset>

					<div className="space-y-2">
						<EmployeeMultiSelect
							label={copy.employees}
							placeholder={copy.selectEmployees}
							value={employeeIds}
							onChange={onEmployeeIdsChange}
							employees={employeeOptions}
							disabled={disabled}
						/>
						{copy.departedNotice ? (
							<p className="flex items-start gap-2 text-muted-foreground text-sm">
								<IconUserOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
								{copy.departedNotice}
							</p>
						) : null}
					</div>
				</div>
			) : null}
		</>
	);
}
