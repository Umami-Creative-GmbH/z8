"use client";

import {
	IconArchive,
	IconBan,
	IconCircleCheck,
	IconClipboardCheck,
	IconDots,
	IconHistory,
	IconLoader2,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
} from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { changeEquipment } from "@/lib/organization/equipment/actions";
import type {
	EquipmentChange,
	EquipmentReadinessItemView,
} from "@/lib/organization/equipment/contracts";
import { useRouter } from "@/navigation";
import { EquipmentAnonymousReceipt } from "./equipment-anonymous-receipt";
import {
	type EquipmentTranslate,
	handoverRefusalMessage,
} from "./equipment-copy";
import { useCommandIdentity } from "./equipment-handovers";
import {
	hasPendingCustodyReceipt,
	ITEM_VIEWS,
	type ItemView,
	itemMatchesView,
	itemViewCounts,
} from "./equipment-list";
import { useEquipmentDates } from "./equipment-status";

type ReadinessKind = Extract<
	EquipmentChange,
	{ kind: "clear_item" | "mark_item_unavailable" | "retire_item" }
>["kind"];

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

function hasCustodyWork(item: EquipmentReadinessItemView) {
	return !!item.canProposeCustodyReceipt || hasPendingCustodyReceipt(item);
}

/**
 * The Items tab (#1572): availability of individually identified items, separate
 * from who holds them. Readiness decisions are one-step confirmations; anonymous
 * custody receipts for items whose former holder's history was removed are
 * reviewed in one panel.
 */
