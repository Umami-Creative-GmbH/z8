"use client";

import { IconLoader2, IconMapPin } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	type PositionCaptureAdminData,
	removePositionCaptureAssignmentAction,
	type SavePositionCaptureSettingsInput,
	savePositionCaptureSettingsAction,
	setPositionCaptureAssignmentAction,
} from "@/app/[locale]/(app)/settings/position-capture/actions";
import { positionCaptureErrorMessage } from "@/components/position-capture/error-message";
import { formatRecordedPositionInstant } from "@/components/position-capture/format";
import { PositionNoticeText } from "@/components/position-capture/position-notice-text";
import {
	FeatureSettingsTabs,
	ScopedFeatureAssignments,
} from "@/components/settings/scoped-feature-assignments";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

/** Owner/admin position capture settings (#825): switch, purpose, retention, assignments, notices. */
export function PositionCaptureSettings({
	data,
}: PositionCaptureSettingsProps) {
	return (
		<FeatureSettingsTabs
			settings={
				<>
					<CaptureSettingsForm data={data} />
					<NoticeHistory data={data} />
				</>
			}
			assignments={<CaptureAssignments data={data} />}
		/>
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
							t(
								"settings.positionCapture.saveFailed",
								"Position capture settings were not saved",
							),
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
					toast.success(
						t(
							"settings.positionCapture.saved",
							"Position capture settings saved",
						),
					);
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
							"settings.positionCapture.captureTabDescription",
							"Record an employee's position with their own clock-ins, clock-outs and breaks, only with their consent. Switching capture on applies to nobody until you add an assignment on the Assignments tab.",
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
									aria-label={t(
										"settings.positionCapture.enabled",
										"Capture positions",
									)}
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
											{
												min: POSITION_RETENTION_MIN_DAYS,
												max: POSITION_RETENTION_MAX_DAYS,
											},
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
										value={
											Number.isNaN(field.state.value) ? "" : field.state.value
										}
										onChange={(event) =>
											field.handleChange(event.target.valueAsNumber)
										}
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
						<p
							className="rounded-md border border-dashed p-3 text-sm"
							role="status"
						>
							{t(
								"settings.positionCapture.publishesVersion",
								"Saving publishes notice version {version}. Every existing consent lapses until employees agree again.",
								{ version: (currentNotice?.version ?? 0) + 1 },
							)}
						</p>
					) : null}

					<Button type="submit" disabled={saving}>
						{saving ? (
							<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
						) : null}
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
	return (
		<ScopedFeatureAssignments
			assignments={data.assignments.map((assignment) => ({
				...assignment,
				value: assignment.captureEnabled ? "on" : "off",
			}))}
			organizationLabel={t(
				"settings.positionCapture.targetOrganization",
				"Whole organization",
			)}
			teams={data.teams}
			employees={data.employees}
			options={[
				{
					value: "on",
					label: t("settings.positionCapture.captureOn", "Capture on"),
				},
				{
					value: "off",
					label: t("settings.positionCapture.captureOff", "Capture off"),
				},
			]}
			valueLabel={t("settings.positionCapture.captureTitle", "Capture")}
			description={t(
				"settings.positionCapture.assignmentsDescription",
				"The most specific assignment wins: an employee's own assignment over their primary team's, and a team's over the whole organization's. Use “off” to exclude a team or employee.",
			)}
			onSave={async (target, value) => {
				const result = await setPositionCaptureAssignmentAction({
					target,
					captureEnabled: value === "on",
				});
				if (!result.success) {
					toast.error(
						positionCaptureErrorMessage(t, result.code) ??
							t(
								"settings.positionCapture.assignmentFailed",
								"The assignment was not saved",
							),
					);
					return false;
				}
				toast.success(
					t("settings.positionCapture.assignmentSaved", "Assignment saved"),
				);
				router.refresh();
				return true;
			}}
			onRemove={async (assignmentId) => {
				const result = await removePositionCaptureAssignmentAction({
					assignmentId,
				});
				if (!result.success) {
					toast.error(
						positionCaptureErrorMessage(t, result.code) ??
							t(
								"settings.positionCapture.assignmentRemoveFailed",
								"The assignment was not removed",
							),
					);
					return false;
				}
				toast.success(
					t("settings.positionCapture.assignmentRemoved", "Assignment removed"),
				);
				router.refresh();
				return true;
			}}
		/>
	);
}
function NoticeHistory({ data }: PositionCaptureSettingsProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [current, ...previous] = data.notices;

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.positionCapture.noticeTitle", "Position notice")}
				</CardTitle>
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
						retentionDays={Math.min(
							current.retentionDays,
							data.settings.retentionDays,
						)}
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
							{t(
								"settings.positionCapture.previousVersions",
								"Earlier versions",
							)}
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
												date: formatRecordedPositionInstant(
													locale,
													notice.createdAt,
												),
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
