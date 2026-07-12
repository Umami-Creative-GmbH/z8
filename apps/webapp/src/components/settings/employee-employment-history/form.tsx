import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { DateField, TextField } from "./form-fields";
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
					label={t("settings.employmentHistory.weeklyHours", "Weekly Hours")}
					type="number"
					disabled={isCreating}
				/>
				<form.Field name="reviewState">
					{(field) => (
						<SelectField
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
						</SelectField>
					)}
				</form.Field>
				<form.Field name="workModel">
					{(field) => (
						<SelectField
							label={t("settings.employmentHistory.workModel", "Work Model")}
							field={field}
							disabled={isCreating}
						>
							<SelectItem value="onsite">
								{t("settings.employmentHistory.workModels.onsite", "onsite")}
							</SelectItem>
							<SelectItem value="hybrid">
								{t("settings.employmentHistory.workModels.hybrid", "hybrid")}
							</SelectItem>
							<SelectItem value="remote">
								{t("settings.employmentHistory.workModels.remote", "remote")}
							</SelectItem>
							<SelectItem value="flexible">
								{t("settings.employmentHistory.workModels.flexible", "flexible")}
							</SelectItem>
						</SelectField>
					)}
				</form.Field>
				<form.Field name="contractType">
					{(field) => (
						<SelectField
							label={t("settings.employmentHistory.contractType", "Contract Type")}
							field={field}
							disabled={isCreating}
						>
							<SelectItem value="fixed">
								{t("settings.employmentHistory.contractTypes.fixed", "fixed")}
							</SelectItem>
							<SelectItem value="hourly">
								{t("settings.employmentHistory.contractTypes.hourly", "hourly")}
							</SelectItem>
						</SelectField>
					)}
				</form.Field>
				<form.Field name="workPolicyId">
					{(field) => (
						<SelectField
							label={t("settings.employmentHistory.workPolicy", "Work Policy")}
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
						</SelectField>
					)}
				</form.Field>
				<TextField
					form={form}
					name="hourlyRate"
					label={t("settings.employmentHistory.hourlyRate", "Hourly Rate")}
					type="number"
					disabled={isCreating}
				/>
				<DateField
					form={form}
					name="probationStartsOn"
					label={t("settings.employmentHistory.probationStart", "Probation Start")}
					disabled={isCreating}
				/>
				<DateField
					form={form}
					name="probationEndsOn"
					label={t("settings.employmentHistory.probationEnd", "Probation End")}
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

type SelectFieldApi<TValue extends string> = {
	state: {
		value: TValue;
		meta: {
			errors: unknown[];
		};
	};
	handleChange: (value: TValue) => void;
};

function SelectField<TValue extends string>({
	label,
	field,
	disabled,
	description,
	children,
}: {
	label: string;
	field: SelectFieldApi<TValue>;
	disabled: boolean;
	description?: string;
	children: React.ReactNode;
}) {
	return (
		<TFormItem>
			<TFormLabel hasError={fieldHasError(field)}>{label}</TFormLabel>
			<Select
				value={field.state.value}
				onValueChange={(value) => field.handleChange(value as TValue)}
				disabled={disabled}
			>
				<TFormControl hasError={fieldHasError(field)}>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
				</TFormControl>
				<SelectContent>{children}</SelectContent>
			</Select>
			{description && <TFormDescription>{description}</TFormDescription>}
			<TFormMessage field={field} />
		</TFormItem>
	);
}
