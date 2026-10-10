"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTolgee, useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { reopenMonthAction } from "@/app/[locale]/(app)/settings/closed-months/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { formatClosedMonthLabel } from "@/lib/time-tracking/closed-months/month-label";
import { useRouter } from "@/navigation";

const ALL = "__all";
const EMPLOYEES = "__employees";

type ReopenFormValues = { scope: string; employeeIds: string[]; reason: string };

/**
 * Reopens a closed month for selected employees, a team (as recorded at the
 * close) or everything, with a reason (#762).
 */
export function ReopenMonthPanel({
	open,
	month,
	teams,
	employees,
	onOpenChange,
}: {
	open: boolean;
	month: string | null;
	teams: Array<{ id: string; name: string }>;
	employees: Array<{ id: string; name: string }>;
	onOpenChange: (open: boolean) => void;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const { refresh } = useRouter();
	const defaultValues: ReopenFormValues = { scope: ALL, employeeIds: [], reason: "" };
	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			if (!month) return;
			const result = await reopenMonthAction({
				month,
				reason: value.reason,
				scope:
					value.scope === ALL
						? { kind: "all" }
						: value.scope === EMPLOYEES
							? { kind: "employees", employeeIds: value.employeeIds }
							: { kind: "team", teamId: value.scope },
			});
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			switch (result.data.kind) {
				case "reopened":
					toast.success(
						t(
							"settings.closedMonths.reopenSuccess",
							"{month} reopened for {count, plural, one {# employee} other {# employees}}",
							{
								month: formatClosedMonthLabel(month, locale),
								count: result.data.employeeIds.length,
							},
						),
					);
					handleOpenChange(false);
					refresh();
					return;
				case "nothing_to_reopen":
					toast.info(
						t(
							"settings.closedMonths.nothingToReopen",
							"Nobody in this selection is closed for this month.",
						),
					);
					return;
				case "reason_required":
					toast.error(
						t("settings.closedMonths.reasonRequired", "Enter a reason for the reopening"),
					);
					return;
			}
		},
	});

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) form.reset(defaultValues);
		onOpenChange(nextOpen);
	}

	const monthLabel = month ? formatClosedMonthLabel(month, locale) : "";
	const reasonRequired = t(
		"settings.closedMonths.reasonRequired",
		"Enter a reason for the reopening",
	);

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
				<form
					className="flex min-h-0 flex-1 flex-col"
					action={() => {
						void form.handleSubmit();
					}}
					onSubmit={(event) => event.stopPropagation()}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.closedMonths.reopenTitle", "Reopen {month}", { month: monthLabel })}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.closedMonths.reopenDescription",
								"Reopened employees stay open until the month is closed again. Their managers are told.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-5">
						<form.Field name="scope">
							{(field) => (
								<TFormItem>
									<TFormLabel>
										{t("settings.closedMonths.reopenScopeLabel", "Reopen for")}
									</TFormLabel>
									<Select
										name="scope"
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value ?? ALL)}
									>
										<TFormControl>
											<SelectTrigger className="w-full" onBlur={field.handleBlur}>
												<SelectValue />
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											<SelectItem value={ALL}>
												{t("settings.closedMonths.scope.all", "Everything")}
											</SelectItem>
											<SelectItem value={EMPLOYEES}>
												{t("settings.closedMonths.scope.employees", "Selected employees")}
											</SelectItem>
											{teams.map((team) => (
												<SelectItem key={team.id} value={team.id}>
													{team.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>
						<form.Subscribe<string> selector={(state) => state.values.scope}>
							{(scope: string) =>
								scope === EMPLOYEES ? (
									<form.Field
										name="employeeIds"
										validators={{
											onSubmit: ({ value }) =>
												value.length > 0
													? undefined
													: t(
															"settings.closedMonths.employeesRequired",
															"Select at least one employee",
														),
										}}
									>
										{(field) => (
											<TFormItem>
												<TFormLabel hasError={fieldHasError(field)}>
													{t("settings.closedMonths.employeesLabel", "Employees")}
												</TFormLabel>
												<ul className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
													{employees.map((employee) => {
														const checked = field.state.value.includes(employee.id);
														return (
															<li key={employee.id} className="flex items-center gap-2">
																<Checkbox
																	id={`reopen-employee-${employee.id}`}
																	checked={checked}
																	onCheckedChange={(next) =>
																		field.handleChange(
																			next
																				? [...field.state.value, employee.id]
																				: field.state.value.filter((id) => id !== employee.id),
																		)
																	}
																/>
																<label
																	htmlFor={`reopen-employee-${employee.id}`}
																	className="min-w-0 truncate text-sm"
																>
																	{employee.name}
																</label>
															</li>
														);
													})}
												</ul>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>
								) : null
							}
						</form.Subscribe>
						<form.Field
							name="reason"
							validators={{
								onChange: ({ value }) => (value.trim() ? undefined : reasonRequired),
								onSubmit: ({ value }) => (value.trim() ? undefined : reasonRequired),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("settings.closedMonths.reasonLabel", "Reason")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Textarea
											name="reason"
											autoComplete="off"
											rows={3}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.closedMonths.reasonPlaceholder",
												"Why does this month need to change?…",
											)}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
							{(isSubmitting: boolean) => (
								<Button type="submit" disabled={isSubmitting || !month}>
									{isSubmitting ? (
										<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
									) : null}
									{t("settings.closedMonths.reopenSubmit", "Reopen month")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
