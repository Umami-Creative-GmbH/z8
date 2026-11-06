"use client";
import { IconLock, IconLockOpen } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRef, useState } from "react";
import { ActionPanel, ActionPanelContent } from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type {
	EquipmentAssignmentView,
	EquipmentRetentionView,
} from "@/lib/organization/equipment/contracts";
import {
	EquipmentFormPanel,
	type SubmitHandover,
	useCommandIdentity,
} from "./equipment-handovers";

type RetentionAssignment = Pick<
	EquipmentAssignmentView,
	"id" | "revision" | "retention" | "caseHolds"
>;
type Props = {
	assignment: RetentionAssignment;
	timezone: string;
	canAdminister: boolean;
	pending: boolean;
	submit: SubmitHandover;
};

/** Record retention of one assignment: why it is kept, until when, and its case holds. */
export function EquipmentRetention({
	assignment,
	timezone,
	canAdminister,
	pending,
	submit,
}: Props) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [editing, setEditing] = useState(false);
	const retention = assignment.retention;
	if (!retention) return null;
	const date = (instant: string) =>
		parseInstant(instant)
			.toZonedDateTimeISO(timezone)
			.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
	return (
		<Card
			className="gap-4"
			aria-label={t("settings.equipment.retention.title", "Record retention")}
			role="region"
		>
			<CardHeader className="flex flex-row items-start justify-between gap-3">
				<h2 className="font-semibold leading-none">
					{t("settings.equipment.retention.title", "Record retention")}
				</h2>
				<RetentionBadge retention={retention} />
			</CardHeader>
			<CardContent className="space-y-3 text-sm">
				<RetentionStatus retention={retention} />
				<dl className="space-y-2">
					<div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
						<dt className="text-muted-foreground">
							{t("settings.equipment.retention.activity", "Latest activity")}
						</dt>
						<dd className="tabular-nums">
							<time dateTime={retention.lastActivityAt}>
								{date(retention.lastActivityAt)}
							</time>
						</dd>
					</div>
					{retention.expiresAt &&
					!retention.caseHeld &&
					retention.status !== "outstanding" ? (
						<div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
							<dt className="text-muted-foreground">
								{t(
									"settings.equipment.retention.expiry",
									"Eligible for cleanup from",
								)}
							</dt>
							<dd className="tabular-nums">
								<time dateTime={retention.expiresAt}>
									{date(retention.expiresAt)}
								</time>
							</dd>
						</div>
					) : null}
					<div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
						<dt className="text-muted-foreground">
							{t("settings.equipment.retention.caseHold", "Case hold")}
						</dt>
						<dd>
							{retention.caseHeld
								? t("settings.equipment.retention.caseHoldActive", "Active")
								: t("settings.equipment.retention.caseHoldNone", "None")}
						</dd>
					</div>
				</dl>
				<p className="text-xs text-muted-foreground">
					<span translate="no">{timezone}</span>
				</p>
				{assignment.caseHolds?.length ? (
					<details className="border-t pt-3">
						<summary className="cursor-pointer font-medium focus-visible:ring-2 focus-visible:ring-ring">
							{t("settings.equipment.retention.history", "Case hold history")}
						</summary>
						<ol className="mt-2 space-y-3">
							{assignment.caseHolds.map((event) => (
								<li key={event.id} className="break-words">
									<p>
										{event.kind === "place"
											? t("settings.equipment.retention.placed", "Hold placed")
											: t(
													"settings.equipment.retention.released",
													"Hold released",
												)}{" "}
										·{" "}
										{event.actorName ??
											t(
												"settings.equipment.retention.unavailableActor",
												"Former account",
											)}{" "}
										· {date(event.recordedAt)}
									</p>
									<p className="whitespace-pre-wrap text-muted-foreground">
										{event.reason}
									</p>
								</li>
							))}
						</ol>
					</details>
				) : null}
				{canAdminister ? (
					<Button
						variant="outline"
						size="sm"
						disabled={pending}
						onClick={() => setEditing(true)}
					>
						{retention.caseHeld ? (
							<IconLockOpen className="size-4" aria-hidden="true" />
						) : (
							<IconLock className="size-4" aria-hidden="true" />
						)}
						{retention.caseHeld
							? t("settings.equipment.retention.release", "Release case hold")
							: t("settings.equipment.retention.place", "Place case hold")}
					</Button>
				) : null}
			</CardContent>
			{canAdminister ? (
				<ActionPanel
					open={editing}
					onOpenChange={(open) => {
						if (!open && !pending) setEditing(false);
					}}
				>
					<ActionPanelContent size="compact">
						<CaseHoldForm
							key={`${assignment.id}:${assignment.revision}`}
							assignment={assignment}
							pending={pending}
							submit={async (change) => {
								const saved = await submit(change);
								if (saved) setEditing(false);
								return saved;
							}}
							onCancel={() => setEditing(false)}
						/>
					</ActionPanelContent>
				</ActionPanel>
			) : null}
		</Card>
	);
}

