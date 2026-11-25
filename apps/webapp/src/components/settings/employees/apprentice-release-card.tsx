"use client";

import {
	IconAlertTriangle,
	IconCalendarCheck,
	IconLoader2,
	IconPlus,
	IconSchool,
	IconTrash,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getApprenticeReleaseCreditsAction,
	getOwnApprenticeReleaseCreditsAction,
	recordApprenticeReleaseAction,
	voidApprenticeReleaseAction,
} from "@/app/[locale]/(app)/settings/employees/apprentice-release-actions";
import { Badge } from "@/components/ui/badge";
import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EMPLOYEE_WORK_BALANCE_QUERY_KEY } from "@/components/settings/work-balance/use-employee-work-balance";
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
import type { ApprenticeReleaseKind } from "@/db/schema";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDateRange } from "@/lib/datetime/temporal-format";
import { formatTimeStringForPreference, type TimeFormat } from "@/lib/user-preferences/time-format";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type {
	ApprenticeReleaseCreditView,
	ApprenticeReleaseCredits,
} from "@/lib/statutory/apprenticeship/release-credit-view";
import { apprenticeReleaseRefusals } from "./apprentice-release-refusals";

type Translate = ReturnType<typeof useTranslate>["t"];

/** A recorded `HH:MM` wall time in the reader's chosen time format (12- or 24-hour). */
function wallTimeText(value: string, timeFormat: TimeFormat): string {
	return formatTimeStringForPreference(value, timeFormat);
}

export type ApprenticeReleaseCardProps = { readonly organizationId: string } & (
	| { readonly view: "employee"; readonly employeeId: string; readonly canManage: boolean }
	| { readonly view: "self" }
);

/** Release credits are organization data: every key carries the organization. */
const releaseQueryKey = (organizationId: string, employeeId?: string) =>
	employeeId
		? (["apprentice-release", organizationId, employeeId] as const)
		: (["apprentice-release", organizationId] as const);

function kindLabel(kind: ApprenticeReleaseKind, t: Translate): string {
	switch (kind) {
		case "vocational_school_day":
			return t("settings.apprenticeRelease.kind.schoolDay", "Vocational school day");
		case "vocational_school_block_week":
			return t("settings.apprenticeRelease.kind.blockWeek", "Block-release school week");
		case "exam_day":
			return t("settings.apprenticeRelease.kind.examDay", "Exam day");
		case "pre_exam_day":
			return t("settings.apprenticeRelease.kind.preExamDay", "Working day before the exam");
	}
}

function creditText(
	release: ApprenticeReleaseCreditView,
	t: Translate,
	timeFormat: TimeFormat,
): string {
	if (release.examStartTime !== null) {
		return t(
			"settings.apprenticeRelease.credit.exam",
			"Exam from {start}: {minutes} min credited",
			{
				start: wallTimeText(release.examStartTime, timeFormat),
				minutes: release.creditedMinutes,
			},
		);
	}
	if (
		release.schoolStartTime !== null &&
		release.schoolEndTime !== null &&
		release.creditedMinutes > 0
	) {
		return t(
			"settings.apprenticeRelease.credit.schoolTime",
			"School {start}–{end}: {minutes} min credited",
			{
				start: wallTimeText(release.schoolStartTime, timeFormat),
				end: wallTimeText(release.schoolEndTime, timeFormat),
				minutes: release.creditedMinutes,
			},
		);
	}
	if (release.creditedMinutes === 0) {
		return t(
			"settings.apprenticeRelease.credit.fullDays",
			"{count, plural, one {# working day credited in full} other {# working days credited in full}}",
			{ count: release.fullDays },
		);
	}
	return t("settings.apprenticeRelease.credit.minutes", "{minutes} min of school time credited", {
		minutes: release.creditedMinutes,
	});
}

