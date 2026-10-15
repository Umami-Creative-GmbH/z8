"use client";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "@/navigation";
import {
	getHistoricalImportReviewContext,
	commitHistoricalVacationImport,
} from "@/app/[locale]/(app)/settings/vacation/reconciliation-actions";
import { HistoricalVacationReconciliationPanel } from "@/components/absences/historical-vacation-reconciliation-panel";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from "@/components/ui/card";
import type {
	ReconciliationProof,
	ReconciliationSource,
} from "@/lib/absences/vacation-reconciliation-types";

type Context = Awaited<ReturnType<typeof getHistoricalImportReviewContext>>;
function ImportMappingForm({
	batchId,
	context,
}: {
	batchId: string;
	context: Context;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [reviewed, setReviewed] = useState<{
		signature: string;
		proof: ReconciliationProof;
	} | null>(null);
	const [message, setMessage] = useState("");
	const form = useForm({
		defaultValues: {
			mappings: context.rows.map((row) => ({
				rowId: row.id,
				categoryId: "",
				startPeriod: "full_day" as "full_day" | "am" | "pm",
				endPeriod: "full_day" as "full_day" | "am" | "pm",
			})),
		},
		onSubmit: async ({ value }) => {
			const source = { kind: "import", batchId, mappings: value.mappings };
			if (reviewed?.signature !== JSON.stringify(source)) {
				setMessage(
					t(
						"absences.reconciliation.reviewRequired",
						"Review the current mapping and remaining totals before committing.",
					),
				);
				return;
			}
			try {
				const result = await commitHistoricalVacationImport(reviewed.proof);
				if (!result.success) {
					setMessage(result.error);
					return;
				}
				setMessage(
					t(
						"absences.reconciliation.queued",
						"Reviewed absence import queued. Its dated records, totals and receipts will commit together.",
					),
				);
				setReviewed(null);
				router.refresh();
			} catch {
				setMessage(
					t(
						"absences.reconciliation.queueFailed",
						"Could not queue the import. Review its status before retrying.",
					),
				);
			}
		},
	});
	return (
		<Card className="mb-6">
			<CardHeader>
				<CardTitle>
					{t(
						"absences.reconciliation.importTitle",
						"Historical vacation in this import",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"absences.reconciliation.importHelp",
						"Confirm the category and coverage of every participating absence. Provider source identities are retained. Unknown categories cannot bypass the historical total.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{context.rows.map((row, index) => (
					<fieldset key={row.id} className="space-y-3 rounded-md border p-3">
						<legend className="px-1 text-sm font-medium">
							{row.providerSourceId}: {row.startsAt.slice(0, 10)} –{" "}
							{row.endsAt.slice(0, 10)}
						</legend>
						<p className="text-xs text-muted-foreground">
							{t(
								"absences.reconciliation.providerCategory",
								"Provider category",
							)}
							: {row.sourceCategory}
						</p>
						<form.Field name={`mappings[${index}].categoryId`}>
							{(field) => (
								<label className="block text-sm">
									{t(
										"absences.reconciliation.confirmCategory",
										"Confirmed Z8 category",
									)}
									<select
										name={field.name}
										autoComplete="off"
										className="mt-1 w-full rounded-md border bg-background p-2"
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => {
											field.handleChange(event.target.value);
											setReviewed(null);
										}}
									>
										<option value="">
											{t(
												"absences.reconciliation.chooseCategory",
												"Choose a category…",
											)}
										</option>
										{context.categories.map((category) => (
											<option key={category.id} value={category.id}>
												{category.name}
												{category.countsAgainstVacation
													? ` (${t("absences.reconciliation.vacationDeduction", "deducts vacation")})`
													: ""}
											</option>
										))}
									</select>
								</label>
							)}
						</form.Field>
						<div className="grid gap-3 sm:grid-cols-2">
							{(["startPeriod", "endPeriod"] as const).map((name) => (
								<form.Field key={name} name={`mappings[${index}].${name}`}>
									{(field) => (
										<label className="block text-sm">
											{name === "startPeriod"
												? t(
														"absences.reconciliation.startCoverage",
														"Start coverage",
													)
												: t(
														"absences.reconciliation.endCoverage",
														"End coverage",
													)}
											<select
												name={field.name}
												autoComplete="off"
												className="mt-1 w-full rounded-md border bg-background p-2"
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) => {
													const value = event.target.value;
													field.handleChange(
														value === "am" || value === "pm"
															? value
															: "full_day",
													);
													setReviewed(null);
												}}
											>
												<option value="full_day">
													{t("absences.change.fullDay", "Full day")}
												</option>
												<option value="am">
													{t("absences.change.morning", "Morning")}
												</option>
												<option value="pm">
													{t("absences.change.afternoon", "Afternoon")}
												</option>
											</select>
										</label>
									)}
								</form.Field>
							))}
						</div>
					</fieldset>
				))}
				<form.Subscribe selector={(state) => state.values.mappings}>
					{(mappings) => {
						if (mappings.some((row) => !row.categoryId))
							return (
								<p className="text-sm">
									{t(
										"absences.reconciliation.mappingRequired",
										"Choose every category before reviewing the remaining historical totals.",
									)}
								</p>
							);
						const source: ReconciliationSource = {
							kind: "import",
							batchId,
							mappings,
						};
						const signature = JSON.stringify(source);
						return (
							<HistoricalVacationReconciliationPanel
								headingLevel={2}
								key={signature}
								source={source}
								onReviewed={(proof) =>
									setReviewed(proof ? { signature, proof } : null)
								}
							/>
						);
					}}
				</form.Subscribe>
				{message ? (
					<p role="status" className="text-sm">
						{message}
					</p>
				) : null}
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(busy) => (
						<Button
							type="button"
							disabled={busy || !reviewed}
							onClick={() => void form.handleSubmit()}
						>
							{t(
								"absences.reconciliation.commitImport",
								"Queue reviewed historical absence import",
							)}
						</Button>
					)}
				</form.Subscribe>
			</CardContent>
		</Card>
	);
}
export function HistoricalVacationImportReview({
	batchId,
}: {
	batchId: string;
}) {
	const { t } = useTranslate();
	const context = useQuery({
		queryKey: ["historical-import-review", batchId],
		queryFn: () => getHistoricalImportReviewContext(batchId),
	});
	if (context.error)
		return (
			<p role="alert">
				{t(
					"absences.reconciliation.contextFailed",
					"Could not load historical absence review. Refresh to try again.",
				)}
			</p>
		);
	if (!context.data?.rows.length) return null;
	return (
		<ImportMappingForm
			key={context.data.rows.map((row) => row.id).join()}
			batchId={batchId}
			context={context.data}
		/>
	);
}
