"use client";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { changeEquipment } from "@/lib/organization/equipment/actions";
import type {
	EquipmentChange,
	EquipmentCondition,
	EquipmentReadinessItemView,
} from "@/lib/organization/equipment/contracts";
import { useRouter } from "@/navigation";
import { conditionLabel, handoverRefusalMessage } from "./equipment-copy";
import { actualDateError } from "./equipment-handover-validation";
import {
	ActualDateField,
	ConditionField,
	useCommandIdentity,
} from "./equipment-handovers";
/** The server derives both actors from their authenticated commands; the form supplies no witness identity. */
export function EquipmentAnonymousReceipt({
	item,
	today,
	timezone,
}: {
	item: EquipmentReadinessItemView;
	today: string;
	timezone: string;
}) {
	const { t } = useTranslate();
	const { pending, feedback, send } = useAnonymousReceiptCommands();
	const [open, setOpen] = useState(false);
	const formElement = useRef<HTMLFormElement>(null);
	const form = useForm({
		onSubmitInvalid: () =>
			formElement.current
				?.querySelector<HTMLElement>('[aria-invalid="true"]')
				?.focus(),
		defaultValues: {
			actualDate: "",
			condition: "unknown" as EquipmentCondition,
		},
		onSubmit: ({ value }) =>
			send({
				kind: "propose_custody_receipt",
				itemId: item.id,
				expectedRevision: item.revision,
				...value,
			}),
	});
	const receipt = item.custodyReceipt;
	if (!item.canProposeCustodyReceipt && !receipt) return null;
	return (
		<div className="min-w-0 space-y-3 break-words border-t pt-3">
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.anonymous.help",
					"The former holder's personal history was removed. A different authorized staff member must confirm this physical receipt before custody is released.",
				)}
			</p>
			{receipt ? (
				<CustodyReceiptEvidence receipt={receipt} timezone={timezone} />
			) : null}

			{receipt?.canConfirm ? (
				<Button
					disabled={pending || feedback?.error === false}
					onClick={() =>
						send({
							kind: "confirm_custody_receipt",
							itemId: item.id,
							proposalId: receipt.id,
							expectedRevision: item.revision,
						})
					}
				>
					{t(
						"settings.equipment.anonymous.confirm",
						"Confirm physical receipt",
					)}
				</Button>
			) : null}
			{item.canProposeCustodyReceipt && !open ? (
				<Button
					variant="outline"
					disabled={pending}
					onClick={() => setOpen(true)}
				>
					{t(
						"settings.equipment.anonymous.propose",
						"Propose physical receipt",
					)}
				</Button>
			) : null}
			{open ? (
				<form
					ref={formElement}
					noValidate
					className="space-y-3"
					onSubmit={(e) => {
						e.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field
						name="actualDate"
						validators={{
							onSubmit: ({ value }) => actualDateError(value, today, t),
						}}
					>
						{(field) => (
							<ActualDateField
								field={field}
								today={today}
								pending={pending}
								t={t}
							/>
						)}
					</form.Field>
					<form.Field name="condition">
						{(field) => (
							<ConditionField
								value={field.state.value}
								onChange={field.handleChange}
								disabled={pending}
								t={t}
							/>
						)}
					</form.Field>
					<div className="flex flex-wrap gap-2">
						<Button
							type="submit"
							disabled={pending || feedback?.error === false}
						>
							{t(
								"settings.equipment.anonymous.saveProposal",
								"Record receipt proposal",
							)}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={pending}
							onClick={() => setOpen(false)}
						>
							{t("common.cancel", "Cancel")}
						</Button>
					</div>
				</form>
			) : null}
			{feedback ? (
				<p
					role={feedback.error ? "alert" : "status"}
					className={
						feedback.error
							? "text-sm text-destructive"
							: "text-sm text-muted-foreground"
					}
				>
					{feedback.text}
				</p>
			) : null}
		</div>
	);
}

function useAnonymousReceiptCommands() {
	const { t } = useTranslate();
	const router = useRouter();

	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<{
		error: boolean;
		text: string;
	} | null>(null);
	const identity = useCommandIdentity();
	const send = (
		payload:
			| Omit<
					Extract<EquipmentChange, { kind: "confirm_custody_receipt" }>,
					"requestId"
			  >
			| Omit<
					Extract<EquipmentChange, { kind: "propose_custody_receipt" }>,
					"requestId"
			  >,
	) =>
		startTransition(async () => {
			setFeedback(null);
			try {
				const result = await changeEquipment({
					...payload,
					requestId: identity(payload),
				});
				if (!result.success) {
					setFeedback({
						error: true,
						text: t(
							"settings.equipment.anonymous.failed",
							"Receipt could not be confirmed. Retry unchanged or reload equipment.",
						),
					});
					return;
				}
				if (!result.data.ok) {
					setFeedback({
						error: true,
						text: handoverRefusalMessage(result.data.reason, t),
					});
					return;
				}
				setFeedback({
					error: false,
					text: t(
						"settings.equipment.anonymous.saved",
						"Receipt evidence recorded. Reloading equipment…",
					),
				});
				router.refresh();
			} catch {
				setFeedback({
					error: true,
					text: t(
						"settings.equipment.anonymous.failed",
						"Receipt could not be confirmed. Retry unchanged or reload equipment.",
					),
				});
			}
		});

	return { pending, feedback, send };
}
function CustodyReceiptEvidence({
	receipt,
	timezone,
}: {
	receipt: NonNullable<EquipmentReadinessItemView["custodyReceipt"]>;
	timezone: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const auditDate = (value: string) =>
		parseInstant(value)
			.toZonedDateTimeISO(timezone)
			.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
	return (
		<div className="space-y-1 text-sm">
			<p>
				{receipt.confirmedAt
					? t(
							"settings.equipment.anonymous.confirmed",
							"Physical receipt independently confirmed",
						)
					: t(
							"settings.equipment.anonymous.pending",
							"Receipt awaiting independent confirmation",
						)}{" "}
				·{" "}
				<time dateTime={receipt.actualDate}>
					{parsePlainDate(receipt.actualDate).toLocaleString(locale, {
						dateStyle: "medium",
					})}
				</time>{" "}
				· {conditionLabel(receipt.condition, t)}
			</p>
			<p className="text-muted-foreground">
				{t("settings.equipment.anonymous.proposedBy", "Proposed by")}{" "}
				{receipt.proposedByName ??
					t("settings.equipment.custody.removedActor", "Removed account")}{" "}
				·{" "}
				<time dateTime={receipt.proposedAt}>
					{auditDate(receipt.proposedAt)}
				</time>
			</p>
			{receipt.confirmedAt ? (
				<p className="text-muted-foreground">
					{t("settings.equipment.anonymous.confirmedBy", "Confirmed by")}{" "}
					{receipt.confirmedByName ??
						t(
							"settings.equipment.custody.removedActor",
							"Removed account",
						)}{" "}
					·{" "}
					<time dateTime={receipt.confirmedAt}>
						{auditDate(receipt.confirmedAt)}
					</time>
				</p>
			) : null}
		</div>
	);
}