function useCredits(props: ApprenticeReleaseCardProps) {
	const { t } = useTranslate();
	const employeeId = props.view === "employee" ? props.employeeId : "self";
	return useQuery({
		queryKey: releaseQueryKey(props.organizationId, employeeId),
		queryFn: async (): Promise<ApprenticeReleaseCredits> => {
			const result =
				props.view === "employee"
					? await getApprenticeReleaseCreditsAction({ employeeId: props.employeeId })
					: await getOwnApprenticeReleaseCreditsAction();
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
	});
}

/**
 * Apprentice school and exam release days with what they credit (#1993). Org admins record and
 * void them on Employee Detail; managers and the employee themself see them read-only. Release
 * days are paid: they never reduce vacation and never leave a negative work balance.
 */
export function ApprenticeReleaseCard(props: ApprenticeReleaseCardProps) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const timeFormat = useTimeFormat();
	const credits = useCredits(props);
	const canManage = props.view === "employee" && props.canManage;
	const data = credits.data;

	if (credits.isLoading) return null;
	if (!data || (!data.isApprentice && data.releases.length === 0)) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconSchool className="size-5" aria-hidden="true" />
					{t("settings.apprenticeRelease.title", "School and exam release")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.apprenticeRelease.description",
						"Vocational school, block-release weeks and exam days are paid release (§ 15 BBiG): they are credited as working time, never deducted from vacation and never leave a negative work balance.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{data.releases.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t("settings.apprenticeRelease.empty", "No release days recorded yet.")}
					</p>
				) : (
					<ul className="divide-y rounded-md border">
						{data.releases.map((release) => (
							<li key={release.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<div className="flex flex-wrap items-center gap-2">
										<IconCalendarCheck
											className="size-4 text-muted-foreground"
											aria-hidden="true"
										/>
										<span className="font-medium">{kindLabel(release.releaseKind, t)}</span>
										<span className="text-muted-foreground text-sm tabular-nums">
											{formatPlainDateRange(
												parsePlainDate(release.startsOn),
												parsePlainDate(release.endsOn),
												locale,
												"dateMedium",
											)}
										</span>
									</div>
									<p className="text-sm">{creditText(release, t, timeFormat)}</p>
									{release.releaseKind === "vocational_school_block_week" &&
									release.fullDays > 0 ? (
										// #2023: full block days allow 2 h of training a week outside the § 8 totals.
										<p className="text-muted-foreground text-xs">
											{t(
												"settings.apprenticeRelease.blockWeekTrainingNote",
												"Up to 2 hours of in-company training a week are allowed on these block days (§ 9 Abs. 1 Nr. 3 JArbSchG, § 15 Abs. 1 Satz 3 BBiG). For an employee under 18, these hours come on top of the block week, which counts with the average weekly working time (§ 9 Abs. 2 Nr. 2 JArbSchG), and do not count towards the § 8 daily and weekly limits.",
											)}
										</p>
									) : null}
									{release.lessonCount !== null ? (
										<p className="text-muted-foreground text-xs">
											{t("settings.apprenticeRelease.lessons", "{count} lessons", {
												count: release.lessonCount,
											})}
										</p>
									) : null}
									{release.flagsWorkplaceReturn ? (
										<Badge variant="outline" className="w-fit gap-1">
											<IconAlertTriangle className="size-3.5" aria-hidden="true" />
											{t(
												"settings.apprenticeRelease.workplaceReturn",
												"Under 18: no return to work after this full school day (§ 9 Abs. 1 Nr. 2 JArbSchG)",
											)}
										</Badge>
									) : null}
									{release.note ? (
										<p className="text-muted-foreground text-xs">{release.note}</p>
									) : null}
								</div>
								{canManage && props.view === "employee" ? (
									<VoidReleaseForm
										organizationId={props.organizationId}
										employeeId={props.employeeId}
										releaseId={release.id}
									/>
								) : null}
							</li>
						))}
					</ul>
				)}
				{canManage && props.view === "employee" ? (
					<RecordReleaseForm organizationId={props.organizationId} employeeId={props.employeeId} />
				) : null}
			</CardContent>
		</Card>
	);
}

