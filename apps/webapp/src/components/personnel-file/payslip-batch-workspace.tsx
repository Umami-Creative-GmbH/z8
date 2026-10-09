"use client";

import {
	IconAlertTriangle,
	IconCircleCheck,
	IconFileZip,
	IconLoader2,
	IconRefresh,
	IconUpload,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	confirmPayslipBatchAction,
	getPayslipBatchAction,
	type PayslipBatchConfirmation,
	type PayslipBatchFileView,
	type PayslipBatchPreview,
	updatePayslipBatchFileAction,
} from "@/app/[locale]/(app)/personnel-files/payslip-batches/actions";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Skeleton } from "@/components/ui/skeleton";
import { payPeriodCode } from "@/lib/personnel-file/payslip-batch.types";
import { queryKeys } from "@/lib/query/keys";
import { formatPayPeriod, usePersonnelFileLabels } from "./document-labels";
import { collectPayslipFiles } from "./payslip-batch-files";
import { usePayslipBatchUpload } from "./use-payslip-batch-upload";

/**
 * A payslip batch (#868): add PDF files or one ZIP, review how each file was
 * matched to an employee by personnel number, assign or drop what did not
 * match, then confirm. Nothing is saved to personnel files before that.
 * Failed files can be retried after confirmation.
 */
export function PayslipBatchWorkspace({ batchId }: { batchId: string }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const queryKey = queryKeys.personnelFile.payslipBatch(batchId);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [result, setResult] = useState<PayslipBatchConfirmation | null>(null);

	const query = useQuery({
		queryKey,
		queryFn: async () => {
			const loaded = await getPayslipBatchAction({ batchId });
			if (!loaded.success) throw new Error(loaded.error);
			return loaded.data;
		},
	});

	function refresh() {
		void queryClient.invalidateQueries({ queryKey });
	}

	async function confirm() {
		setConfirming(true);
		await (async () => {
			const confirmed = await confirmPayslipBatchAction({ batchId });
			if (!confirmed.success) {
				toast.error(confirmed.error);
				return;
			}
			setResult(confirmed.data);
			if (confirmed.data.failed.length === 0) {
				toast.success(
					t("settings.personnelFiles.batch.confirmed", "{count} payslips saved", {
						count: confirmed.data.created.length,
					}),
				);
			} else {
				toast.error(
					t(
						"settings.personnelFiles.batch.partlyFailed",
						"{count} files could not be saved. You can retry them.",
						{ count: confirmed.data.failed.length },
					),
				);
			}
		})().finally(() => {
			setConfirming(false);
			setConfirmOpen(false);
			refresh();
		});
	}

	if (query.isPending) {
		return (
			<div className="space-y-3" aria-busy="true">
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	}
	if (query.isError) {
		return (
			<p role="alert" className="text-sm text-destructive">
				{t("settings.personnelFiles.batch.loadFailed", "The payslip batch could not be loaded.")}
			</p>
		);
	}

	const preview = query.data;
	const open = preview.batch.status === "open";
	const pendingFiles = preview.files.filter((file) => file.state !== "created");
	const toSave = pendingFiles.filter(
		(file) => file.included && file.employeeId !== null && file.state !== "expired",
	);
	const unresolved = pendingFiles.filter((file) => file.included && file.employeeId === null);
	const retryable = preview.files.filter((file) => file.state === "failed" && file.included);

	return (
		<div className="flex flex-col gap-6">
			<BatchSummary preview={preview} />
			{open ? <AddFilesCard batchId={batchId} preview={preview} onStaged={refresh} /> : null}
			{result ? <ConfirmationResult result={result} /> : null}
			<FileList preview={preview} onChanged={refresh} />
			{pendingFiles.length > 0 ? (
				<BatchSaveActions
					unresolved={unresolved}
					t={t}
					open={open}
					toSave={toSave}
					confirming={confirming}
					setConfirmOpen={setConfirmOpen}
					retryable={retryable}
					confirm={confirm}
				/>
			) : null}

			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.personnelFiles.batch.confirmTitle", "Save {count} payslips?", {
								count: toSave.length,
							})}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{preview.batch.visibility === "shared"
								? t(
										"settings.personnelFiles.batch.confirmShared",
										"Each file is saved to the personnel file of its employee. Employees see their payslips under My Documents and get one notification for this batch.",
									)
								: t(
										"settings.personnelFiles.batch.confirmHrOnly",
										"Each file is saved to the personnel file of its employee as an HR-only document. Employees are not notified.",
									)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel type="button">{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<Button type="button" disabled={confirming} onClick={() => void confirm()}>
							{confirming ? (
								<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
							) : null}
							{t("settings.personnelFiles.batch.confirmAction", "Save payslips")}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function BatchSummary({ preview }: { preview: PayslipBatchPreview }) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const labels = usePersonnelFileLabels();
	const files = preview.files;
	const count = (predicate: (file: PayslipBatchFileView) => boolean) =>
		files.filter(predicate).length;
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					{t("settings.personnelFiles.batch.titleFor", "Payslips for {payPeriod}", {
						payPeriod: formatPayPeriod(preview.batch.payPeriod, locale),
					})}
					<Badge variant="outline">{labels.visibilities[preview.batch.visibility]}</Badge>
					{preview.batch.status === "confirmed" ? (
						<Badge variant="secondary">
							{t("settings.personnelFiles.batch.statusConfirmed", "Confirmed")}
						</Badge>
					) : null}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.personnelFiles.batch.counts",
						"{files} files: {matched} matched, {attention} need attention, {dropped} dropped",
						{
							files: files.length,
							matched: count((file) => file.included && file.employeeId !== null),
							attention: count((file) => file.included && file.employeeId === null),
							dropped: count((file) => !file.included),
						},
					)}
				</CardDescription>
			</CardHeader>
		</Card>
	);
}

