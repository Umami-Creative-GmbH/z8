"use client";

import { IconLoader2, IconUsersPlus } from "@tabler/icons-react";
import { useForm, useStore } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { createDocumentRequestsInBulkAction } from "@/app/[locale]/(app)/personnel-files/document-request-actions";
import { EmployeeMultiSelect } from "@/components/employee-select";
import {
	TeamSwitches,
	toSelectableEmployee,
} from "@/components/settings/access-grants/grant-editor";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import {
	DOCUMENT_REQUEST_CATEGORIES,
	DOCUMENT_REQUEST_TEXT_MAX_LENGTH,
	DOCUMENT_REQUEST_TITLE_MAX_LENGTH,
	type DocumentRequestBulkSummary,
	type DocumentRequestCategory,
} from "@/lib/personnel-file/document-request.types";
import type { DocumentRequestRecipientOptions } from "@/lib/personnel-file/document-request-overview";
import { useRouter } from "@/navigation";
import { usePersonnelFileLabels } from "./document-labels";
import { useDocumentRequestErrorMessage } from "./document-request-labels";

interface BulkDocumentRequestValues {
	category: DocumentRequestCategory;
	teamIds: string[];
	employeeIds: string[];
	title: string;
	note: string;
	deadline: string;
}

/**
 * Asks several employees and teams for the same document at once (#1407):
 * one request per employee, same category, title, note and deadline, never a
 * renewed document. The server re-checks every employee and skips whom the
 * officer does not cover, the officer themself, former employees and anyone
 * with an identical active request; the dialog then shows the counts.
 */
