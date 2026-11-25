"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";

type NoteFieldApi = {
	name: string;
	state: { value: string; meta: { errors: ReactNode[] } };
	handleBlur: () => void;
	handleChange: (value: string) => void;
};

/** The required note / evidence input of the statutory monitor entry forms (Minijob offsets, working-student prior weeks). */
export function StatutoryNoteInputField({
	field,
	label,
	placeholder,
}: {
	field: NoteFieldApi;
	label: string;
	placeholder: string;
}) {
	return (
		<TFormItem>
			<TFormLabel hasError={fieldHasError(field)}>{label}</TFormLabel>
			<TFormControl hasError={fieldHasError(field)}>
				<Input
					name={field.name}
					value={field.state.value}
					placeholder={placeholder}
					onBlur={field.handleBlur}
					onChange={(event) => field.handleChange(event.target.value)}
				/>
			</TFormControl>
			<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
		</TFormItem>
	);
}
