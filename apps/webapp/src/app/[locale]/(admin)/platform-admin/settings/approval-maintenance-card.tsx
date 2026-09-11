"use client";

import { IconLoader2, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import type { DeletedApprovalRecords } from "@/lib/approvals/maintenance";
import type { ServerActionResult } from "@/lib/effect/result";
import { forceDeleteApprovalAction } from "./approval-maintenance-actions";

const APPROVAL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function deletionError(t: ReturnType<typeof useTranslate>["t"], code?: string) {
	switch (code) {
		case "UNAUTHORIZED":
			return t("admin:admin.settings.approvalMaintenance.errors.unauthorized", "Platform admin access required.");
		case "APPROVAL_NOT_FOUND":
			return t("admin:admin.settings.approvalMaintenance.errors.notFound", "Approval not found in this organization.");
		case "APPROVAL_AMBIGUOUS":
			return t("admin:admin.settings.approvalMaintenance.errors.ambiguous", "This ID exists in both approval stores. No approval was deleted.");
		case "INVALID_INPUT":
			return t("admin:admin.settings.approvalMaintenance.errors.invalidInput", "Enter an organization ID and a valid approval UUID.");
		default:
			return t("admin:admin.settings.approvalMaintenance.errors.failed", "Could not complete deletion. Check the approval ID before trying again.");
	}
}

export function ApprovalMaintenanceCard() {
	const { t } = useTranslate();
	const [result, setResult] = useState<ServerActionResult<DeletedApprovalRecords> | null>(null);
	const form = useForm({
		defaultValues: { organizationId: "", approvalId: "" },
		onSubmit: async ({ value, formApi }) => {
			setResult(null);
			try {
				const response = await forceDeleteApprovalAction(value);
				setResult(response);
				if (response.success) formApi.reset();
			} catch {
				setResult({ success: false, code: "DELETE_FAILED", error: "Deletion failed" });
			}
		},
	});
	const deletedRecords = result?.success
		? [
				...result.data.legacyRequests.map((id) => ({
					id,
					kind: "legacy",
					label: t("admin:admin.settings.approvalMaintenance.legacy", "Legacy request"),
				})),
				...result.data.workflows.map((id) => ({
					id,
					kind: "workflow",
					label: t("admin:admin.settings.approvalMaintenance.workflow", "Workflow"),
				})),
				...result.data.chains.map((id) => ({
					id,
					kind: "chain",
					label: t("admin:admin.settings.approvalMaintenance.chain", "Approval chain"),
				})),
			]
		: [];

	return (
		<Card className="lg:col-span-2">
			<CardHeader>
				<div className="flex items-start gap-3">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
						<IconTrash className="size-5 text-muted-foreground" aria-hidden="true" />
					</div>
					<div className="space-y-1">
						<CardTitle>
							{t("admin:admin.settings.approvalMaintenance.title", "Force delete approval")}
						</CardTitle>
						<CardDescription>
							{t("admin:admin.settings.approvalMaintenance.description", "Permanently remove an approval and its linked approval records. Source records and their statuses are preserved.")}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<form
				noValidate
				aria-label={t("admin:admin.settings.approvalMaintenance.title", "Force delete approval")}
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void form.handleSubmit();
				}}
			>
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(isSubmitting) => (
						<>
							<CardContent className="space-y-4">
								<fieldset disabled={isSubmitting} className="grid min-w-0 gap-4 sm:grid-cols-2">
									<form.Field
										name="organizationId"
										validators={{
											onChange: ({ value }) => value.trim()
												? undefined
												: t("admin:admin.settings.approvalMaintenance.errors.organizationRequired", "Enter an organization ID."),
										}}
									>
										{(field) => (
											<TFormItem>
												<TFormLabel required hasError={fieldHasError(field)}>
													{t("admin:admin.settings.approvalMaintenance.organizationId", "Organization ID")}
												</TFormLabel>
												<TFormControl hasError={fieldHasError(field)}>
													<Input
														name={field.name}
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(event) => {
															setResult(null);
															field.handleChange(event.target.value);
														}}
														autoComplete="off"
														autoCapitalize="none"
														spellCheck={false}
														maxLength={255}
														required
													/>
												</TFormControl>
												<TFormDescription>
													{t("admin:admin.settings.approvalMaintenance.organizationHint", "The organization that owns the approval.")}
												</TFormDescription>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>
									<form.Field
										name="approvalId"
										validators={{
											onChange: ({ value }) => APPROVAL_ID_PATTERN.test(value.trim())
												? undefined
												: t("admin:admin.settings.approvalMaintenance.errors.approvalInvalid", "Enter a valid approval UUID."),
										}}
									>
										{(field) => (
											<TFormItem>
												<TFormLabel required hasError={fieldHasError(field)}>
													{t("admin:admin.settings.approvalMaintenance.approvalId", "Approval ID")}
												</TFormLabel>
												<TFormControl hasError={fieldHasError(field)}>
													<Input
														name={field.name}
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(event) => {
															setResult(null);
															field.handleChange(event.target.value);
														}}
														autoComplete="off"
														autoCapitalize="none"
														spellCheck={false}
														className="font-mono"
														required
													/>
												</TFormControl>
												<TFormDescription>
													{t("admin:admin.settings.approvalMaintenance.approvalHint", "A legacy approval request or canonical workflow UUID.")}
												</TFormDescription>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>
								</fieldset>
								{result && !result.success && (
									<p role="alert" className="text-sm text-destructive">
										{deletionError(t, result.code)}
									</p>
								)}
								{result?.success && (
									<div role="status" className="space-y-3 rounded-lg border bg-muted/30 p-4">
										<p className="text-sm font-medium">
											{t("admin:admin.settings.approvalMaintenance.success", "Approval deleted. Removed records:")}
										</p>
										<ul className="max-h-64 space-y-2 overflow-auto text-sm">
											{deletedRecords.map((record) => (
												<li key={`${record.kind}:${record.id}`} className="flex flex-col gap-1 sm:flex-row sm:gap-3">
													<span className="text-muted-foreground">{record.label}</span>
													<code className="break-all text-xs" translate="no">{record.id}</code>
												</li>
											))}
										</ul>
									</div>
								)}
							</CardContent>
							<CardFooter className="border-t bg-muted/30 px-6 py-4">
								<Button type="submit" variant="destructive" disabled={isSubmitting}>
									{isSubmitting && <IconLoader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
									{isSubmitting
										? t("admin:admin.settings.approvalMaintenance.deleting", "Deleting…")
										: t("admin:admin.settings.approvalMaintenance.delete", "Force delete")}
								</Button>
							</CardFooter>
						</>
					)}
				</form.Subscribe>
			</form>
		</Card>
	);
}
