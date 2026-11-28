"use client";

import { IconFilePlus, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	documentLeaveOpportunity,
	getEmployeeLeaveNotices,
	recordExternalLeaveNotice,
} from "@/app/[locale]/(app)/settings/vacation/leave-notice-actions";
import { SettingsLoadError } from "@/components/settings/settings-load-error";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHeaderRow, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useDisplayContext } from "@/hooks/use-display-context";
import type { ExternalLeaveNoticeDeliveryMethod } from "@/db/schema/vacation-leave-notice";
import type { LeaveYearNoticeCoverage } from "@/lib/absences/leave-notice-coverage";
import type {
	ExternalLeaveNoticeRecord,
	LeaveNoticeRefusalCode,
} from "@/lib/absences/leave-notice-store";
import { instantFromDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatInstant, formatPlainDate } from "@/lib/datetime/temporal-format";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import { runWithBusyState } from "../run-with-busy-state";

interface LeaveNoticesView {
	year: number;
	timezone: string;
	notices: ExternalLeaveNoticeRecord[];
	coverage: LeaveYearNoticeCoverage[] | null;
}

const LEAVE_NOTICE_REFUSALS = {
	employee_not_found: ["settings.vacation.leaveNotices.employeeNotFound", "Employee not found."],
	notice_incomplete: [
		"settings.vacation.leaveNotices.noticeIncomplete",
		"A leave notice must ask the employee to take the days and warn that unused days can lapse.",
	],
	delivered_in_future: [
		"settings.vacation.leaveNotices.deliveredInFuture",
		"A notice can only be attested once it was given.",
	],
	deadline_not_after_delivery: [
		"settings.vacation.leaveNotices.deadlineNotAfterDelivery",
		"The deadline must be after the day the notice was given.",
	],
	leave_year_after_delivery: [
		"settings.vacation.leaveNotices.leaveYearAfterDelivery",
		"A notice can only cover leave of its delivery year or earlier.",
	],
	delivery_details_required: [
		"settings.vacation.leaveNotices.deliveryDetailsRequired",
		"Describe how the notice was given.",
	],
	notice_not_found: ["settings.vacation.leaveNotices.noticeNotFound", "Leave notice not found."],
	basis_required: [
		"settings.vacation.leaveNotices.basisRequired",
		"Record why the employee could take the covered days by the deadline.",
	],
	already_assessed: [
		"settings.vacation.leaveNotices.alreadyAssessed",
		"The opportunity to take this notice's days is already documented.",
	],
} satisfies RefusalMessages<LeaveNoticeRefusalCode>;

function useDeliveryMethodLabel() {
	const { t } = useTranslate();
	return (method: ExternalLeaveNoticeDeliveryMethod) =>
		({
			in_person: t("settings.vacation.leaveNotices.method.inPerson", "In person"),
			letter: t("settings.vacation.leaveNotices.method.letter", "Letter"),
			email: t("settings.vacation.leaveNotices.method.email", "Email"),
			other: t("settings.vacation.leaveNotices.method.other", "Other"),
		})[method];
}

/**
 * HR's leave notices for one employee (#2082): notices given outside Z8 recorded as dated
 * attestations, the documented opportunity to take the covered days, and which outstanding days of
 * each leave year the notices cover. Noticed days stay outstanding until the opportunity is
 * documented; days added after a notice need a new notice.
 */
