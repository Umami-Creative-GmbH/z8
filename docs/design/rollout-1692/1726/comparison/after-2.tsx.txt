"use client";

import { IconDownload, IconFileUpload, IconLoader2, IconUpload } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	commitOpeningBalanceUploadAction,
	previewOpeningBalanceUploadAction,
} from "@/app/[locale]/(app)/settings/employees/opening-balance-upload-actions";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TFormControl, TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import {
	MAX_OPENING_BALANCE_UPLOAD_CHARACTERS,
	openingBalanceCsvTemplate,
} from "@/lib/work-balance/adjustments/opening-balance-csv";
import {
	type BalanceAdjustmentActionResult,
	balanceAdjustmentFailureOf,
	type OpeningBalanceUploadOutcome,
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
	const { userId, activeOrganizationId } = useOrganization();
	if (!userId || !activeOrganizationId) return null;
	return <ScopedOpeningBalanceUploadDialog key={JSON.stringify([userId, activeOrganizationId])} />;
}

function ScopedOpeningBalanceUploadDialog() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const actionError = useBalanceAdjustmentErrorMessage();
	const { fileError } = useOpeningBalanceUploadMessages();
	const [open, setOpen] = useState(false);
	const [upload, setUpload] = useState<Upload | null>(null);
	const [pending, setPending] = useState<"preview" | "commit" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const busy = useRef(false);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const form = useForm({ defaultValues: { file: null as File | null }, onSubmit: handleCommit });

	function handleOpenChange(nextOpen: boolean) {
		if (busy.current) return;
		if (!nextOpen) {
			setUpload(null);
			setError(null);
			form.reset();
		}
		setOpen(nextOpen);
	}

	async function run(
		kind: "preview" | "commit",
		csv: string,
	): Promise<OpeningBalanceUploadOutcome | null> {
		setPending(kind);
		setError(null);
		const action =
			kind === "preview" ? previewOpeningBalanceUploadAction : commitOpeningBalanceUploadAction;
		const result: BalanceAdjustmentActionResult<OpeningBalanceUploadOutcome> | null = await action({
			csv,
		}).catch(() => null);
		if (!alive.current) return null;
		if (!result?.success) {
			const failure = result ? balanceAdjustmentFailureOf(result) : null;
			setError(
				actionError(failure?.code ?? null, { closedMonth: failure?.details.closedMonth ?? null }),
			);
			return null;
		}
		return result.data;
	}

	function finishPending() {
		if (!alive.current) return;
		busy.current = false;
		setPending(null);
	}

	function handleFile(file: File | undefined) {
		if (!file || busy.current) return;
		busy.current = true;
		setPending("preview");
		setError(null);
		setUpload(null);
		form.setFieldValue("file", file);
		return (async () => {
			const csv = await file.text().catch(() => null);
			if (!alive.current) return;
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
			if (!alive.current) return;
			setUpload(outcome ? { csv, outcome, refused: false } : null);
		})().finally(finishPending);
	}

	function handleCommit() {
		if (upload?.outcome.status !== "ready" || busy.current) return;
		busy.current = true;
		return (async () => {
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
		})().finally(finishPending);
	}

	const outcome = upload?.outcome;
	const rows = outcome && "rows" in outcome ? outcome.rows : [];
	const errorRows = rows.filter((row) => row.errors.length > 0).length;
	const replacing = rows.filter((row) => row.replaces && row.errors.length === 0).length;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button type="button" variant="outline">
					<IconUpload aria-hidden="true" className="size-4" />
					{t("settings.employees.workBalance.upload.open", "Upload opening balances")}
				</Button>
			</DialogTrigger>
			<DialogContent
				className="overscroll-contain sm:max-w-5xl"
				showCloseButton={!pending}
				onEscapeKeyDown={(event) => {
					if (busy.current) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (busy.current) event.preventDefault();
				}}
			>
				<form
					className="grid min-w-0 gap-4"
					aria-busy={pending !== null}
					onSubmit={async (event) => {
						event.preventDefault();
						event.stopPropagation();
						if (busy.current) return;
						await form.handleSubmit();
					}}
				>
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
						<form.Field name="file">
							{(field) => (
								<TFormItem className="min-w-0 flex-1">
									<TFormLabel>
										{t("settings.employees.workBalance.upload.file", "CSV file")}
									</TFormLabel>
									<TFormControl>
										<Input
											type="file"
											accept=".csv,text/csv"
											name="file"
											onBlur={field.handleBlur}
											disabled={pending !== null}
											onChange={(event) => {
												const file = event.target.files?.[0];
												event.target.value = "";
												void handleFile(file);
											}}
										/>
									</TFormControl>
								</TFormItem>
							)}
						</form.Field>
						<Button type="button" variant="ghost" onClick={downloadTemplate}>
							<IconDownload aria-hidden="true" className="size-4" />
							{t("settings.employees.workBalance.upload.template", "Download template")}
						</Button>
					</div>
					{error ? (
						<Alert variant="destructive">
							<AlertTitle>
								{t("settings.employees.workBalance.upload.refusedTitle", "Nothing was saved")}
							</AlertTitle>
							<AlertDescription>{error}</AlertDescription>
							{!upload ? (
								<Button
									type="button"
									variant="outline"
									disabled={pending !== null}
									onClick={() => void handleFile(form.getFieldValue("file") ?? undefined)}
								>
									{t("common.retry", "Retry")}
								</Button>
							) : null}
						</Alert>
					) : null}

					{pending === "preview" ? (
						<p className="flex items-center gap-2 text-muted-foreground text-sm" role="status">
							<IconLoader2
								aria-hidden="true"
								className="size-4 animate-spin motion-reduce:animate-none"
							/>
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
						<Button type="submit" disabled={outcome?.status !== "ready" || pending !== null}>
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
				</form>
			</DialogContent>
		</Dialog>
	);
}