/** Release days change the credits shown here, the self view and the employee's work balance. */
function useInvalidate(organizationId: string, employeeId: string) {
	const queryClient = useQueryClient();
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: releaseQueryKey(organizationId) }),
			queryClient.invalidateQueries({ queryKey: [...EMPLOYEE_WORK_BALANCE_QUERY_KEY, employeeId] }),
		]);
}

function VoidReleaseForm({
	organizationId,
	employeeId,
	releaseId,
}: {
	organizationId: string;
	employeeId: string;
	releaseId: string;
}) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const invalidate = useInvalidate(organizationId, employeeId);
	const mutation = useMutation({
		mutationFn: async (reason: string) => {
			const result = await voidApprenticeReleaseAction({ employeeId, releaseId, reason });
			if (!result.success) {
				throw new Error(actionErrorMessage(t, result, apprenticeReleaseRefusals));
			}
		},
		onSuccess: () => {
			toast.success(t("settings.apprenticeRelease.voided", "Release day removed"));
			setOpen(false);
			void invalidate();
		},
		onError: (error) => toast.error(error.message),
	});
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			// A refusal is shown by onError; the form stays open to correct it.
			await mutation.mutateAsync(value.reason).catch(() => undefined);
		},
	});

	if (!open) {
		return (
			<Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
				<IconTrash className="mr-1.5 size-4" aria-hidden="true" />
				{t("settings.apprenticeRelease.void", "Remove")}
			</Button>
		);
	}
	return (
		<form
			className="flex flex-col gap-2 sm:w-64"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="reason">
				{(field) => (
					<div className="space-y-1.5">
						<Label htmlFor={`void-${releaseId}`}>
							{t("settings.apprenticeRelease.voidReason", "Why is it removed?")}
						</Label>
						<Input
							id={`void-${releaseId}`}
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
							required
						/>
					</div>
				)}
			</form.Field>
			<div className="flex gap-2">
				<Button type="submit" size="sm" variant="destructive" disabled={mutation.isPending}>
					{mutation.isPending ? (
						<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
					) : null}
					{t("settings.apprenticeRelease.voidConfirm", "Remove release day")}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
					{t("common.cancel", "Cancel")}
				</Button>
			</div>
		</form>
	);
}

type RecordReleaseValues = {
	releaseKind: ApprenticeReleaseKind;
	startsOn: string;
	endsOn: string;
	lessonCount: string;
	schoolHours: string;
	examStartTime: string;
	examEndTime: string;
	schoolStartTime: string;
	schoolEndTime: string;
	note: string;
	includePreExamDay: boolean;
};

const releaseKinds = [
	"vocational_school_day",
	"vocational_school_block_week",
	"exam_day",
	"pre_exam_day",
] as const;

/** What the record action receives: only the fields the chosen release kind uses. */
function recordReleaseInput(employeeId: string, value: RecordReleaseValues) {
	const blockWeek = value.releaseKind === "vocational_school_block_week";
	const schoolDay = value.releaseKind === "vocational_school_day";
	const examDay = value.releaseKind === "exam_day";
	return {
		employeeId,
		releaseKind: value.releaseKind,
		startsOn: value.startsOn,
		endsOn: blockWeek ? value.endsOn : value.startsOn,
		lessonCount: schoolDay && value.lessonCount !== "" ? Number(value.lessonCount) : null,
		schoolMinutes:
			blockWeek && value.schoolHours !== "" ? Math.round(Number(value.schoolHours) * 60) : null,
		examStartTime: examDay && value.examStartTime !== "" ? value.examStartTime : null,
		examEndTime: examDay && value.examEndTime !== "" ? value.examEndTime : null,
		schoolStartTime: schoolDay && value.schoolStartTime !== "" ? value.schoolStartTime : null,
		schoolEndTime: schoolDay && value.schoolEndTime !== "" ? value.schoolEndTime : null,
		note: value.note.trim() || null,
		includePreExamDay: examDay && value.includePreExamDay,
	};
}

