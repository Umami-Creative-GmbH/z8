"use client";

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
	requestedExpiresAt: string;
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

			const evidenceIds = data.evidenceIds
				.split(",")
				.map((id) => id.trim())
				.filter(Boolean);

			const result = await submitMyQualificationRenewal({
				employeeSkillId: qualification.id,
				evidenceIds,
				requestedExpiresAt: data.requestedExpiresAt
					? DateTime.fromISO(data.requestedExpiresAt, { zone: "utc" }).toJSDate()
					: undefined,
				notes: data.notes || undefined,
			});

			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.qualifications.my() });
			toast.success("Renewal evidence submitted");
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(error.message || "Failed to submit renewal evidence");
		},
	});

	const form = useForm({
		defaultValues: {
			evidenceIds: "",
			requestedExpiresAt: "",
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
						<form.Field name="evidenceIds">
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
								</div>
							)}
						</form.Field>

						<form.Field name="requestedExpiresAt">
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
							onClick={() => onOpenChange(false)}
							disabled={submitMutation.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={submitMutation.isPending || !qualification}>
							Submit renewal
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
