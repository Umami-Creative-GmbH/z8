"use client";
import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import {
	MAX_EXPIRY_REMINDER_LEAD_DAYS,
	MIN_EXPIRY_REMINDER_LEAD_DAYS,
	validateExpiryReminderLeadDays,
} from "@/lib/expiry-reminders/expiry";

/** Shared lead-time validation and field UI; each reminder domain owns saving and copy. */
export function ExpiryReminderLeadTimeCard({
	leadDays,
	labels,
	onSave,
}: {
	leadDays: number;
	labels: {
		title: string;
		description: string;
		leadDays: string;
		invalid: string;
		help: string;
		save: string;
	};
	onSave: (leadDays: string) => Promise<void>;
}) {
	const form = useForm({
		defaultValues: { leadDays: String(leadDays) },
		onSubmit: ({ value }) => onSave(value.leadDays),
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>{labels.title}</CardTitle>
				<CardDescription>{labels.description}</CardDescription>
			</CardHeader>
			<CardContent>
				{/* TanStack Form owns validation and submission; native navigation bypasses it. */}
				{/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
				<form
					className="space-y-4"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field
						name="leadDays"
						validators={{
							onChange: ({ value }) =>
								validateExpiryReminderLeadDays(value).ok ? undefined : labels.invalid,
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>{labels.leadDays}</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Input
										className="sm:w-40"
										type="number"
										inputMode="numeric"
										name={field.name}
										autoComplete="off"
										min={MIN_EXPIRY_REMINDER_LEAD_DAYS}
										max={MAX_EXPIRY_REMINDER_LEAD_DAYS}
										step={1}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormDescription>{labels.help}</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting ? (
									<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
								) : null}
								{labels.save}
							</Button>
						)}
					</form.Subscribe>
				</form>
			</CardContent>
		</Card>
	);
}