function AddFilesCard({
	batchId,
	preview,
	onStaged,
}: {
	batchId: string;
	preview: PayslipBatchPreview;
	onStaged: () => void;
}) {
	const { t } = useTranslate();
	const inputRef = useRef<HTMLInputElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [unpacking, setUnpacking] = useState(false);
	const upload = usePayslipBatchUpload({ batchId, onStaged });
	const { progress } = upload;

	const errors = {
		unsupported: t(
			"settings.personnelFiles.batch.errorUnsupported",
			"Add PDF files, or one ZIP that holds them.",
		),
		too_many: t(
			"settings.personnelFiles.batch.errorTooMany",
			"A payslip batch holds at most 500 files.",
		),
		one_zip: t(
			"settings.personnelFiles.batch.errorOneZip",
			"Add one ZIP on its own, without other files.",
		),
		zip_too_large: t(
			"settings.personnelFiles.batch.errorZipTooLarge",
			"The ZIP can be at most 500 MB.",
		),
		empty: t("settings.personnelFiles.batch.errorEmpty", "No PDF files were found."),
		unreadable: t("settings.personnelFiles.batch.errorUnreadable", "The ZIP could not be read."),
	} as const;

	async function handleFiles(list: FileList | null) {
		setError(null);
		const selected = list ? [...list] : [];
		if (inputRef.current) inputRef.current.value = "";
		if (selected.length === 0) return;
		setUnpacking(true);
		await (async () => {
			const collected = await collectPayslipFiles(selected, {
				alreadyStaged: preview.files.filter((file) => file.state !== "expired").length,
			});
			if (!collected.ok) {
				setError(errors[collected.error]);
				return;
			}
			if (collected.skipped > 0) {
				toast.info(
					t(
						"settings.personnelFiles.batch.skipped",
						"{count} files in the ZIP were not PDFs and were left out.",
						{ count: collected.skipped },
					),
				);
			}
			upload.addFiles(collected.files);
		})().finally(() => {
			setUnpacking(false);
		});
	}

	const done = progress.staged + progress.failed.length;
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.personnelFiles.batch.addTitle", "Add payslips")}</CardTitle>
				<CardDescription>
					{t(
						"settings.personnelFiles.batch.addDescription",
						"Add up to 500 PDF files of up to 20 MB each, or one ZIP of up to 500 MB. Files are matched to employees by the personnel number in their file name.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="grid gap-2">
					<Label htmlFor="payslip-batch-files" className="sr-only">
						{t("settings.personnelFiles.batch.files", "Payslip files")}
					</Label>
					<Input
						ref={inputRef}
						id="payslip-batch-files"
						type="file"
						multiple
						accept="application/pdf,.pdf,application/zip,.zip"
						disabled={upload.isUploading || unpacking}
						aria-invalid={error ? true : undefined}
						onChange={(event) => void handleFiles(event.target.files)}
					/>
					<p className="flex items-center gap-1.5 text-sm text-muted-foreground">
						<IconFileZip aria-hidden="true" className="size-4" />
						{t(
							"settings.personnelFiles.batch.zipHint",
							"A ZIP is unpacked in your browser; only its PDF files are uploaded.",
						)}
					</p>
					{error ? (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					) : null}
				</div>
				{unpacking ? (
					<p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
						{t("settings.personnelFiles.batch.unpacking", "Unpacking the ZIP")}
					</p>
				) : null}
				{progress.total > 0 ? (
					<div className="space-y-2" role="status">
						<Progress
							value={Math.round((done / progress.total) * 100)}
							aria-label={t("settings.personnelFiles.batch.progress", "Upload progress")}
						/>
						<p className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
							<IconUpload aria-hidden="true" className="size-4" />
							{t("settings.personnelFiles.batch.progressText", "{done} of {total} files uploaded", {
								done,
								total: progress.total,
							})}
						</p>
					</div>
				) : null}
				{progress.failed.length > 0 ? (
					<ul className="space-y-1 text-sm text-destructive" role="alert">
						{progress.failed.map((failure) => (
							<li key={failure.id}>
								{t("settings.personnelFiles.batch.uploadFailed", "{fileName}: {error}", {
									fileName: failure.fileName,
									error: failure.error,
								})}
							</li>
						))}
					</ul>
				) : null}
			</CardContent>
		</Card>
	);
}

function ConfirmationResult({ result }: { result: PayslipBatchConfirmation }) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.personnelFiles.batch.resultTitle", "Result")}</CardTitle>
				<CardDescription>
					{t(
						"settings.personnelFiles.batch.resultCounts",
						"{created} payslips saved, {failed} failed",
						{ created: result.created.length, failed: result.failed.length },
					)}
				</CardDescription>
			</CardHeader>
		</Card>
	);
}