/** A labelled input of the record form. */
function ReleaseInputField({
	id,
	label,
	value,
	onChange,
	className = "space-y-1.5",
	...inputProps
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	className?: string;
	type?: "date" | "number" | "time";
	required?: boolean;
	min?: number;
	max?: number;
	step?: number;
	"aria-describedby"?: string;
}) {
	return (
		<div className={className}>
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				{...inputProps}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}

function ReleaseFieldHint({ id, children }: { id: string; children: string }) {
	return (
		<p id={id} className="text-muted-foreground text-xs sm:col-span-2">
			{children}
		</p>
	);
}

function RecordReleaseForm({
	organizationId,
	employeeId,
}: {
	organizationId: string;
	employeeId: string;
}) {
	const { t } = useTranslate();
	const invalidate = useInvalidate(organizationId, employeeId);
	const mutation = useMutation({
		mutationFn: async (value: RecordReleaseValues) => {
			const result = await recordApprenticeReleaseAction(recordReleaseInput(employeeId, value));
			if (!result.success) {
				throw new Error(actionErrorMessage(t, result, apprenticeReleaseRefusals));
			}
		},
		onSuccess: () => {
			toast.success(t("settings.apprenticeRelease.recorded", "Release day recorded"));
			form.reset();
			void invalidate();
		},
		onError: (error) => toast.error(error.message),
	});
	const form = useForm({
		defaultValues: {
			releaseKind: "vocational_school_day" as ApprenticeReleaseKind,
			startsOn: "",
			endsOn: "",
			lessonCount: "",
			schoolHours: "",
			examStartTime: "",
			examEndTime: "",
			schoolStartTime: "",
			schoolEndTime: "",
			note: "",
			includePreExamDay: true,
		},
		onSubmit: async ({ value }) => {
			// A refusal is shown by onError; the form keeps what was entered.
			await mutation.mutateAsync(value).catch(() => undefined);
		},
	});

	return (
		<form
			className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="releaseKind">
				{(field) => (
					<div className="space-y-1.5">
						<Label htmlFor="apprentice-release-kind">
							{t("settings.apprenticeRelease.fields.kind", "Release")}
						</Label>
						<Select
							value={field.state.value}
							onValueChange={(value) => field.handleChange(value as ApprenticeReleaseKind)}
						>
							<SelectTrigger id="apprentice-release-kind">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{releaseKinds.map((kind) => (
									<SelectItem key={kind} value={kind}>
										{kindLabel(kind, t)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}
			</form.Field>
			<form.Field name="startsOn">
				{(field) => (
					<ReleaseInputField
						id="apprentice-release-starts"
						label={t("settings.apprenticeRelease.fields.date", "Date")}
						type="date"
						required
						value={field.state.value}
						onChange={field.handleChange}
					/>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.values.releaseKind}>
				{(kind) => (
					<>
						{kind === "vocational_school_block_week" ? (
							<>
								<form.Field name="endsOn">
									{(field) => (
										<ReleaseInputField
											id="apprentice-release-ends"
											label={t("settings.apprenticeRelease.fields.endsOn", "Last day")}
											type="date"
											required
											value={field.state.value}
											onChange={field.handleChange}
										/>
									)}
								</form.Field>
								<form.Field name="schoolHours">
									{(field) => (
										<ReleaseInputField
											id="apprentice-release-hours"
											label={t(
												"settings.apprenticeRelease.fields.schoolHoursPerWeek",
												"School hours per week (clock hours)",
											)}
											type="number"
											min={0}
											step={0.25}
											required
											value={field.state.value}
											onChange={field.handleChange}
										/>
									)}
								</form.Field>
							</>
						) : null}
						{kind === "vocational_school_day" ? (
							<>
								<form.Field name="lessonCount">
									{(field) => (
										<ReleaseInputField
											id="apprentice-release-lessons"
											label={t("settings.apprenticeRelease.fields.lessons", "Lessons (45 min each)")}
											type="number"
											min={0}
											max={20}
											required
											value={field.state.value}
											onChange={field.handleChange}
										/>
									)}
								</form.Field>
								<form.Field name="schoolStartTime">
									{(field) => (
										<ReleaseInputField
											id="apprentice-release-school-start"
											label={t("settings.apprenticeRelease.fields.schoolStartTime", "School starts")}
											type="time"
											value={field.state.value}
											onChange={field.handleChange}
											aria-describedby="apprentice-release-school-hint"
										/>
									)}
								</form.Field>
								<form.Field name="schoolEndTime">
									{(field) => (
										<ReleaseInputField
											id="apprentice-release-school-end"
											label={t(
												"settings.apprenticeRelease.fields.schoolEndTime",
												"School ends (including breaks)",
											)}
											type="time"
											value={field.state.value}
											onChange={field.handleChange}
											aria-describedby="apprentice-release-school-hint"
										/>
									)}
								</form.Field>
								<ReleaseFieldHint id="apprentice-release-school-hint">
									{t(
										"settings.apprenticeRelease.fields.schoolTimeHint",
										"A short school day credits its school time including breaks. Leave both empty to credit 45 minutes per lesson.",
									)}
								</ReleaseFieldHint>
							</>
						) : null}
						{kind === "exam_day" ? (
							<>
								<form.Field name="examStartTime">
									{(field) => (
										<ReleaseInputField
											id="apprentice-release-exam-start"
											label={t("settings.apprenticeRelease.fields.examStartTime", "Exam starts")}
											type="time"
											value={field.state.value}
											onChange={field.handleChange}
											aria-describedby="apprentice-release-exam-hint"
										/>
									)}
								</form.Field>
								<form.Field name="examEndTime">
									{(field) => (
										<ReleaseInputField
											id="apprentice-release-exam-end"
											label={t(
												"settings.apprenticeRelease.fields.examEndTime",
												"Exam ends (including breaks)",
											)}
											type="time"
											value={field.state.value}
											onChange={field.handleChange}
											aria-describedby="apprentice-release-exam-hint"
										/>
									)}
								</form.Field>
								<ReleaseFieldHint id="apprentice-release-exam-hint">
									{t(
										"settings.apprenticeRelease.fields.examTimeHint",
										"The exam frees and credits its time only. Leave both empty to release the whole day.",
									)}
								</ReleaseFieldHint>
							</>
						) : null}
						{kind === "exam_day" ? (
							<form.Field name="includePreExamDay">
								{(field) => (
									<div className="flex items-center gap-2 sm:col-span-2">
										<Checkbox
											id="apprentice-release-pre-exam"
											checked={field.state.value}
											onCheckedChange={(checked) => field.handleChange(checked === true)}
										/>
										<Label htmlFor="apprentice-release-pre-exam">
											{t(
												"settings.apprenticeRelease.fields.includePreExamDay",
												"Also release the working day before the written final exam",
											)}
										</Label>
									</div>
								)}
							</form.Field>
						) : null}
					</>
				)}
			</form.Subscribe>
			<form.Field name="note">
				{(field) => (
					<ReleaseInputField
						id="apprentice-release-note"
						className="space-y-1.5 sm:col-span-2"
						label={t("settings.apprenticeRelease.fields.note", "Note (optional)")}
						value={field.state.value}
						onChange={field.handleChange}
					/>
				)}
			</form.Field>
			<div className="sm:col-span-2">
				<Button type="submit" disabled={mutation.isPending}>
					{mutation.isPending ? (
						<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconPlus className="mr-1.5 size-4" aria-hidden="true" />
					)}
					{t("settings.apprenticeRelease.record", "Record release day")}
				</Button>
			</div>
		</form>
	);
}
