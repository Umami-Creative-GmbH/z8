"use client";

import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import type { EmployeeDetailFormApi } from "./page-utils";

export function TextField({
	form,
	name,
	label,
	placeholder,
	autoComplete = "off",
	description,
	disabled,
}: {
	form: EmployeeDetailFormApi;
	name: "firstName" | "lastName" | "position" | "employeeNumber";
	label: string;
	placeholder: string;
	autoComplete?: string;
	description?: string;
	disabled: boolean;
}) {
	return (
		<form.Field name={name}>
			{(field) => (
				<TFormItem>
					<TFormLabel hasError={fieldHasError(field)}>{label}</TFormLabel>
					<TFormControl hasError={fieldHasError(field)}>
						<Input
							name={name}
							autoComplete={autoComplete}
							placeholder={placeholder}
							value={field.state.value || ""}
							onChange={(event) => field.handleChange(event.target.value)}
							onBlur={field.handleBlur}
							disabled={disabled}
						/>
					</TFormControl>
					{description ? <TFormDescription>{description}</TFormDescription> : null}
					<TFormMessage field={field} />
				</TFormItem>
			)}
		</form.Field>
	);
}