export function EmployeeLeaveNoticesCard({ employeeId }: { employeeId: string }) {
	const { t } = useTranslate();
	const [view, setView] = useState<LeaveNoticesView | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [recordOpen, setRecordOpen] = useState(false);
	const [assessing, setAssessing] = useState<ExternalLeaveNoticeRecord | null>(null);
	const generation = useRef(0);

	const load = useCallback(async () => {
		const current = ++generation.current;
		setLoadFailed(false);
		try {
			const result = await getEmployeeLeaveNotices(employeeId);
			if (current !== generation.current) return;
			if (result.success) setView(result.data);
			else setLoadFailed(true);
		} catch {
			if (current === generation.current) setLoadFailed(true);
		}
	}, [employeeId]);

	useEffect(() => {
		let active = true;
		queueMicrotask(() => {
			if (active) void load();
		});
		return () => {
			active = false;
			generation.current += 1;
		};
	}, [load]);

	return (
		<Card className="min-w-0">
			<CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
				<div className="min-w-0 space-y-1.5">
					<CardTitle>{t("settings.vacation.leaveNotices.title", "Leave notices")}</CardTitle>
					<CardDescription>
						{t(
							"settings.vacation.leaveNotices.description",
							"Notices asking the employee to take outstanding leave and warning that it can lapse. Noticed days stay outstanding until you document the employee's opportunity to take them.",
						)}
					</CardDescription>
				</div>
				<Button
					type="button"
					variant="outline"
					onClick={() => setRecordOpen(true)}
					disabled={!view}
				>
					<IconFilePlus aria-hidden="true" className="mr-2 size-4" />
					{t("settings.vacation.leaveNotices.recordExternal", "Record external notice")}
				</Button>
			</CardHeader>
			<CardContent className="space-y-6">
				{view ? (
					<>
						<LeaveNoticeCoverageTable coverage={view.coverage} />
						<LeaveNoticeList notices={view.notices} onAssess={setAssessing} />
					</>
				) : loadFailed ? (
					<SettingsLoadError
						message={t(
							"settings.vacation.leaveNotices.loadFailed",
							"The employee's leave notices could not be loaded.",
						)}
						onRetry={() => void load()}
					/>
				) : (
					<Skeleton aria-hidden="true" className="h-32 w-full" />
				)}
			</CardContent>
			{view ? (
				<RecordExternalLeaveNoticePanel
					open={recordOpen}
					onOpenChange={setRecordOpen}
					employeeId={employeeId}
					defaultLeaveYear={view.year}
					onRecorded={() => void load()}
				/>
			) : null}
			{assessing ? (
				<DocumentLeaveOpportunityPanel
					notice={assessing}
					onOpenChange={(open) => {
						if (!open) setAssessing(null);
					}}
					onDocumented={() => void load()}
				/>
			) : null}
		</Card>
	);
}

