"use client";

import { IconLink, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { toast } from "sonner";
import { getPersonnelFileAction } from "@/app/[locale]/(app)/personnel-files/actions";
import {
	type LinkableSickLeave,
	linkSickNoteAction,
	listSickLeaveForLinkingAction,
} from "@/app/[locale]/(app)/personnel-files/sick-note-actions";
import { useAppLocale } from "@/components/providers/app-locale-provider";
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
import { formatDateOnly } from "@/components/ui/date-picker-utils";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { TFormItem, TFormMessage } from "@/components/ui/tanstack-form";
import type { EmployeeDocumentView } from "@/lib/personnel-file/document-store";
import { formatAbsenceDateRange } from "@/lib/personnel-file/sick-note-labels";
import { queryKeys } from "@/lib/query/keys";

/**
 * Linking sick notes that are already in a personnel file to the employee's
 * sick leave (#984), for whoever manages the employee's sick notes: from a
 * sick note (pick the absence) or from an absence (pick the note). The server
 * decides who may and refuses everything else.
 */

interface PickOption {
	value: string;
	label: string;
	hint?: string;
}

function LinkPickerPanel({
	open,
	onOpenChange,
	title,
	description,
	options,
	loading,
	failed,
	emptyText,
	requiredText,
	onLink,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	options: readonly PickOption[];
	loading: boolean;
	failed: boolean;
	emptyText: string;
	requiredText: string;
	onLink: (value: string) => Promise<boolean>;
}) {
	const { t } = useTranslate();
	const labelId = useId();
	const form = useForm({
		defaultValues: { selection: "" },
		onSubmit: async ({ value }) => {
			if (await onLink(value.selection)) close();
		},
	});

	function close() {
		form.reset();
		onOpenChange(false);
	}

	return (
		<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
			{(busy: boolean) => (
				<ActionPanel
					open={open}
					onOpenChange={(next) => (next ? onOpenChange(true) : !busy && close())}
				>
					<ActionPanelContent>
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
								<ActionPanelTitle>{title}</ActionPanelTitle>
								<ActionPanelDescription>{description}</ActionPanelDescription>
							</ActionPanelHeader>
							<ActionPanelBody className="space-y-4">
								{loading ? (
									<div className="space-y-2" aria-busy="true">
										<Skeleton className="h-10 w-full" />
										<Skeleton className="h-10 w-full" />
									</div>
								) : failed ? (
									<p role="alert" className="text-sm text-destructive">
										{t(
											"settings.personnelFiles.sickNotes.loadFailed",
											"The list could not be loaded.",
										)}
									</p>
								) : options.length === 0 ? (
									<p className="text-sm text-muted-foreground">{emptyText}</p>
								) : (
									<form.Field
										name="selection"
										validators={{
											onSubmit: ({ value }) => (value ? undefined : requiredText),
										}}
									>
										{(field) => (
											<TFormItem>
												<RadioGroup
													aria-label={title}
													value={field.state.value}
													onValueChange={(value) => field.handleChange(value)}
													disabled={busy}
												>
													{options.map((option) => {
														const id = `${labelId}-${option.value}`;
														return (
															<div key={option.value} className="flex items-start gap-3">
																<RadioGroupItem
																	id={id}
																	value={option.value}
																	aria-label={option.label}
																	className="mt-0.5"
																/>
																<label htmlFor={id} className="space-y-0.5 text-sm">
																	<span className="block font-medium">{option.label}</span>
																	{option.hint ? (
																		<span className="block text-muted-foreground">
																			{option.hint}
																		</span>
																	) : null}
																</label>
															</div>
														);
													})}
												</RadioGroup>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>
								)}
							</ActionPanelBody>
							<ActionPanelFooter>
								<Button type="button" variant="outline" onClick={close} disabled={busy}>
									{t("common.cancel", "Cancel")}
								</Button>
								<Button type="submit" disabled={busy || loading || options.length === 0}>
									{busy ? (
										<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
									) : (
										<IconLink aria-hidden="true" className="size-4" />
									)}
									{t("settings.personnelFiles.sickNotes.link", "Link")}
								</Button>
							</ActionPanelFooter>
						</form>
					</ActionPanelContent>
				</ActionPanel>
			)}
		</form.Subscribe>
	);
}

async function linkOrReport(
	input: { documentId: string; absenceId: string },
	fallbackError: string,
): Promise<boolean> {
	const result = await linkSickNoteAction(input);
	if (!result.success) {
		toast.error(result.error || fallbackError);
		return false;
	}
	return true;
}

/** The employee's pending and approved sick leave, for picking one in the officer area. */
export function useEmployeeSickLeave(employeeId: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.personnelFile.employeeSickLeave(employeeId),
		queryFn: async (): Promise<LinkableSickLeave[]> => {
			const result = await listSickLeaveForLinkingAction(employeeId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled,
	});
}

/** From a sick note in the personnel file: pick the employee's sick leave it covers. */
export function LinkSickNoteToAbsenceDialog({
	document,
	open,
	onOpenChange,
	onLinked,
}: {
	document: EmployeeDocumentView;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onLinked: () => void;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const query = useEmployeeSickLeave(document.employeeId, open);
	const statuses = {
		pending: t("settings.personnelFiles.sickLeave.status.pending", "Pending"),
		approved: t("settings.personnelFiles.sickLeave.status.approved", "Approved"),
	};
	const options: PickOption[] = (query.data ?? []).map((absence) => ({
		value: absence.id,
		label: formatAbsenceDateRange(absence.startDate, absence.endDate, locale),
		hint: [
			statuses[absence.status],
			t(
				"settings.personnelFiles.sickLeave.notes.count",
				"{count, plural, one {# note} other {# notes}}",
				{ count: absence.sickNoteCount },
			),
		].join(" · "),
	}));
	const failedText = t(
		"settings.personnelFiles.sickNotes.linkFailed",
		"The sick note could not be linked.",
	);

	return (
		<LinkPickerPanel
			open={open}
			onOpenChange={onOpenChange}
			title={t("settings.personnelFiles.sickNotes.linkToAbsenceTitle", "Link to sick leave")}
			description={t(
				"settings.personnelFiles.sickNotes.linkToAbsenceDescription",
				'Choose the sick leave "{title}" covers. A sick leave recorded without certificate then counts as with certificate.',
				{ title: document.title },
			)}
			options={options}
			loading={query.isPending}
			failed={query.isError}
			emptyText={t(
				"settings.personnelFiles.sickNotes.noSickLeave",
				"This employee has no pending or approved sick leave.",
			)}
			requiredText={t("settings.personnelFiles.sickNotes.chooseAbsence", "Choose an absence.")}
			onLink={async (absenceId) => {
				const linked = await linkOrReport({ documentId: document.id, absenceId }, failedText);
				if (linked) {
					toast.success(t("settings.personnelFiles.sickNotes.linked", "Sick note linked"));
					onLinked();
				}
				return linked;
			}}
		/>
	);
}

/** From an absence: pick one of the employee's sick notes that covers no absence yet. */
export function LinkExistingSickNoteDialog({
	absence,
	open,
	onOpenChange,
	onLinked,
}: {
	absence: { id: string; employeeId: string; startDate: string; endDate: string };
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onLinked: () => void;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const query = useQuery({
		queryKey: queryKeys.personnelFile.employee(absence.employeeId, "sick_note"),
		queryFn: async () => {
			const result = await getPersonnelFileAction({
				employeeId: absence.employeeId,
				category: "sick_note",
			});
			if (!result.success) throw new Error(result.error);
			return result.data.documents;
		},
		enabled: open,
	});
	const options: PickOption[] = (query.data ?? [])
		.filter((document) => document.absence === null)
		.map((document) => ({
			value: document.id,
			label: document.title,
			hint: `${formatDateOnly(document.documentDate, locale)} · ${document.fileName}`,
		}));
	const failedText = t(
		"settings.personnelFiles.sickNotes.linkFailed",
		"The sick note could not be linked.",
	);

	return (
		<LinkPickerPanel
			open={open}
			onOpenChange={onOpenChange}
			title={t("settings.personnelFiles.sickNotes.linkExistingTitle", "Link a sick note")}
			description={t(
				"settings.personnelFiles.sickNotes.linkExistingDescription",
				"Choose a sick note from the personnel file for the sick leave {dateRange}.",
				{ dateRange: formatAbsenceDateRange(absence.startDate, absence.endDate, locale) },
			)}
			options={options}
			loading={query.isPending}
			failed={query.isError}
			emptyText={t(
				"settings.personnelFiles.sickNotes.noUnlinkedNotes",
				"There are no sick notes in this personnel file that are not linked to an absence.",
			)}
			requiredText={t("settings.personnelFiles.sickNotes.chooseNote", "Choose a sick note.")}
			onLink={async (documentId) => {
				const linked = await linkOrReport({ documentId, absenceId: absence.id }, failedText);
				if (linked) {
					toast.success(t("settings.personnelFiles.sickNotes.linked", "Sick note linked"));
					onLinked();
				}
				return linked;
			}}
		/>
	);
}
