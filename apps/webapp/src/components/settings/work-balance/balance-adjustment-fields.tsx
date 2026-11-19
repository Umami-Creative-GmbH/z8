import { useTranslate } from "@tolgee/react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TFormItem, TFormLabel, TFormControl, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";

type BalanceTextField = {
	state: { value: string; meta: { errors: unknown[] } };
	handleChange: (value: string) => void;
	handleBlur: () => void;
};

export function BalanceMinutesField({ field }: { field: BalanceTextField }) {
	const { t } = useTranslate();
	const hasError = fieldHasError(field);
	return (
		<TFormItem>
			<TFormLabel hasError={hasError}>
				{t("settings.employees.workBalance.minutes", "Minutes")}
			</TFormLabel>
			<TFormControl hasError={hasError}>
				<Input
					name="minutes"
					type="number"
					inputMode="numeric"
					min={0}
					max={59}
					step={1}
					autoComplete="off"
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value)}
					onBlur={field.handleBlur}
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}

export function BalanceReasonField({
	field,
	placeholder,
}: {
	field: BalanceTextField;
	placeholder: string;
}) {
	const { t } = useTranslate();
	const hasError = fieldHasError(field);
	return (
		<TFormItem>
			<TFormLabel hasError={hasError} required>
				{t("settings.employees.workBalance.reason", "Reason")}
			</TFormLabel>
			<TFormControl hasError={hasError}>
				<Textarea
					name="reason"
					autoComplete="off"
					rows={3}
					maxLength={1000}
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value)}
					onBlur={field.handleBlur}
					placeholder={placeholder}
				/>
			</TFormControl>
			<TFormMessage field={field} />
		</TFormItem>
	);
}
