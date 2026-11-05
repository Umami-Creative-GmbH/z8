"use client";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
	EquipmentChange,
	EquipmentRetentionView,
} from "@/lib/organization/equipment/contracts";
import { useCommandIdentity } from "./equipment-handovers";

type RetentionAssignment = Pick<
	EquipmentAssignmentView,
	"id" | "revision" | "retention" | "caseHolds"
>;
type Props = {
	assignment: RetentionAssignment;
	timezone: string;
	canAdminister: boolean;
	pending: boolean;
	submit: (change: EquipmentChange) => Promise<void>;
};
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
		<section
			className="space-y-3 border-t pt-3"
			aria-label={t("settings.equipment.retention.title", "Record retention")}
		>
			<h4 className="text-sm font-medium">
				{t("settings.equipment.retention.title", "Record retention")}
			</h4>
			<RetentionStatus retention={retention} />
			<p className="text-sm text-muted-foreground">
				{t("settings.equipment.retention.activity", "Latest activity")}:{" "}
				{date(retention.lastActivityAt)} · {timezone}
			</p>
			{retention.expiresAt &&
			!retention.caseHeld &&
			retention.status !== "outstanding" ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.equipment.retention.expiry",
						"Eligible for cleanup from",
					)}
					: {date(retention.expiresAt)} · {timezone}
				</p>
			) : null}
			{assignment.caseHolds?.length ? (
				<details>
					<summary className="cursor-pointer text-sm focus-visible:ring-2 focus-visible:ring-ring">
						{t("settings.equipment.retention.history", "Case hold history")}
					</summary>
					<ol className="mt-2 space-y-2 text-sm">
						{assignment.caseHolds.map((event) => (
							<li key={event.id} className="break-words">
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
								<p className="whitespace-pre-wrap">{event.reason}</p>
							</li>
						))}
					</ol>
				</details>
			) : null}
			{canAdminister ? (
				editing ? (
					<CaseHoldForm
						key={`${assignment.id}:${assignment.revision}`}
						assignment={assignment}
						pending={pending}
						submit={submit}
						onCancel={() => setEditing(false)}
					/>
				) : (
					<Button
						variant="outline"
						disabled={pending}
						onClick={() => setEditing(true)}
					>
						{retention.caseHeld
							? t("settings.equipment.retention.release", "Release case hold")
							: t("settings.equipment.retention.place", "Place case hold")}
					</Button>
				)
			) : null}
		</section>
	);
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
	return <p className="text-sm text-muted-foreground">{message}</p>;
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
		<form
			ref={element}
			noValidate
			className="space-y-3"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.retention.holdHelp",
					"Document the specific case. A hold protects personal evidence; releasing it restarts retention from this action. Neither action records a physical return.",
				)}
			</p>
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
			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={pending}>
					{held
						? t(
								"settings.equipment.retention.confirmRelease",
								"Confirm release",
							)
						: t("settings.equipment.retention.confirmHold", "Confirm hold")}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={pending}
					onClick={onCancel}
				>
					{t("settings.equipment.retention.cancel", "Cancel")}
				</Button>
			</div>
		</form>
	);
}
