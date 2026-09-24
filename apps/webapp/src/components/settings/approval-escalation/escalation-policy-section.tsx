"use client";

import { IconAlertTriangle, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useDisplayContext } from "@/hooks/use-display-context";
import type { EscalationManagementOverview } from "@/lib/approvals/escalation/management-overview";
import {
	channelLabel,
	conflictLabel,
	formatEscalationInstant,
} from "./escalation-labels";

export interface EscalationPolicyFormValues {
	enabled: boolean;
	responseWindowHours: number;
	reason: string;
}

export function EscalationOwnershipNotice({
	control,
}: {
	control: EscalationManagementOverview["control"];
}) {
	const { t } = useTranslate();

	if (control.owner === "escalation" && !control.automationPaused) return null;

	return (
		<Alert>
			<IconAlertTriangle className="size-4" aria-hidden="true" />
			<AlertTitle>
				{control.automationPaused
					? t(
							"settings.approvalEscalation.ownership.pausedTitle",
							"Automatic escalation is paused",
						)
					: t(
							"settings.approvalEscalation.ownership.legacyTitle",
							"Channel automation still owns escalation",
						)}
			</AlertTitle>
			<AlertDescription>
				{control.automationPaused
					? t(
							"settings.approvalEscalation.ownership.pausedDescription",
							"No new automatic transfers happen. Existing assignments and delivery recovery are unchanged.",
						)
					: t(
							"settings.approvalEscalation.ownership.legacyDescription",
							"This organization policy is prepared for the switch to shared escalation. Until then, each connected channel keeps using its own escalation settings.",
						)}
			</AlertDescription>
		</Alert>
	);
}

export function EscalationPolicyCard({
	policy,
	isSaving,
	onSubmit,
}: {
	policy: EscalationManagementOverview["policy"];
	isSaving: boolean;
	onSubmit: (values: EscalationPolicyFormValues) => Promise<boolean>;
}) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: {
			enabled: policy.enabled,
			responseWindowHours: policy.responseWindowHours,
			reason: "",
		} satisfies EscalationPolicyFormValues,
		onSubmit: async ({ value, formApi }) => {
			if (await onSubmit(value)) formApi.reset({ ...value, reason: "" });
		},
	});
	const isDirty = useStore(form.store, (state) => state.isDirty);

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1.5">
						<CardTitle>
							{t(
								"settings.approvalEscalation.policy.title",
								"Organization policy",
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.approvalEscalation.policy.description",
								"One response window applies to every approval kind and channel. Channels only deliver messages.",
							)}
						</CardDescription>
					</div>
					<div className="flex shrink-0 gap-2">
						<Badge variant={policy.enabled ? "default" : "secondary"}>
							{policy.enabled
								? t("settings.approvalEscalation.policy.enabled", "Enabled")
								: t("settings.approvalEscalation.policy.disabled", "Disabled")}
						</Badge>
						<Badge variant="outline">
							{t(
								"settings.approvalEscalation.policy.revision",
								"Revision {revision}",
								{
									revision: policy.revision,
								},
							)}
						</Badge>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				<form
					className="space-y-5"
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
				>
					<form.Field name="enabled">
						{(field) => (
							<div className="flex items-start justify-between gap-4">
								<div className="min-w-0 space-y-1">
									<Label htmlFor="escalation-enabled">
										{t(
											"settings.approvalEscalation.policy.enabledLabel",
											"Escalate overdue approvals",
										)}
									</Label>
									<p
										id="escalation-enabled-description"
										className="text-sm text-muted-foreground"
									>
										{t(
											"settings.approvalEscalation.policy.enabledDescription",
											"Replace an overdue approver with an eligible backup manager of the requester.",
										)}
									</p>
								</div>
								<Switch
									id="escalation-enabled"
									checked={field.state.value}
									onCheckedChange={field.handleChange}
									disabled={isSaving}
									aria-describedby="escalation-enabled-description"
									className="shrink-0"
								/>
							</div>
						)}
					</form.Field>

					<div className="h-px bg-border" />

					<form.Field
						name="responseWindowHours"
						validators={{
							onChange: ({ value }) =>
								Number.isInteger(value) && value >= 1 && value <= 720
									? undefined
									: t(
											"settings.approvalEscalation.policy.windowInvalid",
											"Enter a whole number of hours between 1 and 720.",
										),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="escalation-window">
									{t(
										"settings.approvalEscalation.policy.windowLabel",
										"Response window",
									)}
								</Label>
								<div className="flex items-center gap-3">
									<Input
										id="escalation-window"
										name="responseWindowHours"
										type="number"
										inputMode="numeric"
										min={1}
										max={720}
										value={
											Number.isNaN(field.state.value) ? "" : field.state.value
										}
										onChange={(event) =>
											field.handleChange(event.target.valueAsNumber)
										}
										onBlur={field.handleBlur}
										disabled={isSaving}
										autoComplete="off"
										aria-describedby="escalation-window-description"
										aria-invalid={field.state.meta.errors.length > 0}
										className="w-28"
									/>
									<span className="text-sm text-muted-foreground">
										{t("settings.approvalEscalation.policy.hours", "hours")}
									</span>
								</div>
								<p
									id="escalation-window-description"
									className="text-sm text-muted-foreground"
								>
									{t(
										"settings.approvalEscalation.policy.windowDescription",
										"Measured in elapsed hours from when the current assignment became actionable. Changing it moves pending deadlines without restarting their clocks.",
									)}
								</p>
								{field.state.meta.errors.length > 0 ? (
									<p className="text-sm text-destructive" role="alert">
										{field.state.meta.errors.join(" ")}
									</p>
								) : null}
							</div>
						)}
					</form.Field>

					<form.Field name="reason">
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="escalation-reason">
									{t(
										"settings.approvalEscalation.policy.reasonLabel",
										"Reason for change (optional)",
									)}
								</Label>
								<Textarea
									id="escalation-reason"
									name="reason"
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									disabled={isSaving}
									maxLength={500}
									rows={2}
								/>
							</div>
						)}
					</form.Field>

					<div className="flex justify-end">
						<Button type="submit" disabled={isSaving || !isDirty}>
							{isSaving ? (
								<IconLoader2
									className="mr-2 size-4 motion-safe:animate-spin"
									aria-hidden="true"
								/>
							) : null}
							{t("settings.approvalEscalation.policy.save", "Save policy")}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

