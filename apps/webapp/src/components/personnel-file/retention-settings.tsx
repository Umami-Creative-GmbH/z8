"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	getPersonnelFileRetentionSettingsAction,
	type PersonnelFileRetentionSettings,
	savePersonnelFileRetentionSettingsAction,
} from "@/app/[locale]/(app)/settings/personnel-files/retention-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { DOCUMENT_CATEGORIES } from "@/lib/personnel-file/document.types";
import { queryKeys } from "@/lib/query/keys";
import { usePersonnelFileLabels } from "./document-labels";
import {
	parseRetentionYears,
	toRetentionFormValues,
	toRetentionPeriods,
} from "./retention-form-values";

const queryKey = [...queryKeys.personnelFile.all, "retention-settings"] as const;

function RetentionForm({ data }: { data: PersonnelFileRetentionSettings }) {
	const { t } = useTranslate();
	const labels = usePersonnelFileLabels();
	const queryClient = useQueryClient();
	const invalidMessage = t(
		"settings.personnelFiles.retention.invalid",
		"Enter whole years between 1 and 100, or leave it empty.",
	);

	const form = useForm({
		defaultValues: toRetentionFormValues(data.periods),
		onSubmit: async ({ value }) => {
			const periods = toRetentionPeriods(value);
			if (!periods) return;
			const result = await savePersonnelFileRetentionSettingsAction({ periods });
			if (!result.success) {
				toast.error(
					result.error ||
						t(
							"settings.personnelFiles.retention.saveFailed",
							"Failed to save the retention periods",
						),
				);
				return;
			}
			await queryClient.invalidateQueries({ queryKey: queryKeys.personnelFile.all });
			toast.success(t("settings.personnelFiles.retention.saved", "Retention periods saved"));
		},
	});

	return (
		<form
			action={() => {
				void form.handleSubmit();
			}}
			className="grid gap-6"
		>
			<div className="grid gap-4 sm:grid-cols-2">
				{DOCUMENT_CATEGORIES.map((category) => {
					const suggested = data.suggestions[category].years;
					return (
						<form.Field
							key={category}
							name={category}
							validators={{
								onChange: ({ value }) =>
									parseRetentionYears(value) === "invalid" ? invalidMessage : undefined,
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={field.state.meta.errors.length > 0}>
										{labels.categories[category]}
									</TFormLabel>
									<div className="flex items-center gap-2">
										<TFormControl hasError={field.state.meta.errors.length > 0}>
											<Input
												inputMode="numeric"
												className="w-24 tabular-nums"
												value={field.state.value}
												placeholder={t("settings.personnelFiles.retention.none", "None")}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<span className="text-sm text-muted-foreground">
											{t("settings.personnelFiles.retention.years", "years")}
										</span>
										{field.state.value.trim() !== String(suggested) ? (
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() => field.handleChange(String(suggested))}
											>
												{t("settings.personnelFiles.retention.apply", "Apply suggestion")}
											</Button>
										) : null}
									</div>
									<TFormDescription>
										{t(
											"settings.personnelFiles.retention.suggested",
											"{years, plural, one {# year} other {# years}} suggested, not legal advice.",
											{ years: suggested },
										)}
									</TFormDescription>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					);
				})}
			</div>
			<form.Subscribe selector={(state) => [state.isSubmitting, state.canSubmit] as const}>
				{([isSubmitting, canSubmit]) => (
					<div>
						<Button type="submit" disabled={isSubmitting || !canSubmit}>
							{isSubmitting ? (
								<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
							) : null}
							{t("settings.personnelFiles.retention.save", "Save retention periods")}
						</Button>
					</div>
				)}
			</form.Subscribe>
		</form>
	);
}

/**
 * Retention periods per document category (#870). Documents become due for
 * deletion after their retention start plus the period; nothing is deleted
 * until a personnel file officer confirms the purge.
 */
export function PersonnelFileRetentionSettingsCard() {
	const { t } = useTranslate();
	const { data, isLoading, isError, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getPersonnelFileRetentionSettingsAction();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.personnelFiles.retention.title", "Retention periods")}</CardTitle>
				<CardDescription>
					{t(
						"settings.personnelFiles.retention.intro",
						"How many years employee documents are kept after the end of the later of the year the employment ended and the year of the document date. A category without a period is kept until someone deletes its documents. Documents past their period are listed as due for deletion and are only deleted when a personnel file officer confirms the purge. Current employees' documents are never due.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading && <Skeleton aria-hidden="true" className="h-32 w-full" />}
				{isError && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.personnelFiles.retention.loadFailed",
								"The retention periods could not be loaded.",
							)}
						</p>
						<Button type="button" variant="outline" onClick={() => void refetch()}>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{data && <RetentionForm data={data} />}
			</CardContent>
		</Card>
	);
}
