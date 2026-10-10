"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { changeAbsenceDeputy } from "@/app/[locale]/(app)/absences/deputy-actions";
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
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import type { AbsenceWithCategory } from "@/lib/absences/types";
import { DeputyPicker, deputyRefusalText, deputyRequiredText } from "./deputy-picker";

/** What the dialog needs of an absence: its own, or one a manager sees (#1012). */
export type ChangeDeputyAbsence = Pick<
	AbsenceWithCategory,
	"id" | "employeeId" | "startDate" | "endDate" | "deputy"
> & { category: Pick<AbsenceWithCategory["category"], "deputyRequired"> };

interface ChangeDeputyDialogProps {
	absence: ChangeDeputyAbsence;
	/** The absent employee, when a manager or admin changes the deputy (#1012). */
	employeeName?: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onChanged?: () => void;
}

/**
 * Names, changes or removes the deputy of an existing absence (#1011). It
 * needs no new approval: the deputy is not part of what the approver approved.
 */
export function ChangeDeputyDialog({
	absence,
	employeeName,
	open,
	onOpenChange,
	onChanged,
}: ChangeDeputyDialogProps) {
	const { t } = useTranslate();
	const required = Boolean(absence.category.deputyRequired);
	const form = useForm({
		defaultValues: { deputyEmployeeId: absence.deputy?.id ?? "" },
		onSubmit: async ({ value }) => {
			const result = await changeAbsenceDeputy({
				absenceId: absence.id,
				deputyEmployeeId: value.deputyEmployeeId || null,
			});
			if (result.success) {
				toast.success(t("absences.deputy.changed", "Deputy saved"));
				onChanged?.();
				onOpenChange(false);
				return;
			}
			const deputyError = deputyRefusalText(t, result.refusal);
			if (deputyError) {
				form.setFieldMeta("deputyEmployeeId", (meta) => ({
					...meta,
					errorMap: { ...meta.errorMap, onServer: deputyError },
				}));
				return;
			}
			toast.error(
				result.code === "ConflictError"
					? t(
							"absences.deputy.errors.ended",
							"The deputy can no longer be changed: this absence has ended.",
						)
					: t("absences.deputy.changeFailed", "Could not save the deputy"),
			);
		},
	});

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>{t("absences.deputy.changeTitle", "Change deputy")}</ActionPanelTitle>
						<ActionPanelDescription>
							{employeeName
								? t(
										"absences.deputy.changeDescriptionFor",
										"The deputy covers while {name} is away. Changing them needs no new approval.",
										{ name: employeeName },
									)
								: t(
										"absences.deputy.changeDescription",
										"The deputy covers while you are away. Changing them needs no new approval.",
									)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-4">
						<form.Field
							name="deputyEmployeeId"
							validators={{
								onSubmit: ({ value }) => (!value && required ? deputyRequiredText(t) : undefined),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={field.state.meta.errors.length > 0} required={required}>
										{t("absences.deputy.label", "Deputy")}
									</TFormLabel>
									<TFormControl hasError={field.state.meta.errors.length > 0}>
										<DeputyPicker
											value={field.state.value}
											onChange={field.handleChange}
											onBlur={field.handleBlur}
											startDate={absence.startDate}
											endDate={absence.endDate}
											employeeId={absence.employeeId}
											required={required}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting && (
										<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
									)}
									{t("absences.deputy.save", "Save deputy")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