function RetentionBadge({ retention }: { retention: EquipmentRetentionView }) {
	const { t } = useTranslate();
	if (retention.caseHeld)
		return (
			<Badge variant="outline">
				{t("settings.equipment.retention.badgeHeld", "Case hold")}
			</Badge>
		);
	switch (retention.status) {
		case "outstanding":
			return (
				<Badge variant="outline">
					{t("settings.equipment.retention.badgeOutstanding", "Outstanding")}
				</Badge>
			);
		case "due":
			return (
				<Badge variant="secondary">
					{t("settings.equipment.retention.badgeDue", "Awaiting cleanup")}
				</Badge>
			);
		case "policy_required":
			return (
				<Badge variant="outline">
					{t("settings.equipment.retention.badgePolicy", "No policy")}
				</Badge>
			);
		default:
			return (
				<Badge variant="secondary">
					{t("settings.equipment.retention.badgeRetained", "Retained")}
				</Badge>
			);
	}
}

function RetentionStatus({ retention }: { retention: EquipmentRetentionView }) {
	const { t } = useTranslate();
	let message: string;
	if (retention.caseHeld)
		message = t(
			"settings.equipment.retention.held",
			"Protected by a documented case hold.",
		);
	else if (retention.status === "outstanding")
		message = t(
			"settings.equipment.retention.outstanding",
			"Protected while a required return remains outstanding.",
		);
	else if (retention.status === "due")
		message = t(
			"settings.equipment.retention.due",
			"Retention expired. Personal history is awaiting cleanup.",
		);
	else
		message = t(
			"settings.equipment.retention.retained",
			"Closed personal history follows the organization’s configured retention policy.",
		);
	return <p className="text-muted-foreground">{message}</p>;
}

function CaseHoldForm({
	assignment,
	pending,
	submit,
	onCancel,
}: Pick<Props, "assignment" | "pending" | "submit"> & {
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const element = useRef<HTMLFormElement>(null);
	const identity = useCommandIdentity();
	const held = assignment.retention?.caseHeld;
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmitInvalid: () =>
			element.current
				?.querySelector<HTMLElement>('[aria-invalid="true"]')
				?.focus(),
		onSubmit: async ({ value }) => {
			const payload = {
				kind: held
					? ("release_case_hold" as const)
					: ("place_case_hold" as const),
				assignmentId: assignment.id,
				expectedRevision: assignment.revision,
				reason: value.reason.trim(),
			};
			await submit({ ...payload, requestId: identity(payload) });
		},
	});
	return (
		<EquipmentFormPanel
			element={element}
			pending={pending}
			onCancel={onCancel}
			onSubmit={() => void form.handleSubmit()}
			title={
				held
					? t("settings.equipment.retention.release", "Release case hold")
					: t("settings.equipment.retention.place", "Place case hold")
			}
			description={t(
				"settings.equipment.retention.holdHelp",
				"Document the specific case. A hold protects personal evidence; releasing it restarts retention from this action. Neither action records a physical return.",
			)}
			submitLabel={
				held
					? t("settings.equipment.retention.confirmRelease", "Confirm release")
					: t("settings.equipment.retention.confirmHold", "Confirm hold")
			}
		>
			<form.Field
				name="reason"
				validators={{
					onSubmit: ({ value }) =>
						!value.trim()
							? t(
									"settings.equipment.retention.reasonRequired",
									"Enter a reason for this case hold action.",
								)
							: undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel required>
							{t("settings.equipment.retention.reason", "Reason")}
						</TFormLabel>
						<TFormControl hasError={field.state.meta.errors.length > 0}>
							<Textarea
								name={field.name}
								autoComplete="off"
								value={field.state.value}
								maxLength={4000}
								disabled={pending}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
		</EquipmentFormPanel>
	);
}
