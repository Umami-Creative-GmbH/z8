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
import { parsePlainDate, parsePlainTimeMinute } from "@/lib/datetime/temporal-core";
import { formatPlainDateRange } from "@/lib/datetime/temporal-format";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import type {
	ApprenticeReleaseCreditView,
	ApprenticeReleaseCredits,
	ApprenticeReleaseRefusal,
} from "@/lib/statutory/apprenticeship/release-credit-view";
import type { EmployeeContextRefusal } from "@/lib/statutory/employee-context";

type Translate = ReturnType<typeof useTranslate>["t"];

/** Every refusal recording or removing a release day can return, as admins read it. */
export const apprenticeReleaseRefusals = {
	apprentice_release_not_apprentice: [
		"settings.apprenticeRelease.refusal.notApprentice",
		"Release days can only be recorded while the employee's terms make them an apprentice.",
	],
	apprentice_release_lessons_required: [
		"settings.apprenticeRelease.refusal.lessonsRequired",
		"Enter the number of lessons.",
	],
	apprentice_release_school_minutes_required: [
		"settings.apprenticeRelease.refusal.schoolMinutesRequired",
		"Enter the planned school hours of the block week.",
	],
	apprentice_release_no_preceding_working_day: [
		"settings.apprenticeRelease.refusal.noPrecedingWorkingDay",
		"There is no working day in the week before the exam to release.",
	],
	apprentice_release_exam_time_invalid: [
		"settings.apprenticeRelease.refusal.examTimeInvalid",
		"Enter when the exam starts and ends, or neither. It must end after it starts.",
	],
	apprentice_release_school_time_invalid: [
		"settings.apprenticeRelease.refusal.schoolTimeInvalid",
		"Enter when school starts and ends, or neither. It must end after it starts.",
	],
	apprentice_release_day_already_released: [
		"settings.apprenticeRelease.refusal.dayAlreadyReleased",
		"This day is already released. Remove the release recorded on it first.",
	],
	statutory_period_overlap: [
		"settings.apprenticeRelease.refusal.overlap",
		"This release overlaps a release already recorded.",
	],
	statutory_invalid_range: [
		"settings.apprenticeRelease.refusal.invalidRange",
		"Check the dates: the last day must not be before the first.",
	],
	statutory_invalid_value: [
		"settings.apprenticeRelease.refusal.invalidValue",
		"Check the lessons and school hours.",
	],
	statutory_note_required: [
		"settings.apprenticeRelease.refusal.reasonRequired",
		"Explain why the release day is removed.",
	],
	statutory_release_single_day: [
		"settings.apprenticeRelease.refusal.singleDay",
		"Only a block-release week spans several days.",
	],
} as const satisfies RefusalMessages<ApprenticeReleaseRefusal | EmployeeContextRefusal>;

