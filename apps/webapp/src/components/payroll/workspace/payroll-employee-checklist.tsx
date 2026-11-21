"use client";

import { IconSearch } from "@tabler/icons-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { PayrollTranslate } from "./state";

export interface PayrollChecklistEmployee {
	id: string;
	name: string;
	employeeNumber?: string | null;
	teamName?: string | null;
}

/** A searchable checklist of employees, for choosing whose days to settle. */
export function PayrollEmployeeChecklist({
	employees,
	invalid,
	onChange,
	t,
	value,
}: {
	employees: readonly PayrollChecklistEmployee[];
	invalid?: boolean;
	onChange: (employeeIds: string[]) => void;
	t: PayrollTranslate;
	value: readonly string[];
}) {
	const idPrefix = useId();
	const [search, setSearch] = useState("");
	const selected = new Set(value);
	const query = search.trim().toLocaleLowerCase();
	const shown = query
		? employees.filter((employee) =>
				[employee.name, employee.employeeNumber, employee.teamName].some((text) =>
					text?.toLocaleLowerCase().includes(query),
				),
			)
		: employees;

	function toggle(employeeId: string, checked: boolean) {
		onChange(
			checked
				? [...value.filter((id) => id !== employeeId), employeeId]
				: value.filter((id) => id !== employeeId),
		);
	}

	return (
		<div className="flex flex-col gap-2 rounded-md border p-2" aria-invalid={invalid || undefined}>
			<div className="relative">
				<IconSearch
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					type="search"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					// The checklist sits inside the settle form: Enter filters, it must not submit.
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault();
					}}
					placeholder={t("payroll.settle.searchEmployees", "Search employees")}
					aria-label={t("payroll.settle.searchEmployees", "Search employees")}
					className="pl-8"
				/>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground text-xs">
				<span aria-live="polite">
					{t("payroll.settle.employeesChosen", "{count} of {total} chosen", {
						count: value.length,
						total: employees.length,
					})}
				</span>
				<span className="flex gap-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={shown.length === 0}
						onClick={() => onChange([...new Set([...value, ...shown.map((row) => row.id)])])}
					>
						{t("payroll.settle.chooseShown", "Choose shown")}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={value.length === 0}
						onClick={() => onChange([])}
					>
						{t("payroll.settle.chooseNone", "Clear")}
					</Button>
				</span>
			</div>
			<ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
				{shown.map((employee) => {
					const checkboxId = `${idPrefix}-${employee.id}`;
					return (
						<li key={employee.id} className="flex items-center gap-2 rounded px-1 py-1">
							<Checkbox
								id={checkboxId}
								checked={selected.has(employee.id)}
								onCheckedChange={(checked) => toggle(employee.id, checked === true)}
							/>
							<label
								htmlFor={checkboxId}
								className="flex min-w-0 flex-1 cursor-pointer gap-2 text-sm"
							>
								<span className="truncate">{employee.name}</span>
								<span className="truncate text-muted-foreground text-xs">
									{[employee.employeeNumber, employee.teamName].filter(Boolean).join(" · ")}
								</span>
							</label>
						</li>
					);
				})}
				{shown.length === 0 ? (
					<li className="px-1 py-2 text-muted-foreground text-sm">
						{t("payroll.settle.noEmployeesFound", "No employees match the search.")}
					</li>
				) : null}
			</ul>
		</div>
	);
}
