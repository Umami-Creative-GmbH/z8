"use client";

import { IconLoader2, IconMapPin, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	type PositionCaptureAdminData,
	type PositionCaptureAssignmentData,
	removePositionCaptureAssignmentAction,
	type SavePositionCaptureSettingsInput,
	savePositionCaptureSettingsAction,
	setPositionCaptureAssignmentAction,
} from "@/app/[locale]/(app)/settings/position-capture/actions";
import { positionCaptureErrorMessage } from "@/components/position-capture/error-message";
import { formatRecordedPositionInstant } from "@/components/position-capture/format";
import { PositionNoticeText } from "@/components/position-capture/position-notice-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
	POSITION_PURPOSE_MAX_LENGTH,
	POSITION_RETENTION_MAX_DAYS,
	POSITION_RETENTION_MIN_DAYS,
	requiresNewNoticeVersion,
} from "@/lib/time-tracking/position-capture/policy";

interface PositionCaptureSettingsProps {
	data: PositionCaptureAdminData;
}

type AssignmentTargetType = "organization" | "team" | "employee";

/** Owner/admin position capture settings (#825): switch, purpose, retention, assignments, notices. */
export function PositionCaptureSettings({ data }: PositionCaptureSettingsProps) {
	return (
		<div className="space-y-6">
			<CaptureSettingsForm data={data} />
			<CaptureAssignments data={data} />
			<NoticeHistory data={data} />
		</div>
	);
}

