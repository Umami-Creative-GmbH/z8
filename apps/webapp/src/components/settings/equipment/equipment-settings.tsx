"use client";

import {
	IconAlertTriangle,
	IconArchive,
	IconBarcode,
	IconCategory,
	IconPencil,
	IconPlus,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	changeEquipmentSetup,
	getEquipmentSetup,
	getEquipmentSetupDetail,
} from "@/lib/organization/equipment/actions";
import type {
	EquipmentSetupChange,
	EquipmentSetupView,
	EquipmentTypeView,
} from "@/lib/organization/equipment/contracts";
import {
	EquipmentArchiveDialog,
	type EquipmentArchiveTarget,
} from "./equipment-archive-dialog";
import { equipmentRefusalMessage } from "./equipment-feedback";
import {
	EquipmentItemPanel,
	EquipmentRetentionPanel,
	EquipmentTypePanel,
} from "./equipment-forms";
import { EquipmentItemList, EquipmentTypeList } from "./equipment-lists";

type Panel =
	| { kind: "retention" }
	| { kind: "type"; type?: EquipmentTypeView }
	| { kind: "item" };

export function EquipmentSettings({
	initialData,
}: {
	initialData: EquipmentSetupView;
}) {
	const { t } = useTranslate();
	const [data, setData] = useState(initialData);
	// A server refresh (header reload, officer change) replaces the local copy.
	const [source, setSource] = useState(initialData);
	if (initialData !== source) {
		setSource(initialData);
		setData(initialData);
	}
	const [pending, setPending] = useState(false);
	const [panel, setPanel] = useState<Panel | null>(null);
	const [panelOpen, setPanelOpen] = useState(false);
	const [archiveTarget, setArchiveTarget] =
		useState<EquipmentArchiveTarget | null>(null);
	// A retried archive of the same record revision keeps its request identity.
	const archiveRequests = useRef(new Map<string, string>());
	const [showArchived, setShowArchived] = useState(false);
	const archivedSwitchId = useId();
	const registerBlockedId = useId();

	function openPanel(next: Panel) {
		setPanel(next);
		setPanelOpen(true);
	}

	async function reload() {
		const result = await getEquipmentSetup().catch(() => null);
		if (!result?.success) return false;
		setData(result.data);
		return true;
	}

	function successMessage(kind: EquipmentSetupChange["kind"]) {
		switch (kind) {
			case "configure_policy":
				return t(
					"settings.equipment.retention.saved",
					"Retention policy saved.",
				);
			case "create_type":
			case "update_type":
				return t("settings.equipment.types.saved", "Equipment type saved.");
			case "archive_type":
				return t(
					"settings.equipment.types.archivedToast",
					"Equipment type archived.",
				);
			case "register_item":
				return t(
					"settings.equipment.items.registered",
					"Equipment item registered.",
				);
			case "archive_item":
				return t(
					"settings.equipment.items.archivedToast",
					"Equipment item archived.",
				);
		}
	}

	async function submit(change: EquipmentSetupChange) {
		setPending(true);
		const result = await changeEquipmentSetup(change).catch(() => null);
		if (!result?.success) {
			setPending(false);
			toast.error(
				t(
					"settings.equipment.errors.unavailable",
					"Equipment setup is unavailable. Check your organization access and try again.",
				),
			);
			return false;
		}
		if (!result.data.ok) {
			setPending(false);
			toast.error(equipmentRefusalMessage(result.data.reason, t));
			return false;
		}
		const refreshed = await reload();
		setPending(false);
		if (!refreshed) {
			toast.error(
				t(
					"settings.equipment.errors.retry",
					"The result could not be loaded. Retry the same submission or reload the setup.",
				),
			);
			return false;
		}
		toast.success(successMessage(change.kind));
		return true;
	}

	async function editType(id: string) {
		setPending(true);
		const result = await getEquipmentSetupDetail({ kind: "type", id }).catch(
			() => null,
		);
		setPending(false);
		if (
			!result?.success ||
			result.data?.kind !== "type" ||
			result.data.record.archived
		) {
			toast.error(
				t(
					"settings.equipment.errors.load",
					"Equipment setup could not be loaded. Reload the page.",
				),
			);
			return;
		}
		openPanel({ kind: "type", type: result.data.record });
	}

	function archive(target: EquipmentArchiveTarget) {
		const key = `${target.kind}:${target.id}:${target.expectedRevision}`;
		let requestId = archiveRequests.current.get(key);
		if (!requestId) {
			requestId = crypto.randomUUID();
			archiveRequests.current.set(key, requestId);
		}
		const { name: _name, ...command } = target;
		void submit({ ...command, requestId });
	}

	const types = data.types.filter((type) => showArchived || !type.archived);
	const items = data.items.filter((item) => showArchived || !item.archived);
	const hasIndividualType = data.selectableTypes.some(
		(type) => type.trackingMode === "individual",
	);
	const registerBlocked =
		data.policy === null
			? t(
					"settings.equipment.errors.policy",
					"Configure closed-record retention before registering or issuing equipment.",
				)
			: !hasIndividualType
				? t(
						"settings.equipment.items.noTypes",
						"Add an active individually tracked type to register an item. Quantity types do not need item identities.",
					)
				: null;
	const registerButton = (variant: "default" | "outline") => (
		<Button
			variant={variant}
			size={variant === "outline" ? "sm" : "default"}
			onClick={() => openPanel({ kind: "item" })}
			disabled={pending || registerBlocked !== null}
			aria-describedby={registerBlocked ? registerBlockedId : undefined}
		>
			<IconPlus className="size-4" aria-hidden="true" />
			{t("settings.equipment.items.register", "Register item")}
		</Button>
	);
	const addTypeButton = (variant: "default" | "outline") => (
		<Button
			variant={variant}
			size={variant === "outline" ? "sm" : "default"}
			onClick={() => openPanel({ kind: "type" })}
			disabled={pending}
		>
			<IconPlus className="size-4" aria-hidden="true" />
			{t("settings.equipment.types.add", "Add type")}
		</Button>
	);

	return (
		<div className="space-y-6" aria-busy={pending}>
			<p role="status" className="sr-only">
				{pending ? t("settings.equipment.saving", "Saving…") : ""}
			</p>
			<Card>
				<CardHeader>
					<CardTitle>
						<h2>
							{t("settings.equipment.retention.title", "Record retention")}
						</h2>
					</CardTitle>
					<CardDescription>
						{t(
							"settings.equipment.retention.description",
							"Configure a finite period before operational equipment tracking can be used. No legal retention period is assumed.",
						)}
					</CardDescription>
					{data.policy ? (
						<CardAction>
							<Button
								variant="outline"
								size="sm"
								onClick={() => openPanel({ kind: "retention" })}
								disabled={pending}
							>
								<IconPencil className="size-4" aria-hidden="true" />
								{t("settings.equipment.retention.edit", "Edit retention")}
							</Button>
						</CardAction>
					) : null}
				</CardHeader>
				<CardContent>
					{data.policy ? (
						<dl className="grid gap-1 text-sm sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-baseline sm:gap-x-6">
							<dt className="text-muted-foreground">
								{t(
									"settings.equipment.retention.label",
									"Closed-record retention (months)",
								)}
							</dt>
							<dd className="text-base font-semibold tabular-nums">
								{t(
									"settings.equipment.retention.months",
									"{count, plural, one {# month} other {# months}}",
									{ count: data.policy.retentionMonths },
								)}
							</dd>
						</dl>
					) : (
						<div className="flex flex-col gap-4 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex min-w-0 items-start gap-3">
								<IconAlertTriangle
									className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400"
									aria-hidden="true"
								/>
								<div className="min-w-0 space-y-1">
									<p className="font-medium">
										{t(
											"settings.equipment.retention.missingTitle",
											"Retention is not configured yet",
										)}
									</p>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.equipment.errors.policy",
											"Configure closed-record retention before registering or issuing equipment.",
										)}
									</p>
								</div>
							</div>
							<Button
								className="w-full sm:w-auto"
								onClick={() => openPanel({ kind: "retention" })}
								disabled={pending}
							>
								{t(
									"settings.equipment.retention.configure",
									"Configure retention",
								)}
							</Button>
						</div>
					)}
				</CardContent>
			</Card>

			<div className="flex flex-wrap items-center justify-end gap-2">
				<Switch
					id={archivedSwitchId}
					checked={showArchived}
					onCheckedChange={setShowArchived}
				/>
				<Label htmlFor={archivedSwitchId}>
					{t("settings.equipment.showArchived", "Show archived records")}
				</Label>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>
						<h2>{t("settings.equipment.types.title", "Equipment types")}</h2>
					</CardTitle>
					<CardDescription>
						{t(
							"settings.equipment.types.description",
							"Define tracking and return defaults once. Archive types to stop offering them for new assignments while retaining their history.",
						)}
					</CardDescription>
					{data.types.length > 0 ? (
						<CardAction>{addTypeButton("outline")}</CardAction>
					) : null}
				</CardHeader>
				<CardContent>
					{types.length > 0 ? (
						<EquipmentTypeList
							types={types}
							pending={pending}
							onEdit={(type) => void editType(type.id)}
							onArchive={(type) =>
								setArchiveTarget({
									kind: "archive_type",
									id: type.id,
									expectedRevision: type.revision,
									name: type.name,
								})
							}
						/>
					) : data.types.length === 0 ? (
						<EquipmentEmpty
							icon={<IconCategory aria-hidden="true" />}
							title={t(
								"settings.equipment.types.emptyTitle",
								"No equipment types yet",
							)}
							description={t(
								"settings.equipment.types.emptyDescription",
								"Add a type to start your register. Track laptops one by one, or interchangeable equipment such as shirts by quantity.",
							)}
						>
							{addTypeButton("default")}
						</EquipmentEmpty>
					) : (
						<EquipmentEmpty
							icon={<IconArchive aria-hidden="true" />}
							title={t(
								"settings.equipment.types.allArchivedTitle",
								"No active equipment types",
							)}
							description={t(
								"settings.equipment.types.allArchived",
								"All equipment types are archived. Turn on Show archived records to see them.",
							)}
						/>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>
						<h2>
							{t(
								"settings.equipment.items.title",
								"Individually identified items",
							)}
						</h2>
					</CardTitle>
					<CardDescription>
						{t(
							"settings.equipment.items.description",
							"Register physical equipment by its organization identifier. Manufacturer serial numbers are optional and separate.",
						)}
					</CardDescription>
					{data.items.length > 0 ? (
						<CardAction>{registerButton("outline")}</CardAction>
					) : null}
				</CardHeader>
				<CardContent className="space-y-4">
					{registerBlocked && data.items.length > 0 ? (
						<p id={registerBlockedId} className="text-sm text-muted-foreground">
							{registerBlocked}
						</p>
					) : null}
					{items.length > 0 ? (
						<EquipmentItemList
							items={items}
							types={data.types}
							pending={pending}
							onArchive={(item) =>
								setArchiveTarget({
									kind: "archive_item",
									id: item.id,
									expectedRevision: item.revision,
									name: item.identifier,
								})
							}
						/>
					) : data.items.length === 0 ? (
						<EquipmentEmpty
							icon={<IconBarcode aria-hidden="true" />}
							title={t(
								"settings.equipment.items.emptyTitle",
								"No identified items yet",
							)}
							description={t(
								"settings.equipment.items.emptyDescription",
								"Register laptops, phones, keys and other equipment that needs its own identifier.",
							)}
						>
							{registerButton("default")}
							{registerBlocked ? (
								<p id={registerBlockedId} className="text-muted-foreground">
									{registerBlocked}
								</p>
							) : null}
						</EquipmentEmpty>
					) : (
						<EquipmentEmpty
							icon={<IconArchive aria-hidden="true" />}
							title={t(
								"settings.equipment.items.allArchivedTitle",
								"No active items",
							)}
							description={t(
								"settings.equipment.items.allArchived",
								"All identified items are archived. Turn on Show archived records to see them.",
							)}
						/>
					)}
				</CardContent>
			</Card>

			<EquipmentRetentionPanel
				open={panelOpen && panel?.kind === "retention"}
				onOpenChange={setPanelOpen}
				policy={data.policy}
				submit={submit}
				pending={pending}
			/>
			<EquipmentTypePanel
				open={panelOpen && panel?.kind === "type"}
				onOpenChange={setPanelOpen}
				type={panel?.kind === "type" ? panel.type : undefined}
				submit={submit}
				pending={pending}
			/>
			<EquipmentItemPanel
				open={panelOpen && panel?.kind === "item"}
				onOpenChange={setPanelOpen}
				types={data.selectableTypes}
				submit={submit}
				pending={pending}
			/>
			<EquipmentArchiveDialog
				target={archiveTarget}
				onClose={() => setArchiveTarget(null)}
				onConfirm={archive}
			/>
		</div>
	);
}

function EquipmentEmpty({
	icon,
	title,
	description,
	children,
}: {
	icon: ReactNode;
	title: string;
	description: string;
	children?: ReactNode;
}) {
	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">{icon}</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
			{children ? <EmptyContent>{children}</EmptyContent> : null}
		</Empty>
	);
}