function useFailureLabels() {
	const { t } = useTranslate();
	return {
		expired: t(
			"settings.personnelFiles.batch.failureExpired",
			"The staged file expired. Upload it again in a new batch.",
		),
		out_of_scope: t(
			"settings.personnelFiles.batch.failureOutOfScope",
			"You no longer manage this employee's payslips.",
		),
		error: t("settings.personnelFiles.batch.failureError", "Could not be saved. Retry it."),
	} as const;
}

function FileList({ preview, onChanged }: { preview: PayslipBatchPreview; onChanged: () => void }) {
	const { t } = useTranslate();
	if (preview.files.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("settings.personnelFiles.batch.noFiles", "No files yet.")}
			</p>
		);
	}
	return (
		<Card className="py-0">
			<CardContent className="px-0">
				<ul className="divide-y">
					{preview.files.map((file) => (
						<FileRow key={file.id} file={file} preview={preview} onChanged={onChanged} />
					))}
				</ul>
			</CardContent>
		</Card>
	);
}

function usePayslipFileRow({
	file,
	preview,
	onChanged,
}: {
	file: PayslipBatchFileView;
	preview: PayslipBatchPreview;
	onChanged: () => void;
}) {
	const { t } = useTranslate();
	const failureLabels = useFailureLabels();
	const [saving, setSaving] = useState(false);
	const editable = file.state !== "created" && file.state !== "expired";
	const byId = new Map(preview.employees.map((employee) => [employee.id, employee]));
	const optionOf = (id: string) => {
		const employee = byId.get(id);
		return {
			code: id,
			name: employee
				? employee.employeeNumber
					? `${employee.name} (${employee.employeeNumber})`
					: employee.name
				: id,
			keywords: employee?.employeeNumber ? [employee.employeeNumber] : undefined,
		};
	};
	const options = preview.employees.map((employee) => optionOf(employee.id));
	const pinned =
		file.matchKind === "ambiguous"
			? file.matchedEmployeeIds.filter((id) => byId.has(id)).map(optionOf)
			: undefined;

	async function update(change: { assignedEmployeeId?: string | null; included?: boolean }) {
		setSaving(true);
		await (async () => {
			const result = await updatePayslipBatchFileAction({
				batchId: preview.batch.id,
				fileId: file.id,
				...change,
			});
			if (!result.success) toast.error(result.error);
			onChanged();
		})().finally(() => {
			setSaving(false);
		});
	}

	const matchBadge =
		file.assignedEmployeeId !== null
			? t("settings.personnelFiles.batch.assigned", "Assigned by hand")
			: file.matchKind === "matched"
				? t("settings.personnelFiles.batch.matched", "Matched")
				: file.matchKind === "ambiguous"
					? t("settings.personnelFiles.batch.ambiguous", "Ambiguous")
					: t("settings.personnelFiles.batch.unmatched", "Unmatched");
	const needsEmployee = file.included && file.employeeId === null;

	return {
		file,
		editable,
		saving,
		update,
		t,
		needsEmployee,
		matchBadge,
		preview,
		failureLabels,
		options,
		pinned,
		optionOf,
	};
}

