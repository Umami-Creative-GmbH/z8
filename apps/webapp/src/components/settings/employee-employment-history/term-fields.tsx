import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
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

/**
 * Employment term controls shared by every form that confirms contract terms
 * (employment history and rehire). They take a TanStack field rather than a
 * form, so each form keeps its own values shape and validation rules while the
 * controls, labels and options stay identical.
 */
export type TermFieldApi<TValue extends string = string> = {
	name: string;
	state: { value: TValue; meta: { errors: unknown[] } };
	handleChange: (value: TValue) => void;
	handleBlur: () => void;
};

type TermFieldProps<TValue extends string> = {
	field: TermFieldApi<TValue>;
	label: string;
	required?: boolean;
	disabled?: boolean;
	description?: string;
};

/** Labels of the employment terms, identical wherever terms are confirmed. */
export function useEmploymentTermLabels() {
	const { t } = useTranslate();
	return {
		weeklyHours: t("settings.employmentHistory.weeklyHours", "Weekly Hours"),
		workModel: t("settings.employmentHistory.workModel", "Work Model"),
		contractType: t("settings.employmentHistory.contractType", "Contract Type"),
		workPolicy: t("settings.employmentHistory.workPolicy", "Work Policy"),
		hourlyRate: t("settings.employmentHistory.hourlyRate", "Hourly Rate"),
		probationStart: t("settings.employmentHistory.probationStart", "Probation Start"),
		probationEnd: t("settings.employmentHistory.probationEnd", "Probation End"),
	};
}

/** A decimal term such as weekly hours or an hourly rate. */
export function TermDecimalField({
	field,
	label,
	required,
	disabled,
	description,
	type = "text",
}: TermFieldProps<string> & { type?: "text" | "number" }) {
	return (
		<TFormItem>
			<TFormLabel hasError={fieldHasError(field)} required={required}>
				{label}
			</TFormLabel>
			<TFormControl hasError={fieldHasError(field)}>
				<Input
					name={field.name}
					type={type}
					inputMode="decimal"
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value)}
					onBlur={field.handleBlur}
					disabled={disabled}
					autoComplete="off"
				/>
			</TFormControl>
			{description && <TFormDescription>{description}</TFormDescription>}
			<TFormMessage field={field} />
		</TFormItem>
	);
}

/** A calendar-date term such as a probation boundary. */
export function TermDateField({
	field,
	label,
	required,
	disabled,
	description,
}: TermFieldProps<string>) {
	return (
		<TFormItem>
			<TFormLabel hasError={fieldHasError(field)} required={required}>
				{label}
			</TFormLabel>
			<TFormControl hasError={fieldHasError(field)}>
				<DatePicker
					name={field.name}
					value={field.state.value}
					onChange={field.handleChange}
					onBlur={field.handleBlur}
					disabled={disabled}
					required={required}
				/>
			</TFormControl>
			{description && <TFormDescription>{description}</TFormDescription>}
			<TFormMessage field={field} />
		</TFormItem>
	);
}

/** A choice between term options; pass the options as `SelectItem`s. */
export function TermSelectField<TValue extends string>({
	field,
	label,
	required,
	disabled,
	description,
	children,
}: TermFieldProps<TValue> & { children: ReactNode }) {
	return (
		<TFormItem>
			<TFormLabel hasError={fieldHasError(field)} required={required}>
				{label}
			</TFormLabel>
			<Select
				value={field.state.value}
				onValueChange={(value) => field.handleChange(value as TValue)}
				disabled={disabled}
			>
				<TFormControl hasError={fieldHasError(field)}>
					<SelectTrigger className="w-full">
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

export function ContractTypeOptions() {
	const { t } = useTranslate();
	return (
		<>
			<SelectItem value="fixed">
				{t("settings.employmentHistory.contractTypes.fixed", "fixed")}
			</SelectItem>
			<SelectItem value="hourly">
				{t("settings.employmentHistory.contractTypes.hourly", "hourly")}
			</SelectItem>
		</>
	);
}

export function WorkModelOptions() {
	const { t } = useTranslate();
	return (
		<>
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
		</>
	);
}
