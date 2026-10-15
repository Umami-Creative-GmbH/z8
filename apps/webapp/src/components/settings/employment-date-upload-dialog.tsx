"use client";
import { IconDownload, IconLoader2, IconUpload } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import {
	commitEmploymentDateUploadAction,
	previewEmploymentDateUploadAction,
} from "@/app/[locale]/(app)/settings/employees/employment-date-upload-actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	employmentDateUploadTemplate,
	MAX_EMPLOYMENT_DATE_UPLOAD_CHARACTERS,
} from "@/lib/employee-lifecycle/employment-date-upload-csv";
import type { EmploymentDateUploadOutcome } from "@/lib/employee-lifecycle/employment-date-upload-types";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { useRouter } from "@/navigation";
import { EmploymentDateUploadReview } from "./employment-date-upload-review";
function downloadTemplate() {
	const url = URL.createObjectURL(
		new Blob(["\uFEFF", employmentDateUploadTemplate()], { type: "text/csv;charset=utf-8" }),
	);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = "actual-joining-dates-template.csv";
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}
export function EmploymentDateUploadDialog() {
	const { t } = useTranslate();
	const id = useId();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);
	const [review, setReview] = useState<{
		csv: string;
		outcome: EmploymentDateUploadOutcome;
	} | null>(null);
	const form = useForm({
		defaultValues: { csv: "" },
		onSubmit: async ({ value }) => {
			setBusy(true);
			setError(null);
			setSaved(null);
			setReview(null);
			await runWithCleanup(
				async () => {
					const result = await previewEmploymentDateUploadAction({ csv: value.csv }).catch(
						() => null,
					);
					if (!result?.success) {
						setError(
							result?.error ??
								t(
									"settings.employmentUpload.preview-failed",
									"Could not review the upload. Try again.",
								),
						);
						return;
					}
					setReview({ csv: value.csv, outcome: result.data });
				},
				() => setBusy(false),
			);
		},
	});
	const chooseFile = async (file: File | undefined) => {
		setReview(null);
		setError(null);
		setSaved(null);
		form.setFieldValue("csv", "");
		if (!file) return;
		const text = await file.text().catch(() => null);
		if (text === null) {
			setError(t("settings.employmentUpload.unreadable", "The selected file could not be read."));
			return;
		}
		if (text.length > MAX_EMPLOYMENT_DATE_UPLOAD_CHARACTERS) {
			setReview({ csv: "", outcome: { status: "invalid_file", code: "file_too_large" } });
			return;
		}
		form.setFieldValue("csv", text);
	};
	const commit = async () => {
		if (!review || review.outcome.status !== "ready" || busy) return;
		const fingerprint = review.outcome.fingerprint;
		setBusy(true);
		setError(null);
		await runWithCleanup(
			async () => {
				const result = await commitEmploymentDateUploadAction({
					csv: review.csv,
					fingerprint,
				}).catch(() => null);
				if (!result?.success) {
					setError(
						result?.error ??
							t(
								"settings.employmentUpload.commit-failed",
								"Could not commit the batch. Generate a new preview before retrying.",
							),
					);
					setReview(null);
					return;
				}
				setReview({ csv: review.csv, outcome: result.data });
				if (result.data.status !== "committed") return;
				setSaved(
					result.data.refreshPending
						? t(
								"settings.employmentUpload.saved-pending",
								"{count} actual joining dates saved. Balances are being recalculated.",
								{ count: result.data.corrected },
							)
						: t(
								"settings.employmentUpload.saved",
								"{count} actual joining dates saved and balances updated.",
								{ count: result.data.corrected },
							),
				);
				await queryClient.invalidateQueries();
				router.refresh();
			},
			() => setBusy(false),
		);
	};
	const handleOpenChange = (next: boolean) => {
		if (busy) return;
		setOpen(next);
		if (!next) {
			setReview(null);
			setError(null);
			setSaved(null);
			form.reset();
		}
	};
	return (
		<>
			<Button type="button" variant="outline" onClick={() => setOpen(true)}>
				<IconUpload className="size-4" aria-hidden="true" />
				{t("settings.employmentUpload.open", "Upload actual joining dates")}
			</Button>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent className="flex max-h-[90vh] flex-col sm:max-w-6xl">
					<DialogHeader>
						<DialogTitle>
							{t("settings.employmentUpload.title", "Bulk correction of actual joining dates")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"settings.employmentUpload.description",
								"Upload supplied true employment dates for employees in this organization. Dates are never guessed from account creation or first recorded work. Every row is reviewed and saved together; any error or closed-month blocker prevents the whole batch.",
							)}
						</DialogDescription>
					</DialogHeader>
					<div className="min-h-0 space-y-5 overflow-y-auto pr-1">
						<p id={`${id}-guidance`} className="text-sm text-muted-foreground">
							{t(
								"settings.employmentUpload.format",
								"CSV columns: employee_number, employment_start_date, reason. Personnel numbers ignore surrounding spaces and letter case; leading zeros matter. Dates: YYYY-MM-DD or DD.MM.YYYY. Use commas, semicolons or tabs. Supply a reason and source for every correction. Maximum 200 rows.",
							)}
						</p>
						<form
							className="space-y-3"
							onSubmit={(event) => {
								event.preventDefault();
								void form.handleSubmit();
							}}
						>
							<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
								<div className="flex-1 space-y-2">
									<Label htmlFor={`${id}-file`}>
										{t("settings.employmentUpload.file", "Actual joining dates CSV")}
									</Label>
									<Input
										id={`${id}-file`}
										type="file"
										name="employmentDateCsv"
										accept=".csv,text/csv"
										disabled={busy}
										aria-describedby={`${id}-guidance`}
										onChange={(event) => {
											const file = event.target.files?.[0];
											void chooseFile(file);
										}}
									/>
								</div>
								<Button type="button" variant="ghost" onClick={downloadTemplate}>
									<IconDownload className="size-4" aria-hidden="true" />
									{t("settings.employmentUpload.template", "Download joining-date template")}
								</Button>
							</div>
							<form.Subscribe selector={(state) => state.values.csv}>
								{(csv) => (
									<Button type="submit" variant="outline" disabled={busy || !csv}>
										{busy ? (
											<IconLoader2
												className="size-4 animate-spin motion-reduce:animate-none"
												aria-hidden="true"
											/>
										) : null}
										{t("settings.employmentUpload.preview", "Review uploaded joining dates")}
									</Button>
								)}
							</form.Subscribe>
						</form>
						{error ? (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						) : null}
						{saved ? (
							<p role="status" className="text-sm">
								{saved}
							</p>
						) : null}
						{review ? <EmploymentDateUploadReview outcome={review.outcome} /> : null}
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => handleOpenChange(false)}
						>
							{t("common.close", "Close")}
						</Button>
						{review?.outcome.status === "ready" ? (
							<Button type="button" disabled={busy} onClick={() => void commit()}>
								{t("settings.employmentUpload.commit", "Save all reviewed joining dates")}
							</Button>
						) : null}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
