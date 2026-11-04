"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { changeEquipment } from "@/lib/organization/equipment/actions";
import type {
	EquipmentChange,
	EquipmentReadinessItemView,
} from "@/lib/organization/equipment/contracts";
import { useRouter } from "@/navigation";
import {
	type EquipmentTranslate,
	handoverRefusalMessage,
} from "./equipment-copy";

type ReadinessKind = Extract<
	EquipmentChange,
	{ kind: "clear_item" | "mark_item_unavailable" | "retire_item" }
>["kind"];
export function EquipmentReadiness({
	items,
	timezone,
}: {
	items: EquipmentReadinessItemView[];
	timezone: string;
}) {
	const { t } = useTranslate();
	return (
		<section
			aria-label={t("settings.equipment.readiness.title", "Item availability")}
			className="space-y-3"
		>
			<h3 className="font-semibold">
				{t("settings.equipment.readiness.title", "Item availability")}
			</h3>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.readiness.description",
					"Readiness is separate from physical custody. Receive held items before clearing them for issue.",
				)}
			</p>
			{items.length ? (
				items.map((item) => (
					<ItemReadiness
						key={`${item.id}:${item.revision}`}
						item={item}
						timezone={timezone}
					/>
				))
			) : (
				<p className="text-sm text-muted-foreground">
					{t("settings.equipment.readiness.empty", "No registered items.")}
				</p>
			)}
		</section>
	);
}
function readinessLabel(
	kind: "clearance" | "unavailable" | "retired",
	t: EquipmentTranslate,
) {
	switch (kind) {
		case "clearance":
			return t("settings.equipment.readiness.cleared", "Cleared for issue");
		case "unavailable":
			return t("settings.equipment.readiness.unavailable", "Unavailable");
		case "retired":
			return t("settings.equipment.readiness.retired", "Retired");
	}
}
function ItemReadiness({
	item,
	timezone,
}: {
	item: EquipmentReadinessItemView;
	timezone: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [selection, setSelection] = useState<ReadinessKind | null>(null);
	return (
		<article
			className="min-w-0 space-y-3 rounded-lg border bg-card p-4 [content-visibility:auto]"
			aria-label={item.identifier}
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<h4 className="break-words font-medium">
						<span translate="no">{item.identifier}</span> · {item.typeName}
					</h4>
					<div className="flex flex-wrap gap-2">
						<Badge variant="outline">
							{item.status === "available"
								? t("settings.equipment.readiness.available", "Available")
								: readinessLabel(item.status, t)}
						</Badge>
						{item.inCustody ? (
							<Badge variant="secondary">
								{t("settings.equipment.custody.held", "Held by employee")}
							</Badge>
						) : null}
						{item.archived ? (
							<Badge variant="outline">
								{t("settings.equipment.readiness.archived", "Archived")}
							</Badge>
						) : null}
					</div>
				</div>
				{!selection ? (
					<div className="flex flex-wrap gap-2">
						{item.canClear ? (
							<Button
								variant="outline"
								onClick={() => setSelection("clear_item")}
							>
								{t("settings.equipment.readiness.clear", "Clear for issue")}
							</Button>
						) : null}
						{item.canMarkUnavailable ? (
							<Button
								variant="outline"
								onClick={() => setSelection("mark_item_unavailable")}
							>
								{t(
									"settings.equipment.readiness.markUnavailable",
									"Mark unavailable",
								)}
							</Button>
						) : null}
						{item.canRetire ? (
							<Button
								variant="outline"
								onClick={() => setSelection("retire_item")}
							>
								{t("settings.equipment.readiness.retire", "Retire item")}
							</Button>
						) : null}
					</div>
				) : null}
			</div>
			{selection ? (
				<ReadinessConfirmation
					item={item}
					kind={selection}
					onCancel={() => setSelection(null)}
				/>
			) : null}
			{item.history.length ? (
				<details className="border-t pt-3">
					<summary className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
						{t("settings.equipment.readiness.history", "Availability history")}
					</summary>
					<ol className="mt-3 space-y-2 text-sm">
						{item.history.map((event) => (
							<li key={event.id} className="break-words">
								{readinessLabel(event.kind, t)} ·{" "}
								{event.actorName ??
									t(
										"settings.equipment.custody.removedActor",
										"Removed account",
									)}{" "}
								·{" "}
								<time dateTime={event.recordedAt}>
									{parseInstant(event.recordedAt)
										.toZonedDateTimeISO(timezone)
										.toLocaleString(locale, {
											dateStyle: "medium",
											timeStyle: "short",
										})}
								</time>{" "}
								<span translate="no">{timezone}</span>
							</li>
						))}
					</ol>
				</details>
			) : null}
		</article>
	);
}
function ReadinessConfirmation({
	item,
	kind,
	onCancel,
}: {
	item: EquipmentReadinessItemView;
	kind: ReadinessKind;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [feedback, setFeedback] = useState<{
		error: boolean;
		text: string;
	} | null>(null);
	const requestId = useRef<string | null>(null);
	const failed = () =>
		setFeedback({
			error: true,
			text: t(
				"settings.equipment.readiness.failed",
				"The availability decision could not be confirmed. Retry unchanged or reload equipment to check its history.",
			),
		});
	const form = useForm({
		defaultValues: {},
		onSubmit: () => {
			startTransition(async () => {
				setFeedback(null);
				if (!requestId.current) requestId.current = crypto.randomUUID();
				try {
					const result = await changeEquipment({
						kind,
						itemId: item.id,
						expectedRevision: item.revision,
						requestId: requestId.current,
					});
					if (!result.success) {
						failed();
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
							"settings.equipment.readiness.saved",
							"Availability decision recorded. Reloading equipment…",
						),
					});
					router.refresh();
				} catch {
					failed();
				}
			});
		},
	});
	return (
		<form
			className="space-y-3 rounded-md border p-3"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<p className="text-sm">
				{kind === "clear_item"
					? t(
							"settings.equipment.readiness.clearHelp",
							"Confirm this item is ready for another issue. Receipt condition and history stay unchanged.",
						)
					: kind === "retire_item"
						? t(
								"settings.equipment.readiness.retireHelp",
								"Retirement is permanent. The identifier stays reserved and the item cannot be issued again. Held equipment still needs physical receipt.",
							)
						: t(
								"settings.equipment.readiness.unavailableHelp",
								"This item will be blocked from new issuance until explicitly cleared. Custody and receipt evidence stay unchanged.",
							)}
			</p>
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
			<div className="flex flex-wrap gap-2">
				<Button type="submit" disabled={pending || feedback?.error === false}>
					{pending
						? t("settings.equipment.readiness.saving", "Recording decision…")
						: kind === "clear_item"
							? t(
									"settings.equipment.readiness.confirmClear",
									"Confirm clearance",
								)
							: kind === "retire_item"
								? t(
										"settings.equipment.readiness.confirmRetire",
										"Confirm retirement",
									)
								: t(
										"settings.equipment.readiness.confirmUnavailable",
										"Confirm unavailable",
									)}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={pending}
					onClick={onCancel}
				>
					{t("common.cancel", "Cancel")}
				</Button>
			</div>
		</form>
	);
}