export function BulkDocumentRequestsDialog({
	open,
	onOpenChange,
	options,
	today,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The employees and teams offered per category (the server re-checks them). */
	options: DocumentRequestRecipientOptions;
	/** The organization's today: the earliest deadline. */
	today: string;
	onCreated: () => void;
}) {
	const { t } = useTranslate();
	const labels = usePersonnelFileLabels();
	const errorMessage = useDocumentRequestErrorMessage();
	const [summary, setSummary] = useState<DocumentRequestBulkSummary | null>(null);
	const categories = DOCUMENT_REQUEST_CATEGORIES.filter(
		(category) => options[category].employees.length > 0 || options[category].teams.length > 0,
	);
	const defaultValues: BulkDocumentRequestValues = {
		category: categories[0] ?? "certificate",
		teamIds: [],
		employeeIds: [],
		title: "",
		note: "",
		deadline: "",
	};
	const required = (label: string) =>
		t("settings.personnelFiles.form.required", "{label} is required", { label });

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			const result = await createDocumentRequestsInBulkAction({
				category: value.category,
				teamIds: value.teamIds,
				employeeIds: value.employeeIds,
				title: value.title,
				note: value.note,
				deadline: value.deadline,
			});
			if (!result.success) {
				toast.error(errorMessage(result));
				return;
			}
			setSummary(result.data);
			onCreated();
		},
	});
	const category = useStore(form.store, (state) => state.values.category);
	const offered = options[category];

	function close() {
		form.reset(defaultValues);
		setSummary(null);
		onOpenChange(false);
	}

	function changeCategory(next: DocumentRequestCategory) {
		// Keep only the selections the new category still offers.
		const teamIds = new Set(options[next].teams.map((team) => team.id));
		const employeeIds = new Set(options[next].employees.map((person) => person.id));
		form.setFieldValue("category", next);
		form.setFieldValue("teamIds", (current) => current.filter((id) => teamIds.has(id)));
		form.setFieldValue("employeeIds", (current) => current.filter((id) => employeeIds.has(id)));
	}

	return (
		<ActionPanel open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
			<ActionPanelContent>
				{summary ? (
					<div className="flex min-h-0 flex-1 flex-col">
						<ActionPanelHeader>
							<ActionPanelTitle>
								{t("settings.personnelFiles.requests.bulk.doneTitle", "Documents requested")}
							</ActionPanelTitle>
						</ActionPanelHeader>
						<ActionPanelBody>
							<BulkSummary summary={summary} />
						</ActionPanelBody>
						<ActionPanelFooter>
							<Button type="button" onClick={close}>
								{t("settings.personnelFiles.requests.bulk.close", "Close")}
							</Button>
						</ActionPanelFooter>
					</div>
				) : (
					<form
						className="flex min-h-0 flex-1 flex-col"
						action={() => {
							void form.handleSubmit();
						}}
						onSubmit={(event) => {
							event.stopPropagation();
						}}
					>
						<ActionPanelHeader>
							<ActionPanelTitle>
								{t(
									"settings.personnelFiles.requests.bulk.title",
									"Request a document from several employees",
								)}
							</ActionPanelTitle>
							<ActionPanelDescription>
								{t(
									"settings.personnelFiles.requests.bulk.description",
									"Each employee gets their own request and is notified. Employees you do not cover, former employees and anyone who already has an open request with this title are skipped.",
								)}
							</ActionPanelDescription>
						</ActionPanelHeader>
						<ActionPanelBody className="space-y-5">
							{categories.length > 1 ? (
								<form.Field name="category">
									{(field) => (
										<TFormItem>
											<TFormLabel required>
												{t("settings.personnelFiles.form.category", "Category")}
											</TFormLabel>
											<Select
												value={field.state.value}
												onValueChange={(value) => changeCategory(value as DocumentRequestCategory)}
											>
												<TFormControl>
													<SelectTrigger className="w-full" onBlur={field.handleBlur}>
														<SelectValue />
													</SelectTrigger>
												</TFormControl>
												<SelectContent>
													{categories.map((option) => (
														<SelectItem key={option} value={option}>
															{labels.categories[option]}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</TFormItem>
									)}
								</form.Field>
							) : null}
							<form.Field name="teamIds">
								{(field) => (
									<fieldset className="space-y-3">
										<legend className="text-sm font-medium">
											{t("settings.personnelFiles.requests.bulk.teams", "Teams")}
										</legend>
										<p className="text-muted-foreground text-sm">
											{t(
												"settings.personnelFiles.requests.bulk.teamsHint",
												"Everyone currently in the team, as far as you cover them.",
											)}
										</p>
										{offered.teams.length === 0 ? (
											<p className="text-muted-foreground text-sm">
												{t(
													"settings.personnelFiles.requests.bulk.noTeams",
													"No teams to choose from.",
												)}
											</p>
										) : (
											<TeamSwitches
												teams={offered.teams}
												teamIds={field.state.value}
												onTeamIdsChange={(teamIds) => field.handleChange(teamIds)}
												disabled={false}
												testIdPrefix="bulk-document-request-team"
											/>
										)}
									</fieldset>
								)}
							</form.Field>
							<form.Field
								name="employeeIds"
								validators={{
									onSubmit: ({ value, fieldApi }) =>
										value.length > 0 || fieldApi.form.getFieldValue("teamIds").length > 0
											? undefined
											: t(
													"settings.personnelFiles.requests.error.noRecipients",
													"Choose at least one employee or team.",
												),
								}}
							>
								{(field) => (
									<TFormItem>
										<EmployeeMultiSelect
											label={t("settings.personnelFiles.requests.bulk.employees", "Employees")}
											placeholder={t(
												"settings.personnelFiles.requests.bulk.selectEmployees",
												"Select employees",
											)}
											value={field.state.value}
											onChange={(employeeIds) => field.handleChange(employeeIds)}
											employees={offered.employees.map((person) =>
												toSelectableEmployee({ ...person, email: "" }, { isActive: true }),
											)}
										/>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							<form.Field
								name="title"
								validators={{
									onSubmit: ({ value }) =>
										value.trim()
											? undefined
											: required(t("settings.personnelFiles.form.title", "Title")),
								}}
							>
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)} required>
											{t("settings.personnelFiles.form.title", "Title")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<Input
												value={field.state.value}
												maxLength={DOCUMENT_REQUEST_TITLE_MAX_LENGTH}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
										<TFormDescription>
											{t(
												"settings.personnelFiles.requests.create.titleHint",
												"What the employee should upload, such as a renewed first aid certificate.",
											)}
										</TFormDescription>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							<form.Field name="note">
								{(field) => (
									<TFormItem>
										<TFormLabel>
											{t("settings.personnelFiles.requests.create.note", "Note (optional)")}
										</TFormLabel>
										<TFormControl>
											<Textarea
												value={field.state.value}
												maxLength={DOCUMENT_REQUEST_TEXT_MAX_LENGTH}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
									</TFormItem>
								)}
							</form.Field>
							<form.Field
								name="deadline"
								validators={{
									onSubmit: ({ value }) =>
										value
											? undefined
											: required(t("settings.personnelFiles.requests.create.deadline", "Deadline")),
								}}
							>
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={fieldHasError(field)} required>
											{t("settings.personnelFiles.requests.create.deadline", "Deadline")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<DatePicker
												value={field.state.value}
												onChange={(value) => field.handleChange(value)}
												min={today}
												required
											/>
										</TFormControl>
										<TFormDescription>
											{t(
												"settings.personnelFiles.requests.create.deadlineHint",
												"The day by which the employee should submit. After it, the request is overdue.",
											)}
										</TFormDescription>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						</ActionPanelBody>
						<ActionPanelFooter>
							<Button type="button" variant="outline" onClick={close}>
								{t("common.cancel", "Cancel")}
							</Button>
							<form.Subscribe selector={(state) => state.isSubmitting}>
								{(isSubmitting) => (
									<Button type="submit" disabled={isSubmitting}>
										{isSubmitting ? (
											<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
										) : null}
										{t("settings.personnelFiles.requests.create.submit", "Request")}
									</Button>
								)}
							</form.Subscribe>
						</ActionPanelFooter>
					</form>
				)}
			</ActionPanelContent>
		</ActionPanel>
	);
}

/** The page header's "Request from several" button and its dialog (#1407). */
export function BulkDocumentRequestsButton({
	options,
	today,
}: {
	options: DocumentRequestRecipientOptions;
	today: string;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button type="button" onClick={() => setOpen(true)}>
				<IconUsersPlus aria-hidden="true" className="size-4" />
				{t("settings.personnelFiles.requests.bulk.open", "Request from several")}
			</Button>
			<BulkDocumentRequestsDialog
				open={open}
				onOpenChange={setOpen}
				options={options}
				today={today}
				onCreated={() => router.refresh()}
			/>
		</>
	);
}

/** How many requests a bulk create made, and whom it skipped and why. */
function BulkSummary({ summary }: { summary: DocumentRequestBulkSummary }) {
	const { t } = useTranslate();
	const { skippedBy } = summary;
	const reasons = [
		{
			key: "not_covered",
			count: skippedBy.not_covered,
			text: t(
				"settings.personnelFiles.requests.bulk.skippedNotCovered",
				"{count} not covered by your access",
				{ count: skippedBy.not_covered },
			),
		},
		{
			key: "own_file",
			count: skippedBy.own_file,
			// At most one: the officer's own file.
			text: t("settings.personnelFiles.requests.bulk.skippedOwnFile", "Your own file"),
		},
		{
			key: "former_employee",
			count: skippedBy.former_employee,
			text: t(
				"settings.personnelFiles.requests.bulk.skippedFormer",
				"{count, plural, one {# former employee} other {# former employees}}",
				{ count: skippedBy.former_employee },
			),
		},
		{
			key: "already_requested",
			count: skippedBy.already_requested,
			text: t(
				"settings.personnelFiles.requests.bulk.skippedAlreadyRequested",
				"{count, plural, one {# already has an open request with this title} other {# already have an open request with this title}}",
				{ count: skippedBy.already_requested },
			),
		},
	].filter((reason) => reason.count > 0);

	return (
		<div className="space-y-3 text-sm" role="status">
			<p className="font-medium">
				{t(
					"settings.personnelFiles.requests.bulk.created",
					"{count, plural, =0 {No document requests created.} one {# document request created.} other {# document requests created.}}",
					{ count: summary.created },
				)}
			</p>
			{summary.skipped > 0 ? (
				<div className="space-y-1">
					<p>
						{t(
							"settings.personnelFiles.requests.bulk.skipped",
							"{count, plural, one {# employee skipped:} other {# employees skipped:}}",
							{ count: summary.skipped },
						)}
					</p>
					<ul className="list-disc space-y-1 pl-5 text-muted-foreground">
						{reasons.map((reason) => (
							<li key={reason.key}>{reason.text}</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
}
