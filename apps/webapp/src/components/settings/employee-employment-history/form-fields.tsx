import { TermDateField, TermDecimalField } from "./term-fields";
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
	type?: "text" | "number";
	disabled?: boolean;
}) {
	return (
		<form.Field name={name}>
			{(field) => <TermDecimalField field={field} label={label} type={type} disabled={disabled} />}
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
				<TermDateField
					field={field}
					label={label}
					disabled={disabled}
					description={description}
					required={required}
				/>
			)}
		</form.Field>
	);
}