function FileRow({
	file,
	preview,
	onChanged,
}: {
	file: PayslipBatchFileView;
	preview: PayslipBatchPreview;
	onChanged: () => void;
}) {
	const {
		editable,
		saving,
		update,
		t,
		needsEmployee,
		matchBadge,
		failureLabels,
		options,
		pinned,
		optionOf,
	} = usePayslipFileRow({ file, preview, onChanged });
	return (
		<li className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
			<div className="flex min-w-0 flex-1 items-start gap-3">
				<Checkbox
					checked={file.included}
					disabled={!editable || saving}
					onCheckedChange={(checked) => void update({ included: checked === true })}
					aria-label={t("settings.personnelFiles.batch.include", "Include {fileName}", {
						fileName: file.fileName,
					})}
				/>
				<PayslipFileStatus
					file={file}
					needsEmployee={needsEmployee}
					matchBadge={matchBadge}
					t={t}
					preview={preview}
					failureLabels={failureLabels}
				/>
			</div>
			<div className="w-full md:w-72">
				{editable ? (
					<SearchableSelect
						options={options}
						pinnedOptions={pinned}
						value={file.employeeId ?? ""}
						onValueChange={(value) => void update({ assignedEmployeeId: value || null })}
						placeholder={t("settings.personnelFiles.batch.chooseEmployee", "Choose an employee")}
						searchPlaceholder={t(
							"settings.personnelFiles.batch.searchEmployee",
							"Search name or personnel number",
						)}
						emptyText={t("settings.personnelFiles.batch.noEmployee", "No employee found.")}
						disabled={saving || !file.included}
						aria-invalid={needsEmployee}
						aria-label={t("settings.personnelFiles.batch.employeeFor", "Employee for {fileName}", {
							fileName: file.fileName,
						})}
					/>
				) : (
					<p className="truncate text-sm text-muted-foreground">
						{file.employeeId ? optionOf(file.employeeId).name : null}
					</p>
				)}
			</div>
		</li>
	);
}

function PayslipFileStatus({
	file,
	needsEmployee,
	matchBadge,
	t,
	preview,
	failureLabels,
}: Pick<
	ReturnType<typeof usePayslipFileRow>,
	"file" | "needsEmployee" | "matchBadge" | "t" | "preview" | "failureLabels"
>) {
	return (
		<div className="min-w-0 space-y-1">
			<p className="truncate font-medium" title={file.fileName}>
				{file.fileName}
			</p>
			<div className="flex flex-wrap items-center gap-1.5">
				<Badge variant={needsEmployee ? "destructive" : "outline"}>{matchBadge}</Badge>
				{file.state === "created" ? (
					<Badge variant="secondary">
						{t("settings.personnelFiles.batch.stateCreated", "Saved")}
					</Badge>
				) : null}
				{file.state === "expired" ? (
					<Badge variant="secondary">
						{t("settings.personnelFiles.batch.stateExpired", "Expired")}
					</Badge>
				) : null}
				{file.alreadyHasPayslip && file.state !== "created" ? (
					<Badge
						variant="outline"
						className="border-amber-500/50 text-amber-700 dark:text-amber-400"
					>
						<IconAlertTriangle aria-hidden="true" />
						{t("settings.personnelFiles.batch.duplicate", "Already has a payslip for {payPeriod}", {
							payPeriod: payPeriodCode(preview.batch.payPeriod),
						})}
					</Badge>
				) : null}
			</div>
			{file.failure && file.state !== "created" ? (
				<p className="text-sm text-destructive">{failureLabels[file.failure]}</p>
			) : file.state === "expired" ? (
				<p className="text-sm text-destructive">{failureLabels.expired}</p>
			) : null}
		</div>
	);
}

function BatchSaveActions({
	unresolved,
	t,
	open,
	toSave,
	confirming,
	setConfirmOpen,
	retryable,
	confirm,
}: {
	unresolved: PayslipBatchFileView[];
	t: ReturnType<typeof useTranslate>["t"];
	open: boolean;
	toSave: PayslipBatchFileView[];
	confirming: boolean;
	setConfirmOpen: (open: boolean) => void;
	retryable: PayslipBatchFileView[];
	confirm: () => Promise<void>;
}) {
	return (
		<div className="flex flex-wrap items-center justify-end gap-3">
			{unresolved.length > 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.personnelFiles.batch.unresolvedHint",
						"Assign or drop {count} files before saving.",
						{ count: unresolved.length },
					)}
				</p>
			) : null}
			{open ? (
				<Button
					type="button"
					disabled={toSave.length === 0 || unresolved.length > 0 || confirming}
					onClick={() => setConfirmOpen(true)}
				>
					<IconCircleCheck aria-hidden="true" className="size-4" />
					{t("settings.personnelFiles.batch.save", "Save {count} payslips", {
						count: toSave.length,
					})}
				</Button>
			) : retryable.length > 0 ? (
				<Button
					type="button"
					variant="outline"
					disabled={unresolved.length > 0 || confirming}
					onClick={() => void confirm()}
				>
					{confirming ? (
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
					) : (
						<IconRefresh aria-hidden="true" className="size-4" />
					)}
					{t("settings.personnelFiles.batch.retry", "Retry {count} failed files", {
						count: retryable.length,
					})}
				</Button>
			) : null}
		</div>
	);
}
