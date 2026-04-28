"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
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
import type { EmployeeSkillWithDetails } from "@/lib/effect/services/skill.service";
import { queryKeys } from "@/lib/query/keys";

interface RenewalSubmissionDialogProps {
	qualification: EmployeeSkillWithDetails | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface RenewalSubmissionFormValues {
	evidenceIds: string;
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
	const queryClient = useQueryClient();

	const submitMutation = useMutation({
		mutationFn: async (data: RenewalSubmissionFormValues) => {
			if (!qualification) throw new Error("Qualification is required");
			const requestedIssuer = data.requestedIssuer.trim();
			const requestedCertificateNumber = data.requestedCertificateNumber.trim();
			const notes = data.notes.trim();

			const evidenceIds = data.evidenceIds.split(",").flatMap((id) => {
				const trimmed = id.trim();
				return trimmed ? [trimmed] : [];
			});

			const result = await submitMyQualificationRenewal({
				employeeSkillId: qualification.id,
				evidenceIds,
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
			toast.success("Renewal evidence submitted");
			closeDialog();
		},
		onError: (error) => {
			toast.error(error.message || "Failed to submit renewal evidence");
		},
	});

	const form = useForm({
		defaultValues: {
			evidenceIds: "",
			requestedIssuedAt: "",
			requestedExpiresAt: "",
			requestedIssuer: "",
			requestedCertificateNumber: "",
			notes: "",
		} satisfies RenewalSubmissionFormValues,
		onSubmit: async ({ value }) => {
			if (!qualification) return;
			await submitMutation.mutateAsync(value);
		},
	});

	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen) form.reset();
		onOpenChange(newOpen);
	};

	const closeDialog = () => {
		form.reset();
		onOpenChange(false);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-[480px]">
				<DialogHeader>
					<DialogTitle>Submit renewal evidence</DialogTitle>
					<DialogDescription>
						{qualification
							? `Provide renewal evidence for ${qualification.skill.name}.`
							: "Provide renewal evidence for this qualification."}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
				>
					<div className="grid gap-4 py-4">
						<form.Field
							name="evidenceIds"
							validators={{
								onSubmit: ({ value }) =>
									value
										.split(",")
										.map((id) => id.trim())
										.some(Boolean)
										? undefined
										: "At least one evidence ID is required",
							}}
						>
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="renewal-evidence-ids">Evidence IDs</Label>
									<Input
										id="renewal-evidence-ids"
										name="evidenceIds"
										autoComplete="off"
										spellCheck={false}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder="evidence-id-1, evidence-id-2…"
									/>
									<p className="text-xs text-muted-foreground">
										Separate multiple evidence IDs with commas.
									</p>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive" aria-live="polite">
											{field.state.meta.errors[0]}
										</p>
									)}
								</div>
							)}
						</form.Field>

						<form.Field
							name="requestedExpiresAt"
							validators={{
								onSubmit: ({ value }) =>
									qualification?.skill.requiresExpiry && !value
										? "New expiry date is required for this qualification"
										: undefined,
							}}
						>
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="renewal-new-expiry">New expiry date</Label>
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
									<Label htmlFor="renewal-issue-date">Issue date</Label>
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
									<Label htmlFor="renewal-issuer">Issuer</Label>
									<Input
										id="renewal-issuer"
										name="requestedIssuer"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder="e.g., Safety Council…"
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="requestedCertificateNumber">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="renewal-certificate-number">Certificate number</Label>
									<Input
										id="renewal-certificate-number"
										name="requestedCertificateNumber"
										autoComplete="off"
										spellCheck={false}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder="e.g., CERT-12345…"
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="notes">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="renewal-notes">Notes</Label>
									<Textarea
										id="renewal-notes"
										name="notes"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder="Add context for reviewers…"
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
							disabled={submitMutation.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={submitMutation.isPending || !qualification}>
							{submitMutation.isPending && (
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
							)}
							{submitMutation.isPending ? "Submitting renewal…" : "Submit renewal"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
