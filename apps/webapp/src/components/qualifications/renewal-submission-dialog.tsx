"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { type ChangeEvent, useState } from "react";
import { toast } from "sonner";

import { submitMyQualificationRenewal } from "@/app/[locale]/(app)/my-qualifications/actions";
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
import { Textarea } from "@/components/ui/textarea";
import { useQualificationEvidenceFileUpload } from "@/hooks/use-qualification-evidence-file-upload";
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";
import { queryKeys } from "@/lib/query/keys";

interface RenewalSubmissionDialogProps {
	qualification: EmployeeSkillWithDetails | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface RenewalSubmissionFormValues {
	requestedIssuedAt: string;
	requestedExpiresAt: string;
	requestedIssuer: string;
	requestedCertificateNumber: string;
	notes: string;
}

export function RenewalSubmissionDialog({
	qualification,
	open,
	onOpenChange,
}: RenewalSubmissionDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [uploadedEvidence, setUploadedEvidence] = useState<Array<{ id: string; fileName: string }>>(
		[],
	);
	const [evidenceError, setEvidenceError] = useState<string | null>(null);
	const evidenceRequiredMessage = t(
		"qualifications.renewalEvidenceRequired",
		"Upload at least one evidence file before submitting.",
	);

	const evidenceUpload = useQualificationEvidenceFileUpload({
		employeeSkillId: qualification?.id ?? null,
		onSuccess: (evidence) => {
			setUploadedEvidence((current) => [
				...current.filter((item) => item.id !== evidence.id),
				{ id: evidence.id, fileName: evidence.fileName },
			]);
			setEvidenceError(null);
			toast.success(t("qualifications.evidenceUploaded", "Evidence file uploaded"));
		},
		onError: (error) => {
			toast.error(
				error.message || t("qualifications.evidenceUploadFailed", "Evidence upload failed"),
			);
		},
	});

	const submitMutation = useMutation({
		mutationFn: async (data: RenewalSubmissionFormValues) => {
			if (!qualification) {
				throw new Error(t("qualifications.qualificationRequired", "Qualification is required"));
			}
			const requestedIssuer = data.requestedIssuer.trim();
			const requestedCertificateNumber = data.requestedCertificateNumber.trim();
			const notes = data.notes.trim();

			const result = await submitMyQualificationRenewal({
				employeeSkillId: qualification.id,
				evidenceIds: uploadedEvidence.map((evidence) => evidence.id),
				requestedIssuedAt: data.requestedIssuedAt
					? DateTime.fromISO(data.requestedIssuedAt, { zone: "utc" }).toJSDate()
					: undefined,
				requestedExpiresAt: data.requestedExpiresAt
					? DateTime.fromISO(data.requestedExpiresAt, { zone: "utc" }).toJSDate()
					: undefined,
				requestedIssuer: requestedIssuer || undefined,
				requestedCertificateNumber: requestedCertificateNumber || undefined,
				notes: notes || undefined,
			});

			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.qualifications.my() });
			toast.success(t("qualifications.renewalSubmitted", "Renewal evidence submitted"));
			closeDialog();
		},
		onError: (error) => {
			toast.error(
				error.message ||
					t("qualifications.renewalSubmissionFailed", "Failed to submit renewal evidence"),
			);
		},
	});

	const form = useForm({
		defaultValues: {
			requestedIssuedAt: "",
			requestedExpiresAt: "",
			requestedIssuer: "",
			requestedCertificateNumber: "",
			notes: "",
		} satisfies RenewalSubmissionFormValues,
		onSubmit: async ({ value }) => {
			if (!qualification) return;
			if (uploadedEvidence.length === 0) {
				setEvidenceError(evidenceRequiredMessage);
				return;
			}

			await submitMutation.mutateAsync(value);
		},
	});

	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen) resetDialogState();
		onOpenChange(newOpen);
	};

	const closeDialog = () => {
		resetDialogState();
		onOpenChange(false);
	};

	const resetDialogState = () => {
		form.reset();
		setUploadedEvidence([]);
		setEvidenceError(null);
		evidenceUpload.reset();
	};

	const handleEvidenceFileChange = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;

		setEvidenceError(null);
		evidenceUpload.addFile(file);
		event.target.value = "";
	};

	const isUploadingEvidence = evidenceUpload.isUploading || evidenceUpload.isProcessing;

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[480px]">
				<DialogHeader>
					<DialogTitle>
						{t("qualifications.submitRenewalEvidence", "Submit renewal evidence")}
					</DialogTitle>
					<DialogDescription>
						{qualification
							? t(
									"qualifications.renewalDescriptionForSkill",
									"Provide renewal evidence for {{skillName}}.",
									{ skillName: qualification.skill.name },
								)
							: t(
									"qualifications.renewalDescription",
									"Provide renewal evidence for this qualification.",
								)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
				>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="renewal-evidence-file">
								{t("qualifications.uploadEvidenceFile", "Upload evidence file")}
							</Label>
							<Input
								id="renewal-evidence-file"
								name="evidenceFile"
								type="file"
								autoComplete="off"
								accept="application/pdf,image/jpeg,image/png,image/webp"
								disabled={!qualification || isUploadingEvidence || submitMutation.isPending}
								onChange={handleEvidenceFileChange}
							/>
							<p className="text-xs text-muted-foreground">
								{t(
									"qualifications.evidenceUploadHelp",
									"Upload a PDF or image of your renewed certificate, license, or training record.",
								)}
							</p>
							{isUploadingEvidence ? (
								<p className="text-xs text-muted-foreground" aria-live="polite">
									{t("qualifications.uploadingEvidence", "Uploading evidence…")}
									{evidenceUpload.progress > 0 ? ` ${evidenceUpload.progress}%` : null}
								</p>
							) : null}
							{uploadedEvidence.length > 0 ? (
								<ul
									className="space-y-1 text-sm"
									aria-label={t("qualifications.uploadedEvidence", "Uploaded evidence")}
								>
									{uploadedEvidence.map((evidence) => (
										<li
											key={evidence.id}
											className="break-words rounded-md border bg-muted/40 px-3 py-2"
										>
											{evidence.fileName}
										</li>
									))}
								</ul>
							) : null}
							{evidenceError ? (
								<p className="text-sm text-destructive" aria-live="polite">
									{evidenceError}
								</p>
							) : null}
						</div>

						<form.Field
							name="requestedExpiresAt"
							validators={{
								onSubmit: ({ value }) =>
									qualification?.skill.requiresExpiry && !value
										? t(
												"qualifications.expiryRequired",
												"New expiry date is required for this qualification",
											)
										: undefined,
							}}
						>
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="renewal-new-expiry">
										{t("qualifications.newExpiryDate", "New expiry date")}
									</Label>
									<Input
										id="renewal-new-expiry"
										name="requestedExpiresAt"
										type="date"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										min={DateTime.now().toISODate() ?? undefined}
									/>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive" aria-live="polite">
											{field.state.meta.errors[0]}
										</p>
									)}
								</div>
							)}
						</form.Field>

						<form.Field name="requestedIssuedAt">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="renewal-issue-date">
										{t("qualifications.issueDate", "Issue date")}
									</Label>
									<Input
										id="renewal-issue-date"
										name="requestedIssuedAt"
										type="date"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="requestedIssuer">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="renewal-issuer">{t("qualifications.issuer", "Issuer")}</Label>
									<Input
										id="renewal-issuer"
										name="requestedIssuer"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder={t("qualifications.issuerPlaceholder", "e.g., Safety Council…")}
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="requestedCertificateNumber">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="renewal-certificate-number">
										{t("qualifications.certificateNumber", "Certificate number")}
									</Label>
									<Input
										id="renewal-certificate-number"
										name="requestedCertificateNumber"
										autoComplete="off"
										spellCheck={false}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder={t("qualifications.certificatePlaceholder", "e.g., CERT-12345…")}
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="notes">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="renewal-notes">{t("qualifications.notes", "Notes")}</Label>
									<Textarea
										id="renewal-notes"
										name="notes"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder={t("qualifications.notesPlaceholder", "Add context for reviewers…")}
										rows={3}
									/>
								</div>
							)}
						</form.Field>
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={closeDialog}
							disabled={submitMutation.isPending || isUploadingEvidence}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button
							type="submit"
							disabled={submitMutation.isPending || isUploadingEvidence || !qualification}
						>
							{submitMutation.isPending && (
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
							)}
							{submitMutation.isPending
								? t("qualifications.submittingRenewal", "Submitting renewal…")
								: t("qualifications.submitRenewal", "Submit renewal")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