export function EquipmentReadiness({
	items,
	timezone,
	today,
	view,
	onViewChange,
}: {
	items: EquipmentReadinessItemView[];
	today: string;
	timezone: string;
	view: ItemView;
	onViewChange: (view: ItemView) => void;
}) {
	const { t } = useTranslate();
	const dates = useEquipmentDates(timezone);
	const [confirmation, setConfirmation] = useState<{
		item: EquipmentReadinessItemView;
		kind: ReadinessKind;
	} | null>(null);
	const [historyItem, setHistoryItem] =
		useState<EquipmentReadinessItemView | null>(null);
	const [reviewing, setReviewing] = useState(false);
	const counts = itemViewCounts(items);
	const visible = items.filter((item) => itemMatchesView(item, view));
	const custodyWork = items.filter(hasCustodyWork);
	const awaiting = items.filter(hasPendingCustodyReceipt).length;
	const viewLabel: Record<ItemView, string> = {
		attention: t("settings.equipment.items.attention", "Needs attention"),
		available: t("settings.equipment.readiness.available", "Available"),
		held: t("settings.equipment.items.held", "Held"),
		all: t("settings.equipment.items.all", "All"),
	};
	return (
		<Card className="gap-0 overflow-hidden py-0">
			<CardHeader className="flex flex-wrap items-start justify-between gap-3 py-5">
				<div className="min-w-0 space-y-1">
					<h2 className="font-semibold leading-none">
						{t("settings.equipment.readiness.title", "Item availability")}
					</h2>
					<CardDescription>
						{t(
							"settings.equipment.readiness.description",
							"Readiness is separate from physical custody. Receive held items before clearing them for issue.",
						)}
					</CardDescription>
				</div>
				<ToggleGroup
					type="single"
					variant="outline"
					value={view}
					onValueChange={(value: string) => {
						const next = ITEM_VIEWS.find((entry) => entry === value);
						if (next) onViewChange(next);
					}}
					aria-label={t("settings.equipment.items.show", "Show items")}
					className="max-w-full overflow-x-auto"
				>
					{ITEM_VIEWS.map((entry) => (
						<ToggleGroupItem
							key={entry}
							value={entry}
							className="gap-1.5 whitespace-nowrap px-3"
						>
							{viewLabel[entry]}
							{entry !== "all" ? (
								<span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
									{counts[entry]}
								</span>
							) : null}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</CardHeader>
			{visible.length ? (
				<CardContent className="border-t px-0">
					<Table mobileLayout="stacked">
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead className="pl-6">
									{t("settings.equipment.list.item", "Item")}
								</TableHead>
								<TableHead>
									{t("settings.equipment.handover.type", "Equipment type")}
								</TableHead>
								<TableHead>
									{t("settings.equipment.items.availability", "Availability")}
								</TableHead>
								<TableHead>
									{t("settings.equipment.items.lastChange", "Last change")}
								</TableHead>
								<TableHead className="w-12 pr-4">
									<span className="sr-only">
										{t("settings.equipment.list.actions", "Actions")}
									</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{visible.map((item) => {
								const last = item.history.at(-1);
								return (
									<TableRow
										key={`${item.id}:${item.revision}`}
										className="[content-visibility:auto]"
									>
										<TableCell className="max-w-64 pl-6">
											<span
												className="block truncate font-medium"
												translate="no"
											>
												{item.identifier}
											</span>
											{item.serialNumber ? (
												<span
													className="block truncate text-xs text-muted-foreground"
													translate="no"
												>
													{item.serialNumber}
												</span>
											) : null}
										</TableCell>
										<TableCell>{item.typeName}</TableCell>
										<TableCell>
											<ItemAvailability item={item} />
										</TableCell>
										<TableCell className="text-muted-foreground tabular-nums">
											{last ? (
												<time dateTime={last.recordedAt}>
													{dates.instantDate(last.recordedAt)}
												</time>
											) : (
												"—"
											)}
										</TableCell>
										<TableCell className="pr-4 text-right">
											<ItemMenu
												item={item}
												onConfirm={(kind) => setConfirmation({ item, kind })}
												onHistory={() => setHistoryItem(item)}
											/>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</CardContent>
			) : (
				<Empty className="rounded-none border-t md:p-10">
					<EmptyHeader>
						<EmptyDescription>
							{items.length
								? t(
										"settings.equipment.items.noneInView",
										"No items match this view.",
									)
								: t(
										"settings.equipment.readiness.empty",
										"No registered items.",
									)}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
			{custodyWork.length ? (
				<div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3">
					<p className="text-sm text-muted-foreground tabular-nums">
						{t(
							"settings.equipment.items.awaitingReceipts",
							"Anonymous custody receipts awaiting confirmation: {count}",
							{ count: awaiting },
						)}
					</p>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setReviewing(true)}
					>
						<IconClipboardCheck className="size-4" aria-hidden="true" />
						{t("settings.equipment.items.reviewReceipts", "Review receipts")}
					</Button>
				</div>
			) : null}
			<ReadinessConfirmation
				confirmation={confirmation}
				onClose={() => setConfirmation(null)}
			/>
			<ActionPanel
				open={!!historyItem}
				onOpenChange={(open) => {
					if (!open) setHistoryItem(null);
				}}
			>
				<ActionPanelContent size="compact">
					{historyItem ? (
						<ItemHistory
							item={historyItem}
							timezone={timezone}
							onClose={() => setHistoryItem(null)}
						/>
					) : null}
				</ActionPanelContent>
			</ActionPanel>
			<ActionPanel open={reviewing} onOpenChange={setReviewing}>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t(
								"settings.equipment.items.anonymousTitle",
								"Anonymous custody receipts",
							)}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.equipment.anonymous.help",
								"The former holder's personal history was removed. A different authorized staff member must confirm this physical receipt before custody is released.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-4">
						{custodyWork.map((item) => (
							<section
								key={`${item.id}:${item.revision}`}
								aria-label={item.identifier}
								className="space-y-3 rounded-lg border p-4"
							>
								<h3 className="break-words font-medium">
									<span translate="no">{item.identifier}</span> ·{" "}
									{item.typeName}
								</h3>
								{item.personalHistoryCleaned ? <CleanedHistoryNote /> : null}
								<EquipmentAnonymousReceipt
									item={item}
									today={today}
									timezone={timezone}
								/>
							</section>
						))}
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button variant="outline" onClick={() => setReviewing(false)}>
							{t("common.close", "Close")}
						</Button>
					</ActionPanelFooter>
				</ActionPanelContent>
			</ActionPanel>
		</Card>
	);
}

function CleanedHistoryNote() {
	const { t } = useTranslate();
	return (
		<p className="text-sm text-muted-foreground">
			{t(
				"settings.equipment.retention.cleanedItem",
				"Expired personal history was removed. Item identity, custody and availability remain recorded; cleanup does not confirm physical receipt.",
			)}
		</p>
	);
}

function ItemAvailability({ item }: { item: EquipmentReadinessItemView }) {
	const { t } = useTranslate();
	return (
		<span className="flex flex-wrap gap-1.5">
			{item.status === "available" ? (
				<Badge variant="secondary">
					{t("settings.equipment.readiness.available", "Available")}
				</Badge>
			) : (
				<Badge
					variant={item.status === "unavailable" ? "destructive" : "outline"}
				>
					{readinessLabel(item.status, t)}
				</Badge>
			)}
			{item.inCustody ? (
				<Badge variant="outline">
					{t("settings.equipment.custody.held", "Held by employee")}
				</Badge>
			) : null}
			{item.archived ? (
				<Badge variant="outline">
					{t("settings.equipment.readiness.archived", "Archived")}
				</Badge>
			) : null}
		</span>
	);
}

function ItemMenu({
	item,
	onConfirm,
	onHistory,
}: {
	item: EquipmentReadinessItemView;
	onConfirm: (kind: ReadinessKind) => void;
	onHistory: () => void;
}) {
	const { t } = useTranslate();
	const decisions = item.canClear || item.canMarkUnavailable || item.canRetire;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label={t(
						"settings.equipment.list.rowActions",
						"Actions for {identifier}",
						{ identifier: item.identifier },
					)}
				>
					<IconDots className="size-4" aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-52">
				{item.canClear ? (
					<DropdownMenuItem onClick={() => onConfirm("clear_item")}>
						<IconCircleCheck aria-hidden="true" />
						{t("settings.equipment.readiness.clear", "Clear for issue")}
					</DropdownMenuItem>
				) : null}
				{item.canMarkUnavailable ? (
					<DropdownMenuItem onClick={() => onConfirm("mark_item_unavailable")}>
						<IconBan aria-hidden="true" />
						{t(
							"settings.equipment.readiness.markUnavailable",
							"Mark unavailable",
						)}
					</DropdownMenuItem>
				) : null}
				{item.canRetire ? (
					<DropdownMenuItem
						variant="destructive"
						onClick={() => onConfirm("retire_item")}
					>
						<IconArchive aria-hidden="true" />
						{t("settings.equipment.readiness.retire", "Retire item")}
					</DropdownMenuItem>
				) : null}
				{decisions ? <DropdownMenuSeparator /> : null}
				<DropdownMenuItem onClick={onHistory}>
					<IconHistory aria-hidden="true" />
					{t("settings.equipment.readiness.history", "Availability history")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ItemHistory({
	item,
	timezone,
	onClose,
}: {
	item: EquipmentReadinessItemView;
	timezone: string;
	onClose: () => void;
}) {
	const { t } = useTranslate();
	const dates = useEquipmentDates(timezone);
	return (
		<>
			<ActionPanelHeader>
				<ActionPanelTitle>
					{t("settings.equipment.readiness.history", "Availability history")}
				</ActionPanelTitle>
				<ActionPanelDescription>
					<span translate="no">{item.identifier}</span> · {item.typeName}
				</ActionPanelDescription>
			</ActionPanelHeader>
			<ActionPanelBody className="space-y-4 text-sm">
				<ItemAvailability item={item} />
				{item.personalHistoryCleaned ? <CleanedHistoryNote /> : null}
				{item.history.length ? (
					<ol className="space-y-3">
						{[...item.history].reverse().map((event) => (
							<li key={event.id} className="break-words">
								<p className="font-medium">{readinessLabel(event.kind, t)}</p>
								<p className="text-muted-foreground">
									{event.actorName ??
										t(
											"settings.equipment.custody.removedActor",
											"Removed account",
										)}{" "}
									·{" "}
									<time dateTime={event.recordedAt}>
										{dates.instant(event.recordedAt)}
									</time>{" "}
									<span translate="no">{timezone}</span>
								</p>
							</li>
						))}
					</ol>
				) : (
					<p className="text-muted-foreground">
						{t(
							"settings.equipment.items.noHistory",
							"No availability decisions recorded yet.",
						)}
					</p>
				)}
			</ActionPanelBody>
			<ActionPanelFooter>
				<Button variant="outline" onClick={onClose}>
					{t("common.close", "Close")}
				</Button>
			</ActionPanelFooter>
		</>
	);
}

/** One-step confirmation; an uncertain result keeps it open and retries with the same request. */
function ReadinessConfirmation({
	confirmation,
	onClose,
}: {
	confirmation: {
		item: EquipmentReadinessItemView;
		kind: ReadinessKind;
	} | null;
	onClose: () => void;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const identity = useCommandIdentity();
	const [pending, setPending] = useState(false);
	// Keep the closing dialog's copy while it animates out.
	const [shown, setShown] = useState(confirmation);
	if (confirmation && confirmation !== shown) setShown(confirmation);
	const kind = shown?.kind;
	async function confirm() {
		if (!shown) return;
		const payload = {
			kind: shown.kind,
			itemId: shown.item.id,
			expectedRevision: shown.item.revision,
		};
		const failed = () =>
			toast.error(
				t(
					"settings.equipment.readiness.failed",
					"The availability decision could not be confirmed. Retry unchanged or reload equipment to check its history.",
				),
			);
		setPending(true);
		try {
			const result = await changeEquipment({
				...payload,
				requestId: identity(payload),
			});
			if (!result.success) return failed();
			if (!result.data.ok) {
				toast.error(handoverRefusalMessage(result.data.reason, t));
				return;
			}
			toast.success(
				t(
					"settings.equipment.readiness.recorded",
					"Availability decision recorded.",
				),
			);
			onClose();
			router.refresh();
		} catch {
			failed();
		} finally {
			setPending(false);
		}
	}
	return (
		<AlertDialog
			open={!!confirmation}
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{kind === "clear_item"
							? t("settings.equipment.readiness.clear", "Clear for issue")
							: kind === "retire_item"
								? t("settings.equipment.readiness.retire", "Retire item")
								: t(
										"settings.equipment.readiness.markUnavailable",
										"Mark unavailable",
									)}
						{shown ? (
							<>
								{" · "}
								<span translate="no">{shown.item.identifier}</span>
							</>
						) : null}
					</AlertDialogTitle>
					<AlertDialogDescription>
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
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>
						{t("common.cancel", "Cancel")}
					</AlertDialogCancel>
					<Button
						variant={kind === "retire_item" ? "destructive" : "default"}
						disabled={pending}
						aria-busy={pending}
						onClick={() => void confirm()}
					>
						{pending ? (
							<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
						) : null}
						{kind === "clear_item"
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
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
