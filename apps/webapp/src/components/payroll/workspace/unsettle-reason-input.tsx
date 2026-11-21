import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import type { PayrollTranslate } from "./state";
interface ReasonField {
	name: string;
	state: { value: string; meta: { errors: unknown[] } };
	handleBlur: () => void;
	handleChange: (value: string) => void;
}
export function UnsettleReasonInput({ field, t }: { field: ReasonField; t: PayrollTranslate }) {
	return (
		<TFormItem>
			<TFormLabel hasError={fieldHasError(field)} required>
				{t("payroll.settle.reason", "Reason")}
			</TFormLabel>
			<TFormControl hasError={fieldHasError(field)}>
				<Textarea
					name={field.name}
					value={field.state.value}
					onBlur={field.handleBlur}
					onChange={(event) => field.handleChange(event.target.value)}
					rows={3}
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}
