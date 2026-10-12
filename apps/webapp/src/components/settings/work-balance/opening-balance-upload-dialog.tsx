"use client";

import { IconDownload, IconFileUpload, IconLoader2, IconUpload } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	commitOpeningBalanceUploadAction,
	previewOpeningBalanceUploadAction,
} from "@/app/[locale]/(app)/settings/employees/opening-balance-upload-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
	MAX_OPENING_BALANCE_UPLOAD_CHARACTERS,
	openingBalanceCsvTemplate,
} from "@/lib/work-balance/adjustments/opening-balance-csv";
import type {
	BalanceAdjustmentActionResult,
	OpeningBalanceUploadOutcome,
} from "@/lib/work-balance/adjustments/types";
import { OpeningBalanceUploadTable } from "./opening-balance-upload-table";
import { useBalanceAdjustmentErrorMessage } from "./use-balance-adjustment-error";
import { EMPLOYEE_WORK_BALANCE_QUERY_KEY } from "./use-employee-work-balance";
import { useOpeningBalanceUploadMessages } from "./use-opening-balance-upload-messages";

type Upload = {
	csv: string;
	outcome: OpeningBalanceUploadOutcome | { status: "unreadable" };
	/** True once a commit was refused: nothing was saved. */
	refused: boolean;
};

const TEMPLATE_FILE_NAME = "opening-balances-template.csv";

