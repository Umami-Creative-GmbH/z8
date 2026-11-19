import type { ComponentProps } from "react";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";

type TextField = {
	state: { value: string; meta: { errors: unknown[] } };
	handleChange: (value: string) => void;
	handleBlur: () => void;
};

export function TFormTextareaField({
	field,
	label,
	required,
	...textareaProps
}: {
	field: TextField;
	label: string;
} & Pick<ComponentProps<typeof Textarea>, "disabled" | "maxLength" | "name" | "rows" | "required">) {
	const hasError = fieldHasError(field);
	return (
		<TFormItem>
			<TFormLabel hasError={hasError} required={required}>
				{label}
			</TFormLabel>
			<TFormControl hasError={hasError}>
				<Textarea
					{...textareaProps}
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value)}
					onBlur={field.handleBlur}
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}
