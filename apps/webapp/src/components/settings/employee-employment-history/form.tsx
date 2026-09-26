import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { SelectItem } from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { DateField, TextField } from "./form-fields";
import {
	ContractTypeOptions,
	TermSelectField,
	useEmploymentTermLabels,
	WorkModelOptions,
} from "./term-fields";
import type { EmploymentHistoryFormApi, EmploymentHistoryWorkPolicyOption } from "./types";

export function EmploymentHistoryForm({
	form,
	isCreating,
	workPolicies,
	onCancel,
}: {
	form: EmploymentHistoryFormApi;
	isCreating: boolean;
	workPolicies: EmploymentHistoryWorkPolicyOption[];
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const terms = useEmploymentTermLabels();
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				form.handleSubmit();
			}}
			className="rounded-lg border bg-muted/20 p-4"
		>
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				<DateField
					form={form}
					name="validFrom"
					label={t("settings.employmentHistory.effectiveDate", "Effective Date")}
					disabled={isCreating}
					description={t(
						"settings.employmentHistory.effectiveDateHelp",
						"When this contract context takes effect",
					)}
					requiredMessage={t(
						"settings.employmentHistory.effectiveDateRequired",
						"Effective Date is required",
					)}
					required
				/>
				<TextField
					form={form}
					name="weeklyHours"
					label={terms.weeklyHours}
					type="number"
					disabled={isCreating}
				/>
				<form.Field name="reviewState">
					{(field) => (
						<TermSelectField
							label={t("settings.employmentHistory.reviewState", "Review State")}
							field={field}
							disabled={isCreating}
						>
							<SelectItem value="draft">
								{t("settings.employmentHistory.states.draft", "draft")}
							</SelectItem>
							<SelectItem value="pending">
								{t("settings.employmentHistory.states.pending", "pending")}
							</SelectItem>
							<SelectItem value="confirmed">
								{t("settings.employmentHistory.states.confirmed", "confirmed")}
							</SelectItem>
						</TermSelectField>
					)}
				</form.Field>
				<form.Field name="workModel">
					{(field) => (
						<TermSelectField label={terms.workModel} field={field} disabled={isCreating}>
							<WorkModelOptions />
						</TermSelectField>
					)}
				</form.Field>
				<form.Field name="contractType">
					{(field) => (
						<TermSelectField label={terms.contractType} field={field} disabled={isCreating}>
							<ContractTypeOptions />
						</TermSelectField>
					)}
				</form.Field>
				<form.Field name="workPolicyId">
					{(field) => (
						<TermSelectField
							label={terms.workPolicy}
							field={field}
							disabled={isCreating}
							description={t(
								"settings.employmentHistory.workPolicyHelp",
								"Overrides the selected policy for this employee during this contract period.",
							)}
						>
							<SelectItem value="__inherit__">
								{t("settings.employmentHistory.inheritWorkPolicy", "Inherit team/org policy")}
							</SelectItem>
							{workPolicies.map((policy) => (
								<SelectItem key={policy.id} value={policy.id}>
									{policy.name}
								</SelectItem>
							))}
						</TermSelectField>
					)}
				</form.Field>
				<TextField
					form={form}
					name="hourlyRate"
					label={terms.hourlyRate}
					type="number"
					disabled={isCreating}
				/>
				<DateField
					form={form}
					name="probationStartsOn"
					label={terms.probationStart}
					disabled={isCreating}
				/>
				<DateField
					form={form}
					name="probationEndsOn"
					label={terms.probationEnd}
					disabled={isCreating}
				/>
			</div>
			<form.Field name="changeReason">
				{(field) => (
					<TFormItem className="mt-4">
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.employmentHistory.reasonNote", "Reason / Note")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								name="changeReason"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								disabled={isCreating}
								autoComplete="off"
								placeholder={t(
									"settings.employmentHistory.reasonPlaceholder",
									"Annual review, role change, or work-model update...",
								)}
								rows={2}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<div className="mt-4 flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={onCancel} disabled={isCreating}>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button type="submit" disabled={isCreating}>
					{isCreating && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
					{t("settings.employmentHistory.saveChange", "Save Change")}
				</Button>
			</div>
		</form>
	);
}