function LeaveNoticeCoverageTable({ coverage }: { coverage: LeaveYearNoticeCoverage[] | null }) {
	const { t } = useTranslate();
	if (!coverage)
		return (
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.vacation.leaveNotices.coverageUnavailable",
					"Outstanding days are unavailable until the employee's vacation policy is configured.",
				)}
			</p>
		);
	if (coverage.length === 0) return null;
	return (
		<Table mobileLayout="stacked">
			<TableHeaderRow
				columns={[
					{ id: "year", label: t("settings.vacation.leaveNotices.leaveYear", "Leave year") },
					{
						id: "outstanding",
						label: t("settings.vacation.leaveNotices.outstanding", "Outstanding"),
						className: "text-right",
					},
					{
						id: "covered",
						label: t("settings.vacation.leaveNotices.covered", "Opportunity documented"),
						className: "text-right",
					},
					{
						id: "awaiting",
						label: t("settings.vacation.leaveNotices.awaiting", "Awaiting assessment"),
						className: "text-right",
					},
					{
						id: "uncovered",
						label: t("settings.vacation.leaveNotices.uncovered", "No notice"),
						className: "text-right",
					},
				]}
			/>
			<TableBody>
				{coverage.map((row) => (
					<TableRow key={row.leaveYear}>
						<TableCell className="font-medium">{row.leaveYear}</TableCell>
						<TableCell className="text-right tabular-nums">{row.outstandingDays}</TableCell>
						<TableCell className="text-right tabular-nums">{row.coveredDays}</TableCell>
						<TableCell className="text-right tabular-nums">{row.awaitingOpportunityDays}</TableCell>
						<TableCell className="text-right tabular-nums">{row.uncoveredDays}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function LeaveNoticeList({
	notices,
	onAssess,
}: {
	notices: ExternalLeaveNoticeRecord[];
	onAssess: (notice: ExternalLeaveNoticeRecord) => void;
}) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	const methodLabel = useDeliveryMethodLabel();
	const date = (value: string) =>
		formatPlainDate(parsePlainDate(value), displayContext.locale, "dateMedium");
	const instant = (value: Date) =>
		formatInstant(instantFromDate(new Date(value)), displayContext, "dateTimeMedium");
	const deletedUser = t("settings.vacation.leaveNotices.deletedUser", "a deleted user");
	if (notices.length === 0)
		return (
			<p className="text-sm text-muted-foreground">
				{t("settings.vacation.leaveNotices.empty", "No leave notices recorded yet.")}
			</p>
		);
	return (
		<ul className="divide-y rounded-md border">
			{notices.map((notice) => (
				<li key={notice.id} className="space-y-2 p-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="font-medium">
							{t(
								"settings.vacation.leaveNotices.summary",
								"{days, plural, one {# day} other {# days}} of {year}, deadline {deadline}",
								{
									days: notice.days,
									year: notice.leaveYear,
									deadline: date(notice.deadlineDate),
								},
							)}
						</p>
						{notice.opportunity ? (
							<Badge variant="secondary">
								{t(
									"settings.vacation.leaveNotices.opportunityDocumented",
									"Opportunity documented",
								)}
							</Badge>
						) : (
							<Badge
								variant="outline"
								className="border-amber-500/50 text-amber-700 dark:text-amber-400"
							>
								{t(
									"settings.vacation.leaveNotices.opportunityMissing",
									"Opportunity not documented",
								)}
							</Badge>
						)}
					</div>
					<p className="text-sm text-muted-foreground">
						{t("settings.vacation.leaveNotices.delivery", "Given outside Z8 on {date}: {method}", {
							date: date(notice.deliveredOn),
							method: methodLabel(notice.deliveryMethod),
						})}
						{notice.deliveryDetails ? ` (${notice.deliveryDetails})` : null}
					</p>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.vacation.leaveNotices.attested",
							"Attested by {name} on {date}: the notice asked the employee to take these days and warned that unused days can lapse.",
							{ name: notice.attestedByName ?? deletedUser, date: instant(notice.attestedAt) },
						)}
					</p>
					{notice.supportingDocuments ? (
						<p className="break-words text-sm">
							{t("settings.vacation.leaveNotices.supportingDocuments", "Supporting documents:")}{" "}
							{notice.supportingDocuments}
						</p>
					) : null}
					{notice.opportunity ? (
						<div className="rounded-md bg-muted/50 p-3 text-sm">
							<p className="break-words">{notice.opportunity.basis}</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{t("settings.vacation.leaveNotices.assessedBy", "Documented by {name} on {date}", {
									name: notice.opportunity.assessedByName ?? deletedUser,
									date: instant(notice.opportunity.assessedAt),
								})}
							</p>
						</div>
					) : (
						<Button type="button" size="sm" variant="outline" onClick={() => onAssess(notice)}>
							{t("settings.vacation.leaveNotices.documentOpportunity", "Document opportunity")}
						</Button>
					)}
				</li>
			))}
		</ul>
	);
}

function FieldError({ errors }: { errors: readonly unknown[] }) {
	return errors.length > 0 ? (
		<p className="text-sm text-destructive" role="alert">
			{String(errors[0])}
		</p>
	) : null;
}

function RecordExternalLeaveNoticePanel({
	open,
	onOpenChange,
	employeeId,
	defaultLeaveYear,
	onRecorded,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	employeeId: string;
	defaultLeaveYear: number;
	onRecorded: () => void;
}) {
	const { t } = useTranslate();
	const methodLabel = useDeliveryMethodLabel();
	const [loading, setLoading] = useState(false);
	const required = t("settings.vacation.leaveNotices.required", "Required");
	const form = useForm({
		defaultValues: {
			leaveYear: String(defaultLeaveYear),
			days: "",
			deliveredOn: "",
			deliveryMethod: "letter" as ExternalLeaveNoticeDeliveryMethod,
			deliveryDetails: "",
			deadline: "",
			supportingDocuments: "",
			requestedToTakeLeave: false,
			warnedOfLapse: false,
		},
		onSubmit: async ({ value }) => {
			await runWithBusyState(setLoading, async () => {
				const result = await recordExternalLeaveNotice({
					employeeId,
					leaveYear: Number(value.leaveYear),
					days: Number(value.days),
					deliveredOn: value.deliveredOn,
					deliveryMethod: value.deliveryMethod,
					deliveryDetails: value.deliveryDetails.trim() || null,
					deadline: value.deadline,
					requestedToTakeLeave: value.requestedToTakeLeave,
					warnedOfLapse: value.warnedOfLapse,
					supportingDocuments: value.supportingDocuments.trim() || null,
				});
				if (result.success) {
					toast.success(t("settings.vacation.leaveNotices.recorded", "Leave notice recorded"));
					form.reset();
					onRecorded();
					onOpenChange(false);
				} else {
					toast.error(
						actionErrorMessage(t, result, LEAVE_NOTICE_REFUSALS, [
							"settings.vacation.leaveNotices.recordFailed",
							"Failed to record the leave notice",
						]),
					);
				}
			});
		},
	});
	const method = useStore(form.store, (state) => state.values.deliveryMethod);

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.vacation.leaveNotices.recordTitle", "Record a notice given outside Z8")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.vacation.leaveNotices.recordDescription",
							"Your dated attestation of the notice. It is final; a notice that covers more days needs a new attestation.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-5">
						<div className="grid gap-4 sm:grid-cols-2">
							<form.Field
								name="leaveYear"
								validators={{
									onSubmit: ({ value }) => (/^\d{4}$/.test(value) ? undefined : required),
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="leaveNoticeYear">
											{t("settings.vacation.leaveNotices.leaveYear", "Leave year")}
										</Label>
										<Input
											id="leaveNoticeYear"
											inputMode="numeric"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											aria-invalid={field.state.meta.errors.length > 0}
										/>
										<FieldError errors={field.state.meta.errors} />
									</div>
								)}
							</form.Field>
							<form.Field
								name="days"
								validators={{
									onSubmit: ({ value }) =>
										Number(value) > 0
											? undefined
											: t(
													"settings.vacation.leaveNotices.daysPositive",
													"Enter the days the notice covered.",
												),
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="leaveNoticeDays">
											{t("settings.vacation.leaveNotices.days", "Days covered")}
										</Label>
										<Input
											id="leaveNoticeDays"
											type="number"
											min="0.5"
											step="0.5"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											aria-invalid={field.state.meta.errors.length > 0}
										/>
										<FieldError errors={field.state.meta.errors} />
									</div>
								)}
							</form.Field>
							<form.Field
								name="deliveredOn"
								validators={{ onSubmit: ({ value }) => (value ? undefined : required) }}
							>
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="leaveNoticeDeliveredOn">
											{t("settings.vacation.leaveNotices.deliveredOn", "Given on")}
										</Label>
										<Input
											id="leaveNoticeDeliveredOn"
											type="date"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											aria-invalid={field.state.meta.errors.length > 0}
										/>
										<FieldError errors={field.state.meta.errors} />
									</div>
								)}
							</form.Field>
							<form.Field
								name="deadline"
								validators={{ onSubmit: ({ value }) => (value ? undefined : required) }}
							>
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="leaveNoticeDeadline">
											{t(
												"settings.vacation.leaveNotices.deadline",
												"Deadline stated in the notice",
											)}
										</Label>
										<Input
											id="leaveNoticeDeadline"
											type="date"
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											aria-invalid={field.state.meta.errors.length > 0}
										/>
										<FieldError errors={field.state.meta.errors} />
									</div>
								)}
							</form.Field>
						</div>
						<form.Field name="deliveryMethod">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="leaveNoticeMethod">
										{t("settings.vacation.leaveNotices.methodLabel", "How the notice was given")}
									</Label>
									<Select
										value={field.state.value}
										onValueChange={(value) =>
											field.handleChange(value as ExternalLeaveNoticeDeliveryMethod)
										}
									>
										<SelectTrigger id="leaveNoticeMethod">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{(["letter", "email", "in_person", "other"] as const).map((option) => (
												<SelectItem key={option} value={option}>
													{methodLabel(option)}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>
						<form.Field
							name="deliveryDetails"
							validators={{
								onSubmit: ({ value, fieldApi }) =>
									fieldApi.form.getFieldValue("deliveryMethod") === "other" && !value.trim()
										? t(
												"settings.vacation.leaveNotices.deliveryDetailsRequired",
												"Describe how the notice was given.",
											)
										: undefined,
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="leaveNoticeDetails">
										{method === "other"
											? t("settings.vacation.leaveNotices.detailsRequiredLabel", "Delivery details")
											: t(
													"settings.vacation.leaveNotices.detailsOptionalLabel",
													"Delivery details (optional)",
												)}
									</Label>
									<Input
										id="leaveNoticeDetails"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										aria-invalid={field.state.meta.errors.length > 0}
										placeholder={t(
											"settings.vacation.leaveNotices.detailsPlaceholder",
											"For example: handed over in the team meeting",
										)}
									/>
									<FieldError errors={field.state.meta.errors} />
								</div>
							)}
						</form.Field>
						<form.Field name="supportingDocuments">
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="leaveNoticeDocuments">
										{t(
											"settings.vacation.leaveNotices.documentsLabel",
											"Supporting documents (optional)",
										)}
									</Label>
									<Textarea
										id="leaveNoticeDocuments"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										placeholder={t(
											"settings.vacation.leaveNotices.documentsPlaceholder",
											"For example: signed copy in the personnel file",
										)}
									/>
								</div>
							)}
						</form.Field>
						{(
							[
								[
									"requestedToTakeLeave",
									t(
										"settings.vacation.leaveNotices.confirmRequest",
										"The notice asked the employee to take these days by the deadline",
									),
								],
								[
									"warnedOfLapse",
									t(
										"settings.vacation.leaveNotices.confirmWarning",
										"The notice warned that unused days can lapse after the deadline",
									),
								],
							] as const
						).map(([name, label]) => (
							<form.Field
								key={name}
								name={name}
								validators={{
									onSubmit: ({ value }) =>
										value
											? undefined
											: t(
													"settings.vacation.leaveNotices.noticeIncomplete",
													"A leave notice must ask the employee to take the days and warn that unused days can lapse.",
												),
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<div className="flex flex-row items-start gap-x-3 rounded-lg border p-4">
											<Checkbox
												id={`leaveNotice-${name}`}
												checked={field.state.value}
												onCheckedChange={(checked) => field.handleChange(checked === true)}
											/>
											<Label htmlFor={`leaveNotice-${name}`} className="leading-snug">
												{label}
											</Label>
										</div>
										<FieldError errors={field.state.meta.errors} />
									</div>
								)}
							</form.Field>
						))}
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={loading}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={loading}>
							{loading && <IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />}
							{t("settings.vacation.leaveNotices.attest", "Attest notice")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function DocumentLeaveOpportunityPanel({
	notice,
	onOpenChange,
	onDocumented,
}: {
	notice: ExternalLeaveNoticeRecord;
	onOpenChange: (open: boolean) => void;
	onDocumented: () => void;
}) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	const [loading, setLoading] = useState(false);
	const form = useForm({
		defaultValues: { basis: "" },
		onSubmit: async ({ value }) => {
			await runWithBusyState(setLoading, async () => {
				const result = await documentLeaveOpportunity({ noticeId: notice.id, basis: value.basis });
				if (result.success) {
					toast.success(
						t(
							"settings.vacation.leaveNotices.opportunitySaved",
							"Opportunity to take leave documented",
						),
					);
					onDocumented();
					onOpenChange(false);
				} else {
					toast.error(
						actionErrorMessage(t, result, LEAVE_NOTICE_REFUSALS, [
							"settings.vacation.leaveNotices.opportunityFailed",
							"Failed to document the opportunity to take leave",
						]),
					);
				}
			});
		},
	});

	return (
		<ActionPanel open onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.vacation.leaveNotices.opportunityTitle", "Opportunity to take leave")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.vacation.leaveNotices.opportunityDescription",
							"Record why the employee could actually take the {days, plural, one {# day} other {# days}} of {year} by {deadline}. Without it, the days stay outstanding. You cannot change it later.",
							{
								days: notice.days,
								year: notice.leaveYear,
								deadline: formatPlainDate(
									parsePlainDate(notice.deadlineDate),
									displayContext.locale,
									"dateMedium",
								),
							},
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody>
						<form.Field
							name="basis"
							validators={{
								onSubmit: ({ value }) =>
									value.trim()
										? undefined
										: t(
												"settings.vacation.leaveNotices.basisRequired",
												"Record why the employee could take the covered days by the deadline.",
											),
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="leaveOpportunityBasis">
										{t("settings.vacation.leaveNotices.basis", "Basis for the finding")}
									</Label>
									<Textarea
										id="leaveOpportunityBasis"
										rows={5}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										aria-invalid={field.state.meta.errors.length > 0}
										placeholder={t(
											"settings.vacation.leaveNotices.basisPlaceholder",
											"For example: no vacation block in the period, staffing planned around the requested weeks",
										)}
									/>
									<FieldError errors={field.state.meta.errors} />
								</div>
							)}
						</form.Field>
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={loading}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={loading}>
							{loading && <IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />}
							{t("settings.vacation.leaveNotices.saveOpportunity", "Document opportunity")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
