"use client";

import { IconBuilding, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { updateContractorDetails } from "@/app/[locale]/(app)/settings/contracts/contractor-compensation-actions";
import { Button } from "@/components/ui/button";
import { ClientForm } from "@/components/ui/client-form";
import { Input } from "@/components/ui/input";
import { TFormControl, TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import type { ContractorCompensationRecord } from "@/lib/contractor-compensation/store";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { CONTRACTOR_COMPENSATION_REFUSALS } from "./contractor-compensation-refusals";

/** A contractor's company name, VAT ID and PO/cost-center reference (#1998). */
export function ContractorDetailsForm({
	employeeId,
	record,
	onSaved,
}: {
	employeeId: string;
	record: ContractorCompensationRecord;
	onSaved: (details: NonNullable<ContractorCompensationRecord["details"]>) => void;
}) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: {
			companyName: record.details?.companyName ?? "",
			vatId: record.details?.vatId ?? "",
			referenceCode: record.details?.referenceCode ?? "",
		},
		onSubmit: async ({ value }) => {
			const result = await updateContractorDetails({ employeeId, ...value }).catch(() => null);
			if (!result) {
				toast.error(t("common.unexpectedError", "An unexpected error occurred"));
				return;
			}
			if (!result.success) {
				toast.error(actionErrorMessage(t, result, CONTRACTOR_COMPENSATION_REFUSALS));
				return;
			}
			onSaved(result.data);
			form.reset({
				companyName: result.data.companyName ?? "",
				vatId: result.data.vatId ?? "",
				referenceCode: result.data.referenceCode ?? "",
			});
			toast.success(t("settings.contracts.contractors.detailsSaved", "Contracting details saved"));
		},
	});

	const fields = [
		{
			name: "companyName",
			label: t("settings.contracts.contractors.companyName", "Company name"),
			maxLength: 200,
		},
		{ name: "vatId", label: t("settings.contracts.contractors.vatId", "VAT ID"), maxLength: 50 },
		{
			name: "referenceCode",
			label: t("settings.contracts.contractors.referenceCode", "PO or cost-center reference"),
			maxLength: 100,
		},
	] as const;

	return (
		<section
			className="space-y-3 border-t pt-4"
			aria-labelledby={`contractor-details-${employeeId}`}
		>
			<div className="space-y-1">
				<h3
					id={`contractor-details-${employeeId}`}
					className="flex items-center gap-2 text-sm font-medium"
				>
					<IconBuilding aria-hidden="true" className="size-4" />
					{t("settings.contracts.contractors.detailsHeading", "Contracting details")}
				</h3>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.contracts.contractors.detailsDescription",
						"Optional. Shown on contractor statements so finance can match incoming invoices.",
					)}
				</p>
			</div>
			<ClientForm
				stopPropagation
				onSubmit={() => {
					if (form.state.isSubmitting) return;
					void form.handleSubmit();
				}}
				className="space-y-4"
			>
				<div className="grid gap-4 sm:grid-cols-3">
					{fields.map((entry) => (
						<form.Field key={entry.name} name={entry.name}>
							{(field) => (
								<TFormItem>
									<TFormLabel>{entry.label}</TFormLabel>
									<TFormControl>
										<Input
											autoComplete="off"
											maxLength={entry.maxLength}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
								</TFormItem>
							)}
						</form.Field>
					))}
				</div>
				<form.Subscribe selector={(state) => [state.isSubmitting, state.isDirty] as const}>
					{([isSubmitting, isDirty]) => (
						<div className="flex justify-end">
							<Button type="submit" variant="outline" disabled={isSubmitting || !isDirty}>
								{isSubmitting && (
									<IconLoader2
										aria-hidden="true"
										className="mr-2 size-4 motion-safe:animate-spin"
									/>
								)}
								{t("settings.contracts.contractors.saveDetails", "Save details")}
							</Button>
						</div>
					)}
				</form.Subscribe>
			</ClientForm>
		</section>
	);
}