function CaptureSettingsForm({ data }: PositionCaptureSettingsProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [saving, setSaving] = useState(false);
	const currentNotice = data.notices[0] ?? null;

	const form = useForm({
		defaultValues: {
			enabled: data.settings.enabled,
			purposeStatement: data.settings.purposeStatement ?? "",
			retentionDays: data.settings.retentionDays,
		} satisfies Omit<SavePositionCaptureSettingsInput, "purposeStatement"> & {
			purposeStatement: string;
		},
		onSubmit: async ({ value }) => {
			setSaving(true);
			await (async () => {
				const result = await savePositionCaptureSettingsAction({
					enabled: value.enabled,
					purposeStatement: value.purposeStatement,
					retentionDays: value.retentionDays,
				});
				if (!result.success) {
					toast.error(
						positionCaptureErrorMessage(t, result.code) ??
							t("settings.positionCapture.saveFailed", "Position capture settings were not saved"),
					);
					return;
				}
				if (result.data.publishedNoticeVersion !== null) {
					toast.success(
						t(
							"settings.positionCapture.savedWithNotice",
							"Settings saved. Notice version {version} is published; employees are asked to agree to it.",
							{ version: result.data.publishedNoticeVersion },
						),
					);
				} else {
					toast.success(t("settings.positionCapture.saved", "Position capture settings saved"));
				}
				router.refresh();
			})().finally(() => {
				setSaving(false);
			});
		},
	});
	const values = useStore(form.store, (state) => state.values);
	const publishesVersion =
		requiresNewNoticeVersion(currentNotice, {
			purposeStatement: values.purposeStatement.trim() || null,
			retentionDays: values.retentionDays,
		}) && currentNotice !== null;

	return (
		// Client-side TanStack Form submit (docs/refs/forms.md); the settings page needs JS.
		// react-doctor-disable-next-line react-doctor/no-prevent-default
		<form
			className="space-y-6"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconMapPin className="size-5" aria-hidden="true" />
						{t("settings.positionCapture.captureTitle", "Capture")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.positionCapture.captureDescription",
							"Record an employee's position with their own clock-ins, clock-outs and breaks, only with their consent. Switching capture on applies to nobody until you assign it below.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5">
					<form.Field name="enabled">
						{(field) => (
							<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
								<div className="min-w-0 space-y-1">
									<div className="font-medium">
										{t("settings.positionCapture.enabled", "Capture positions")}
									</div>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.positionCapture.enabledDescription",
											"Switching this off stops capture for everyone. Recorded positions stay until their deletion date.",
										)}
									</p>
								</div>
								<Switch
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={saving}
									aria-label={t("settings.positionCapture.enabled", "Capture positions")}
								/>
							</div>
						)}
					</form.Field>

					<form.Field
						name="purposeStatement"
						validators={{
							onSubmit: ({ value, fieldApi }) =>
								fieldApi.form.getFieldValue("enabled") && !value.trim()
									? t(
											"settings.positionCapture.purposeRequired",
											"Write a purpose statement before switching capture on.",
										)
									: undefined,
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.positionCapture.purpose", "Purpose statement")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Textarea
										name="purposeStatement"
										rows={4}
										maxLength={POSITION_PURPOSE_MAX_LENGTH}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										disabled={saving}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.positionCapture.purposeDescription",
										"Shown to employees in the position notice. Explain why your organization records positions.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<form.Field
						name="retentionDays"
						validators={{
							onSubmit: ({ value }) =>
								!Number.isInteger(value) ||
								value < POSITION_RETENTION_MIN_DAYS ||
								value > POSITION_RETENTION_MAX_DAYS
									? t(
											"settings.positionCapture.retentionRange",
											"Enter a whole number of days between {min} and {max}.",
											{ min: POSITION_RETENTION_MIN_DAYS, max: POSITION_RETENTION_MAX_DAYS },
										)
									: undefined,
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.positionCapture.retention", "Retention (days)")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Input
										name="retentionDays"
										type="number"
										inputMode="numeric"
										autoComplete="off"
										min={POSITION_RETENTION_MIN_DAYS}
										max={POSITION_RETENTION_MAX_DAYS}
										className="max-w-40"
										value={Number.isNaN(field.state.value) ? "" : field.state.value}
										onChange={(event) => field.handleChange(event.target.valueAsNumber)}
										onBlur={field.handleBlur}
										disabled={saving}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.positionCapture.retentionDescription",
										"Each position is deleted this many days after it was recorded. Shortening it also brings existing deletion dates forward.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					{publishesVersion ? (
						<p className="rounded-md border border-dashed p-3 text-sm" role="status">
							{t(
								"settings.positionCapture.publishesVersion",
								"Saving publishes notice version {version}. Every existing consent lapses until employees agree again.",
								{ version: (currentNotice?.version ?? 0) + 1 },
							)}
						</p>
					) : null}

					<Button type="submit" disabled={saving}>
						{saving ? <IconLoader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
						{t("settings.positionCapture.save", "Save settings")}
					</Button>
				</CardContent>
			</Card>
		</form>
	);
}

function CaptureAssignments({ data }: PositionCaptureSettingsProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const teamNames = new Map(data.teams.map((team) => [team.id, team.name]));
	const employeeNames = new Map(data.employees.map((employee) => [employee.id, employee.name]));

	const form = useForm({
		defaultValues: {
			targetType: "team" as AssignmentTargetType,
			teamId: "",
			employeeId: "",
			captureEnabled: true,
		},
		onSubmit: async ({ value, formApi }) => {
			setPending(true);
			await (async () => {
				const target =
					value.targetType === "organization"
						? ({ type: "organization" } as const)
						: value.targetType === "team"
							? ({ type: "team", teamId: value.teamId } as const)
							: ({ type: "employee", employeeId: value.employeeId } as const);
				const result = await setPositionCaptureAssignmentAction({
					target,
					captureEnabled: value.captureEnabled,
				});
				if (result.success) {
					toast.success(t("settings.positionCapture.assignmentSaved", "Assignment saved"));
					formApi.reset();
					router.refresh();
				} else {
					toast.error(
						positionCaptureErrorMessage(t, result.code) ??
							t("settings.positionCapture.assignmentFailed", "The assignment was not saved"),
					);
				}
			})().finally(() => {
				setPending(false);
			});
		},
	});
	const targetType = useStore(form.store, (state) => state.values.targetType);
	const teamId = useStore(form.store, (state) => state.values.teamId);
	const employeeId = useStore(form.store, (state) => state.values.employeeId);
	const canAdd =
		!pending &&
		(targetType === "organization" ||
			(targetType === "team" && teamId !== "") ||
			(targetType === "employee" && employeeId !== ""));

	const remove = async (assignment: PositionCaptureAssignmentData) => {
		setPending(true);
		await (async () => {
			const result = await removePositionCaptureAssignmentAction({ assignmentId: assignment.id });
			if (result.success) {
				toast.success(t("settings.positionCapture.assignmentRemoved", "Assignment removed"));
				router.refresh();
			} else {
				toast.error(
					positionCaptureErrorMessage(t, result.code) ??
						t("settings.positionCapture.assignmentRemoveFailed", "The assignment was not removed"),
				);
			}
		})().finally(() => {
			setPending(false);
		});
	};

	const targetLabel = (assignment: PositionCaptureAssignmentData) =>
		assignment.assignmentType === "organization"
			? t("settings.positionCapture.targetOrganization", "Whole organization")
			: assignment.assignmentType === "team"
				? t("settings.positionCapture.targetTeamLabel", "Team: {name}", {
						name: teamNames.get(assignment.teamId ?? "") ?? assignment.teamId ?? "",
					})
				: t("settings.positionCapture.targetEmployeeLabel", "Employee: {name}", {
						name: employeeNames.get(assignment.employeeId ?? "") ?? assignment.employeeId ?? "",
					});

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.positionCapture.assignmentsTitle", "Who capture applies to")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.positionCapture.assignmentsDescription",
						"The most specific assignment wins: an employee's own assignment over their primary team's, and a team's over the whole organization's. Use “off” to exclude a team or employee.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				{data.assignments.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.positionCapture.noAssignments",
							"Nobody is assigned. Capture applies to nobody until you assign it.",
						)}
					</p>
				) : (
					<ul
						className="divide-y rounded-md border"
						aria-label={t("settings.positionCapture.assignmentsList", "Capture assignments")}
					>
						{data.assignments.map((assignment) => (
							<li key={assignment.id} className="flex items-center justify-between gap-3 p-3">
								<div className="flex min-w-0 flex-wrap items-center gap-2">
									<span className="truncate text-sm font-medium">{targetLabel(assignment)}</span>
									<Badge variant={assignment.captureEnabled ? "default" : "secondary"}>
										{assignment.captureEnabled
											? t("settings.positionCapture.captureOn", "Capture on")
											: t("settings.positionCapture.captureOff", "Capture off")}
									</Badge>
								</div>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() => void remove(assignment)}
									disabled={pending}
									aria-label={t("settings.positionCapture.removeAssignment", "Remove {target}", {
										target: targetLabel(assignment),
									})}
								>
									<IconTrash className="size-4" aria-hidden="true" />
								</Button>
							</li>
						))}
					</ul>
				)}

				{/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
				<form
					className="grid gap-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-end"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field name="targetType">
						{(field) => (
							<TFormItem>
								<TFormLabel>{t("settings.positionCapture.targetType", "Applies to")}</TFormLabel>
								<Select
									name="targetType"
									value={field.state.value}
									onValueChange={(value: AssignmentTargetType) => field.handleChange(value)}
									disabled={pending}
								>
									<TFormControl>
										<SelectTrigger className="h-10 w-full" onBlur={field.handleBlur}>
											<SelectValue />
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										<SelectItem value="team">
											{t("settings.positionCapture.targetTeam", "A team")}
										</SelectItem>
										<SelectItem value="employee">
											{t("settings.positionCapture.targetEmployee", "An employee")}
										</SelectItem>
										<SelectItem value="organization">
											{t("settings.positionCapture.targetOrganization", "Whole organization")}
										</SelectItem>
									</SelectContent>
								</Select>
							</TFormItem>
						)}
					</form.Field>

					{targetType === "team" ? (
						<form.Field name="teamId">
							{(field) => (
								<TFormItem>
									<TFormLabel>{t("settings.positionCapture.team", "Team")}</TFormLabel>
									<Select
										name="teamId"
										value={field.state.value || null}
										onValueChange={(value: string | null) => field.handleChange(value ?? "")}
										disabled={pending}
									>
										<TFormControl>
											<SelectTrigger className="h-10 w-full" onBlur={field.handleBlur}>
												<SelectValue
													placeholder={t("settings.positionCapture.selectTeam", "Select a team")}
												/>
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											{data.teams.map((team) => (
												<SelectItem key={team.id} value={team.id}>
													{team.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>
					) : targetType === "employee" ? (
						<form.Field name="employeeId">
							{(field) => (
								<TFormItem>
									<TFormLabel>{t("settings.positionCapture.employee", "Employee")}</TFormLabel>
									<Select
										name="employeeId"
										value={field.state.value || null}
										onValueChange={(value: string | null) => field.handleChange(value ?? "")}
										disabled={pending}
									>
										<TFormControl>
											<SelectTrigger className="h-10 w-full" onBlur={field.handleBlur}>
												<SelectValue
													placeholder={t(
														"settings.positionCapture.selectEmployee",
														"Select an employee",
													)}
												/>
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											{data.employees.map((employee) => (
												<SelectItem key={employee.id} value={employee.id}>
													{employee.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>
					) : (
						<div />
					)}

					<form.Field name="captureEnabled">
						{(field) => (
							<div className="flex h-10 items-center gap-2">
								<Switch
									id="position-capture-assignment-enabled"
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={pending}
								/>
								<Label htmlFor="position-capture-assignment-enabled">
									{field.state.value
										? t("settings.positionCapture.captureOn", "Capture on")
										: t("settings.positionCapture.captureOff", "Capture off")}
								</Label>
							</div>
						)}
					</form.Field>

					<Button type="submit" disabled={!canAdd}>
						{t("settings.positionCapture.addAssignment", "Add assignment")}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}

function NoticeHistory({ data }: PositionCaptureSettingsProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [current, ...previous] = data.notices;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.positionCapture.noticeTitle", "Position notice")}</CardTitle>
				<CardDescription>
					{t(
						"settings.positionCapture.noticeDescription",
						"What employees agree to: Z8's fixed text and your purpose statement. Editing the purpose or keeping positions longer publishes a new version; shortening retention does not.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				{current ? (
					<PositionNoticeText
						version={current.version}
						purposeStatement={current.purposeStatement}
						retentionDays={Math.min(current.retentionDays, data.settings.retentionDays)}
					/>
				) : (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.positionCapture.noNotice",
							"No notice is published yet. Saving a purpose statement publishes version 1.",
						)}
					</p>
				)}
				{previous.length > 0 ? (
					<div className="space-y-2">
						<h3 className="text-sm font-medium">
							{t("settings.positionCapture.previousVersions", "Earlier versions")}
						</h3>
						<ul className="divide-y rounded-md border text-sm">
							{previous.map((notice) => (
								<li key={notice.id} className="space-y-1 p-3">
									<p className="font-medium">
										{t(
											"settings.positionCapture.versionSummary",
											"Version {version}, published {date}, kept {days, plural, one {# day} other {# days}}",
											{
												version: notice.version,
												date: formatRecordedPositionInstant(locale, notice.createdAt),
												days: notice.retentionDays,
											},
										)}
									</p>
									<p className="whitespace-pre-line break-words text-muted-foreground">
										{notice.purposeStatement}
									</p>
								</li>
							))}
						</ul>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
