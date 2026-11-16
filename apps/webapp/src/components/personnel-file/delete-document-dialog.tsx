"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	deleteEmployeeDocumentAction,
	type EmployeeDocumentView,
} from "@/app/[locale]/(app)/personnel-files/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";

/** Deletes an employee document after a confirmation, with an optional reason for the audit log. */
export function DeleteDocumentDialog({
	document,
	onOpenChange,
	onDeleted,
}: {
	document: EmployeeDocumentView | null;
	onOpenChange: (open: boolean) => void;
	onDeleted: () => void;
}) {
	return (
		<DeleteDocumentTask
			key={document?.id ?? "closed"}
			document={document}
			onOpenChange={onOpenChange}
			onDeleted={onDeleted}
		/>
	);
}

function DeleteDocumentTask({
	document,
	onOpenChange,
	onDeleted,
}: {
	document: EmployeeDocumentView | null;
	onOpenChange: (open: boolean) => void;
	onDeleted: () => void;
}) {
	const { t } = useTranslate();
	const pending = useRef(false);
	const lifetime = useRef({});
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		lifetime.current = {};
		return () => {
			lifetime.current = {};
		};
	}, []);
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			if (!document || pending.current) return;
			pending.current = true;
			setWorking(true);
			setError(null);
			const task = lifetime.current;
			const result = await deleteEmployeeDocumentAction({
				documentId: document.id,
				reason: value.reason,
			}).catch(() => null);
			pending.current = false;
			setWorking(false);
			if (lifetime.current !== task) return;
			if (!result) {
				setError(
					t(
						"settings.personnelFiles.delete.failed",
						"Could not delete the document. Your reason is kept. Try again.",
					),
				);
				return;
			}
			if (!result.success) {
				setError(result.error);
				return;
			}
			toast.success(
				t("settings.personnelFiles.delete.success", "Document deleted"),
			);
			form.reset();
			onOpenChange(false);
			onDeleted();
		},
	});

	return (
		<AlertDialog
			open={document !== null}
			onOpenChange={(open) => {
				if (pending.current) return;
				if (!open) form.reset();
				onOpenChange(open);
			}}
		>
			<AlertDialogContent>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
					className="grid gap-4"
				>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.personnelFiles.delete.title", "Delete document?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.personnelFiles.delete.description",
								'"{title}" and its file are deleted for good. The deletion is recorded in the audit log.',
								{ title: document?.title ?? "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<form.Field name="reason">
						{(field) => (
							<TFormItem>
								<TFormLabel>
									{t(
										"settings.personnelFiles.delete.reason",
										"Reason (optional)",
									)}
								</TFormLabel>
								<TFormControl>
									<Textarea
										disabled={working}
										value={field.state.value}
										maxLength={1000}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
							</TFormItem>
						)}
					</form.Field>
					{error ? (
						<Alert variant="destructive">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel type="button" disabled={working}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button
									type="submit"
									variant="destructive"
									disabled={isSubmitting}
								>
									{t("settings.personnelFiles.delete.confirm", "Delete")}
								</Button>
							)}
						</form.Subscribe>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}
