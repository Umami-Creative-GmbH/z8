"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { uploadCsvWorkAction } from "@/app/[locale]/(app)/settings/import/csv-actions";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import {
	CSV_WORK_MAX_BYTES,
	csvWorkTemplate,
} from "@/lib/import-review/csv-work-format";
import { useRouter } from "@/navigation";

export function CsvWorkUpload({ organizationId }: { organizationId: string }) {
	const { t } = useTranslate();
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [reading, setReading] = useState(false);
	const form = useForm({
		defaultValues: { csv: "", fileName: "", timezone: "" },
		onSubmit: async ({ value }) => {
			setError(null);
			const result = await uploadCsvWorkAction({ organizationId, ...value });
			if (result.success)
				router.push(`/settings/import/${result.data.batchId}`);
			else setError(result.error);
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.import.csv.title", "CSV completed work")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.import.csv.description",
						"Import one completed work period per row. Represent breaks as gaps between rows. Nothing is recorded until you review and accept it.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				<Button asChild variant="outline">
					<a
						download="z8-completed-work-template.csv"
						href={`data:text/csv;charset=utf-8,${encodeURIComponent(csvWorkTemplate())}`}
					>
						{t("settings.import.csv.download", "Download CSV template")}
					</a>
				</Button>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.import.csv.format",
						"Use UTF-8, comma separators and the template headers. Maximum 500 KB and 1,000 rows. Vehicle columns are optional; readings and distance use whole kilometres.",
					)}
				</p>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<TFormItem>
						<TFormLabel>{t("settings.import.csv.file", "CSV file")}</TFormLabel>
						<TFormControl>
							<Input
								type="file"
								accept=".csv,text/csv"
								disabled={reading}
								onChange={async (event) => {
									const file = event.currentTarget.files?.[0];
									form.setFieldValue("csv", "");
									form.setFieldValue("fileName", "");
									setError(null);
									if (!file) return;
									if (file.size > CSV_WORK_MAX_BYTES) {
										setError(
											t(
												"settings.import.csv.tooLarge",
												"CSV files must be at most 500 KB",
											),
										);
										return;
									}
									setReading(true);
									try {
										const csv = await file.text();
										form.setFieldValue("csv", csv);
										form.setFieldValue("fileName", file.name);
									} catch {
										setError(
											t(
												"settings.import.csv.readFailed",
												"The selected file could not be read",
											),
										);
									} finally {
										setReading(false);
									}
								}}
							/>
						</TFormControl>
					</TFormItem>
					<form.Field name="timezone">
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t(
										"settings.import.csv.timezone",
										"Timezone for local timestamps",
									)}
								</TFormLabel>
								<TFormControl>
									<Input
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										placeholder="Europe/Berlin"
										autoComplete="off"
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.import.csv.timezoneHelp",
										"Required for timestamps without an offset. Explicit offsets such as +02:00 take precedence. Your browser timezone is never used implicitly.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					{error ? (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					) : null}
					<form.Subscribe
						selector={(state) => ({
							submitting: state.isSubmitting,
							csv: state.values.csv,
						})}
					>
						{({ submitting, csv }) => (
							<Button type="submit" disabled={reading || submitting || !csv}>
								{submitting
									? t("settings.import.csv.preparing", "Preparing preview…")
									: t("settings.import.csv.preview", "Preview CSV")}
							</Button>
						)}
					</form.Subscribe>
				</form>
			</CardContent>
		</Card>
	);
}