/** A recorded `HH:MM` wall time as the reader's locale writes it. */
function wallTimeText(value: string, locale: string): string {
	try {
		return parsePlainTimeMinute(value).toLocaleString(locale, { timeStyle: "short" });
	} catch {
		return value;
	}
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

function creditText(release: ApprenticeReleaseCreditView, t: Translate, locale: string): string {
	if (release.examStartTime !== null) {
		return t(
			"settings.apprenticeRelease.credit.exam",
			"Exam from {start}: {minutes} min credited",
			{
				start: wallTimeText(release.examStartTime, locale),
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
				start: wallTimeText(release.schoolStartTime, locale),
				end: wallTimeText(release.schoolEndTime, locale),
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
									<p className="text-sm">{creditText(release, t, locale)}</p>
									{release.releaseKind === "vocational_school_block_week" &&
									release.fullDays > 0 ? (
										// #2023: full block days allow 2 h of training a week outside the § 8 totals.
										<p className="text-muted-foreground text-xs">
											{t(
												"settings.apprenticeRelease.blockWeekTrainingNote",
												"Up to 2 h a week of in-company training are allowed on these block days (§ 9 Abs. 1 Nr. 3 JArbSchG, § 15 Abs. 1 Satz 2 Nr. 3 BBiG). For an employee under 18 they do not count towards the 40-hour week, which the block week already fills with its credited 40 hours.",
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
		mutationFn: async (value: {
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
		}) => {
			const blockWeek = value.releaseKind === "vocational_school_block_week";
			const schoolDay = value.releaseKind === "vocational_school_day";
			const examDay = value.releaseKind === "exam_day";
			const result = await recordApprenticeReleaseAction({
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
			});
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
								{(
									[
										"vocational_school_day",
										"vocational_school_block_week",
										"exam_day",
										"pre_exam_day",
									] as const
								).map((kind) => (
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
					<div className="space-y-1.5">
						<Label htmlFor="apprentice-release-starts">
							{t("settings.apprenticeRelease.fields.date", "Date")}
						</Label>
						<Input
							id="apprentice-release-starts"
							type="date"
							required
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
					</div>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.values.releaseKind}>
				{(kind) => (
					<>
						{kind === "vocational_school_block_week" ? (
							<>
								<form.Field name="endsOn">
									{(field) => (
										<div className="space-y-1.5">
											<Label htmlFor="apprentice-release-ends">
												{t("settings.apprenticeRelease.fields.endsOn", "Last day")}
											</Label>
											<Input
												id="apprentice-release-ends"
												type="date"
												required
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
											/>
										</div>
									)}
								</form.Field>
								<form.Field name="schoolHours">
									{(field) => (
										<div className="space-y-1.5">
											<Label htmlFor="apprentice-release-hours">
												{t(
													"settings.apprenticeRelease.fields.schoolHoursPerWeek",
													"School hours per week (clock hours)",
												)}
											</Label>
											<Input
												id="apprentice-release-hours"
												type="number"
												min={0}
												step={0.25}
												required
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
											/>
										</div>
									)}
								</form.Field>
							</>
						) : null}
						{kind === "vocational_school_day" ? (
							<>
								<form.Field name="lessonCount">
									{(field) => (
										<div className="space-y-1.5">
											<Label htmlFor="apprentice-release-lessons">
												{t("settings.apprenticeRelease.fields.lessons", "Lessons (45 min each)")}
											</Label>
											<Input
												id="apprentice-release-lessons"
												type="number"
												min={0}
												max={20}
												required
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
											/>
										</div>
									)}
								</form.Field>
								<form.Field name="schoolStartTime">
									{(field) => (
										<div className="space-y-1.5">
											<Label htmlFor="apprentice-release-school-start">
												{t("settings.apprenticeRelease.fields.schoolStartTime", "School starts")}
											</Label>
											<Input
												id="apprentice-release-school-start"
												type="time"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												aria-describedby="apprentice-release-school-hint"
											/>
										</div>
									)}
								</form.Field>
								<form.Field name="schoolEndTime">
									{(field) => (
										<div className="space-y-1.5">
											<Label htmlFor="apprentice-release-school-end">
												{t(
													"settings.apprenticeRelease.fields.schoolEndTime",
													"School ends (including breaks)",
												)}
											</Label>
											<Input
												id="apprentice-release-school-end"
												type="time"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												aria-describedby="apprentice-release-school-hint"
											/>
										</div>
									)}
								</form.Field>
								<p
									id="apprentice-release-school-hint"
									className="text-muted-foreground text-xs sm:col-span-2"
								>
									{t(
										"settings.apprenticeRelease.fields.schoolTimeHint",
										"A short school day credits its school time including breaks. Leave both empty to credit 45 minutes per lesson.",
									)}
								</p>
							</>
						) : null}
						{kind === "exam_day" ? (
							<>
								<form.Field name="examStartTime">
									{(field) => (
										<div className="space-y-1.5">
											<Label htmlFor="apprentice-release-exam-start">
												{t("settings.apprenticeRelease.fields.examStartTime", "Exam starts")}
											</Label>
											<Input
												id="apprentice-release-exam-start"
												type="time"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												aria-describedby="apprentice-release-exam-hint"
											/>
										</div>
									)}
								</form.Field>
								<form.Field name="examEndTime">
									{(field) => (
										<div className="space-y-1.5">
											<Label htmlFor="apprentice-release-exam-end">
												{t(
													"settings.apprenticeRelease.fields.examEndTime",
													"Exam ends (including breaks)",
												)}
											</Label>
											<Input
												id="apprentice-release-exam-end"
												type="time"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												aria-describedby="apprentice-release-exam-hint"
											/>
										</div>
									)}
								</form.Field>
								<p
									id="apprentice-release-exam-hint"
									className="text-muted-foreground text-xs sm:col-span-2"
								>
									{t(
										"settings.apprenticeRelease.fields.examTimeHint",
										"The exam frees and credits its time only. Leave both empty to release the whole day.",
									)}
								</p>
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
					<div className="space-y-1.5 sm:col-span-2">
						<Label htmlFor="apprentice-release-note">
							{t("settings.apprenticeRelease.fields.note", "Note (optional)")}
						</Label>
						<Input
							id="apprentice-release-note"
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
					</div>
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
