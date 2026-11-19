import { useTranslate } from "@tolgee/react";
import { DatePicker } from "@/components/ui/date-picker";
import {
	TFormItem,
	TFormLabel,
	TFormControl,
	TFormDescription,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";

type DeadlineField = {
	state: { value: string; meta: { errors: unknown[] } };
	handleChange: (value: string) => void;
};

export function DocumentRequestDeadline({
	field,
	today,
	description,
}: {
	field: DeadlineField;
	today: string;
	description?: string;
}) {
	const { t } = useTranslate();
	const hasError = fieldHasError(field);
	return (
		<TFormItem>
			<TFormLabel hasError={hasError} required>
				{t("settings.personnelFiles.requests.create.deadline", "Deadline")}
			</TFormLabel>
			<TFormControl hasError={hasError}>
				<DatePicker
					value={field.state.value}
					onChange={(value) => field.handleChange(value)}
					min={today}
					required
				/>
			</TFormControl>
			<TFormDescription>
				{description ??
					t(
						"settings.personnelFiles.requests.create.deadlineHint",
						"The day by which the employee should submit. After it, the request is overdue.",
					)}
			</TFormDescription>
			<TFormMessage field={field} />
		</TFormItem>
	);
}