export function EscalationMigrationCard({
	policy,
	isReviewing,
	onReview,
}: {
	policy: EscalationManagementOverview["policy"];
	isReviewing: boolean;
	onReview: () => void;
}) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	const { provenance } = policy;
	const sourceName = new Map(
		provenance.sources.map((source) => [
			source.sourceId,
			`${channelLabel(source.channel)}${source.displayName ? ` (${source.displayName})` : ""}`,
		]),
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t(
						"settings.approvalEscalation.migration.title",
						"Settings migration",
					)}
				</CardTitle>
				<CardDescription>
					{provenance.outcome === "enabled_from_sources"
						? t(
								"settings.approvalEscalation.migration.enabledOutcome",
								"Enabled because at least one active channel escalated approvals. The shortest active timeout became the response window.",
							)
						: t(
								"settings.approvalEscalation.migration.disabledOutcome",
								"Disabled because no active channel escalated approvals.",
							)}{" "}
					{t(
						"settings.approvalEscalation.migration.migratedAt",
						"Migrated {date}.",
						{
							date: formatEscalationInstant(policy.migratedAt, displayContext),
						},
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{provenance.sources.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.approvalEscalation.migration.noSources",
							"No messaging channels were connected when the policy was migrated.",
						)}
					</p>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>
										{t(
											"settings.approvalEscalation.migration.channel",
											"Channel",
										)}
									</TableHead>
									<TableHead>
										{t(
											"settings.approvalEscalation.migration.status",
											"Status",
										)}
									</TableHead>
									<TableHead>
										{t(
											"settings.approvalEscalation.migration.escalations",
											"Escalations",
										)}
									</TableHead>
									<TableHead className="text-right">
										{t(
											"settings.approvalEscalation.migration.timeout",
											"Timeout",
										)}
									</TableHead>
									<TableHead>
										{t("settings.approvalEscalation.migration.used", "Used")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{provenance.sources.map((source) => (
									<TableRow key={source.sourceId}>
										<TableCell className="font-medium">
											{sourceName.get(source.sourceId)}
										</TableCell>
										<TableCell>{source.setupStatus}</TableCell>
										<TableCell>
											{source.escalationEnabled
												? t("settings.approvalEscalation.on", "On")
												: t("settings.approvalEscalation.off", "Off")}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{t(
												"settings.approvalEscalation.hoursValue",
												"{hours} h",
												{
													hours: source.escalationTimeoutHours,
												},
											)}
										</TableCell>
										<TableCell>
											{source.contributed ? (
												<IconCheck
													className="size-4"
													aria-label={t(
														"settings.approvalEscalation.migration.usedYes",
														"Used",
													)}
												/>
											) : (
												<span className="sr-only">
													{t(
														"settings.approvalEscalation.migration.usedNo",
														"Not used",
													)}
												</span>
											)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}

				{provenance.conflicts.length > 0 ? (
					<div className="space-y-3 rounded-lg border p-4">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<h3 className="text-sm font-medium">
								{t(
									"settings.approvalEscalation.migration.conflictsTitle",
									"Conflicting settings",
								)}
							</h3>
							{policy.conflictReviewStatus === "pending" ? (
								<Button
									size="sm"
									variant="outline"
									onClick={onReview}
									disabled={isReviewing}
								>
									{isReviewing ? (
										<IconLoader2
											className="mr-2 size-4 motion-safe:animate-spin"
											aria-hidden="true"
										/>
									) : null}
									{t(
										"settings.approvalEscalation.migration.markReviewed",
										"Mark as reviewed",
									)}
								</Button>
							) : (
								<Badge variant="secondary">
									{policy.conflictReviewedAt
										? t(
												"settings.approvalEscalation.migration.reviewedBy",
												"Reviewed by {name} on {date}",
												{
													name: policy.conflictReviewedByName ?? "—",
													date: formatEscalationInstant(
														policy.conflictReviewedAt,
														displayContext,
													),
												},
											)
										: t(
												"settings.approvalEscalation.migration.reviewed",
												"Reviewed",
											)}
								</Badge>
							)}
						</div>
						<ul className="space-y-2 text-sm">
							{provenance.conflicts.map((conflict) => (
								<li key={conflict.code}>
									<p>{conflictLabel(conflict.code, t)}</p>
									<p className="text-muted-foreground">
										{conflict.sourceIds
											.map((id) => sourceName.get(id) ?? id)
											.join(", ")}
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

export function EscalationChannelsCard({
	channels,
	responseWindowHours,
}: {
	channels: EscalationManagementOverview["channels"];
	responseWindowHours: number;
}) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t(
						"settings.approvalEscalation.channels.title",
						"Channel delivery preferences",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.approvalEscalation.channels.description",
						"Each channel's escalation toggle decides whether it delivers escalation messages. Channel timeouts are not deadlines once the organization policy owns escalation.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{channels.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.approvalEscalation.channels.none",
							"No messaging channels are connected.",
						)}
					</p>
				) : (
					<div className="overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>
										{t(
											"settings.approvalEscalation.migration.channel",
											"Channel",
										)}
									</TableHead>
									<TableHead>
										{t(
											"settings.approvalEscalation.channels.delivers",
											"Delivers escalations",
										)}
									</TableHead>
									<TableHead className="text-right">
										{t(
											"settings.approvalEscalation.channels.legacyTimeout",
											"Channel timeout",
										)}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{channels.map((channel) => (
									<TableRow key={channel.sourceId}>
										<TableCell className="font-medium">
											{channelLabel(channel.channel)}
											{channel.displayName ? (
												<span className="text-muted-foreground">
													{" "}
													({channel.displayName})
												</span>
											) : null}
											{!channel.active ? (
												<Badge variant="secondary" className="ml-2">
													{t(
														"settings.approvalEscalation.channels.inactive",
														"Inactive",
													)}
												</Badge>
											) : null}
										</TableCell>
										<TableCell>
											{channel.deliversEscalations
												? t("settings.approvalEscalation.on", "On")
												: t("settings.approvalEscalation.off", "Off")}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{t(
												"settings.approvalEscalation.hoursValue",
												"{hours} h",
												{
													hours: channel.legacyTimeoutHours,
												},
											)}
											{channel.legacyTimeoutDiffers ? (
												<Badge variant="outline" className="ml-2">
													{t(
														"settings.approvalEscalation.channels.differs",
														"Differs from {hours} h policy",
														{ hours: responseWindowHours },
													)}
												</Badge>
											) : null}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export function EscalationRevisionsCard({
	revisions,
}: {
	revisions: EscalationManagementOverview["revisions"];
}) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.approvalEscalation.revisions.title", "Policy history")}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="text-right">
									{t(
										"settings.approvalEscalation.revisions.revision",
										"Revision",
									)}
								</TableHead>
								<TableHead>
									{t("settings.approvalEscalation.revisions.policy", "Policy")}
								</TableHead>
								<TableHead>
									{t(
										"settings.approvalEscalation.revisions.changedBy",
										"Changed by",
									)}
								</TableHead>
								<TableHead>
									{t("settings.approvalEscalation.revisions.when", "When")}
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{revisions.map((revision) => (
								<TableRow key={revision.revision}>
									<TableCell className="text-right tabular-nums">
										{revision.revision}
									</TableCell>
									<TableCell>
										<span>
											{revision.enabled
												? t(
														"settings.approvalEscalation.policy.enabled",
														"Enabled",
													)
												: t(
														"settings.approvalEscalation.policy.disabled",
														"Disabled",
													)}
											{" · "}
											{t(
												"settings.approvalEscalation.hoursValue",
												"{hours} h",
												{
													hours: revision.responseWindowHours,
												},
											)}
										</span>
										{revision.reason &&
										revision.origin === "management_edit" ? (
											<p className="break-words text-sm text-muted-foreground">
												{revision.reason}
											</p>
										) : null}
									</TableCell>
									<TableCell>
										{revision.origin === "migration"
											? t(
													"settings.approvalEscalation.revisions.migration",
													"Settings migration",
												)
											: (revision.changedByName ?? "—")}
									</TableCell>
									<TableCell className="whitespace-nowrap">
										{formatEscalationInstant(
											revision.createdAt,
											displayContext,
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</CardContent>
		</Card>
	);
}