function downloadTemplate() {
	// The byte order mark makes spreadsheets read the file as UTF-8; the upload ignores it.
	const blob = new Blob([`﻿${openingBalanceCsvTemplate()}`], {
		type: "text/csv;charset=utf-8",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = TEMPLATE_FILE_NAME;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

/**
 * Uploads opening balances for many employees at once (#999): a CSV file is
 * previewed with every row's errors, and committed only when no row has one;
 * the commit writes all rows or none. Owners and admins reach it from the
 * employee list, payroll grant holders from the payroll Work balances page.
 */
export function OpeningBalanceUploadDialog() {
	const { t } = useTranslate();
	const inputId = useId();
	const queryClient = useQueryClient();
	const actionError = useBalanceAdjustmentErrorMessage();
	const { fileError } = useOpeningBalanceUploadMessages();
	const [open, setOpen] = useState(false);
	const [upload, setUpload] = useState<Upload | null>(null);
	const [pending, setPending] = useState<"preview" | "commit" | null>(null);

	function handleOpenChange(nextOpen: boolean) {
		if (pending) return;
		if (!nextOpen) setUpload(null);
		setOpen(nextOpen);
	}

	async function run(
		kind: "preview" | "commit",
		csv: string,
	): Promise<OpeningBalanceUploadOutcome | null> {
		setPending(kind);
		const action =
			kind === "preview" ? previewOpeningBalanceUploadAction : commitOpeningBalanceUploadAction;
		const result: BalanceAdjustmentActionResult<OpeningBalanceUploadOutcome> | null = await action({
			csv,
		}).catch(() => null);
		setPending(null);
		if (!result?.success) {
			toast.error(
				actionError(result?.code ?? null, {
					closedMonth: result?.success === false ? result.closedMonth : null,
				}),
			);
			return null;
		}
		return result.data;
	}

	async function handleFile(file: File | undefined) {
		if (!file) return;
		const csv = await file.text().catch(() => null);
		if (csv === null) {
			setUpload({ csv: "", outcome: { status: "unreadable" }, refused: false });
			return;
		}
		if (csv.length > MAX_OPENING_BALANCE_UPLOAD_CHARACTERS) {
			setUpload({
				csv,
				outcome: { status: "invalid_file", code: "file_too_large" },
				refused: false,
			});
			return;
		}
		const outcome = await run("preview", csv);
		setUpload(outcome ? { csv, outcome, refused: false } : null);
	}

	async function handleCommit() {
		if (!upload) return;
		const outcome = await run("commit", upload.csv);
		if (!outcome) return;
		if (outcome.status === "committed") {
			toast.success(
				t(
					"settings.employees.workBalance.upload.committed",
					"{count, plural, one {# opening balance set} other {# opening balances set}}",
					{ count: outcome.created },
				),
			);
			await queryClient.invalidateQueries({ queryKey: EMPLOYEE_WORK_BALANCE_QUERY_KEY });
			setUpload(null);
			setOpen(false);
			return;
		}
		setUpload({ csv: upload.csv, outcome, refused: true });
	}

	const outcome = upload?.outcome;
	const rows = outcome && "rows" in outcome ? outcome.rows : [];
	const errorRows = rows.filter((row) => row.errors.length > 0).length;
	const replacing = rows.filter((row) => row.replaces && row.errors.length === 0).length;

	return (
		<>
			<Button type="button" variant="outline" onClick={() => setOpen(true)}>
				<IconUpload aria-hidden="true" className="size-4" />
				{t("settings.employees.workBalance.upload.open", "Upload opening balances")}
			</Button>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent className="sm:max-w-5xl">
					<DialogHeader>
						<DialogTitle>
							{t("settings.employees.workBalance.upload.title", "Upload opening balances")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"settings.employees.workBalance.upload.description",
								"Set the opening balance of many employees from a CSV file with the columns employee_number, day (YYYY-MM-DD or DD.MM.YYYY), balance (hours and minutes such as 12:30 or -4:15) and reason. Each opening balance replaces the employee's work balance up to and including its day, and cancels the one in effect. Nothing is saved while any row has an error.",
							)}
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-3 sm:flex-row sm:items-end">
						<div className="grid flex-1 gap-2">
							<Label htmlFor={inputId}>
								{t("settings.employees.workBalance.upload.file", "CSV file")}
							</Label>
							<Input
								id={inputId}
								type="file"
								accept=".csv,text/csv"
								disabled={pending !== null}
								onChange={(event) => {
									const file = event.target.files?.[0];
									event.target.value = "";
									void handleFile(file);
								}}
							/>
						</div>
						<Button type="button" variant="ghost" onClick={downloadTemplate}>
							<IconDownload aria-hidden="true" className="size-4" />
							{t("settings.employees.workBalance.upload.template", "Download template")}
						</Button>
					</div>

					{pending === "preview" ? (
						<p className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
							<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
							{t("settings.employees.workBalance.upload.checking", "Checking the file…")}
						</p>
					) : null}

					{outcome?.status === "invalid_file" || outcome?.status === "unreadable" ? (
						<Alert variant="destructive">
							<AlertTitle>
								{t("settings.employees.workBalance.upload.invalidFile", "The file cannot be used")}
							</AlertTitle>
							<AlertDescription>
								{outcome.status === "invalid_file"
									? fileError(outcome.code, outcome.missingColumns)
									: fileError("unreadable")}
							</AlertDescription>
						</Alert>
					) : null}

					{rows.length > 0 ? (
						<div className="grid gap-3">
							{errorRows > 0 ? (
								<Alert variant="destructive">
									<AlertTitle>
										{upload?.refused
											? t("settings.employees.workBalance.upload.refusedTitle", "Nothing was saved")
											: t(
													"settings.employees.workBalance.upload.hasErrorsTitle",
													"Fix the rows with errors",
												)}
									</AlertTitle>
									<AlertDescription>
										{t(
											"settings.employees.workBalance.upload.hasErrors",
											"{errors, plural, one {# of {total} rows has an error} other {# of {total} rows have errors}}. Correct the file and upload it again.",
											{ errors: errorRows, total: rows.length },
										)}
									</AlertDescription>
								</Alert>
							) : (
								<p className="text-sm">
									{t(
										"settings.employees.workBalance.upload.allReady",
										"{total, plural, one {# row is ready} other {All # rows are ready}}; {replacing, plural, =0 {none replaces an opening balance in effect} one {# replaces an opening balance in effect} other {# replace an opening balance in effect}}.",
										{ total: rows.length, replacing },
									)}
								</p>
							)}
							<OpeningBalanceUploadTable rows={rows} />
						</div>
					) : null}

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={pending !== null}
							onClick={() => handleOpenChange(false)}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button
							type="button"
							disabled={outcome?.status !== "ready" || pending !== null}
							onClick={() => void handleCommit()}
						>
							{pending === "commit" ? (
								<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
							) : (
								<IconFileUpload aria-hidden="true" className="size-4" />
							)}
							{t(
								"settings.employees.workBalance.upload.submit",
								"{count, plural, one {Set # opening balance} other {Set # opening balances}}",
								{ count: rows.length },
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
