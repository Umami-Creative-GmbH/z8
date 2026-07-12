import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import type { EmploymentHistoryFormApi } from "./types";

export function TextField({
	form,
	name,
	label,
	type = "text",
	disabled,
}: {
	form: EmploymentHistoryFormApi;
	name: "weeklyHours" | "hourlyRate";
	label: string;
	type?: string;
	disabled?: boolean;
}) {
	return (
		<form.Field name={name}>
			{(field) => (
				<TFormItem>
					<TFormLabel hasError={fieldHasError(field)}>{label}</TFormLabel>
					<TFormControl hasError={fieldHasError(field)}>
						<Input
							name={name}
							type={type}
							inputMode={type === "number" ? "decimal" : undefined}
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
							onBlur={field.handleBlur}
							disabled={disabled}
							autoComplete="off"
						/>
					</TFormControl>
					<TFormMessage field={field} />
				</TFormItem>
			)}
		</form.Field>
	);
}

export function DateField({
	form,
	name,
	label,
	disabled,
	description,
	requiredMessage,
	required,
}: {
	form: EmploymentHistoryFormApi;
	name: "validFrom" | "probationStartsOn" | "probationEndsOn";
	label: string;
	disabled?: boolean;
	description?: string;
	requiredMessage?: string;
	required?: boolean;
}) {
	return (
		<form.Field
			name={name}
			validators={{
				onSubmit: required ? ({ value }) => (value ? undefined : requiredMessage) : undefined,
			}}
		>
			{(field) => (
				<TFormItem>
					<TFormLabel hasError={fieldHasError(field)} required={required}>
						{label}
					</TFormLabel>
					<TFormControl hasError={fieldHasError(field)}>
						<DatePicker
							name={name}
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
			)}
		</form.Field>
	);
}
