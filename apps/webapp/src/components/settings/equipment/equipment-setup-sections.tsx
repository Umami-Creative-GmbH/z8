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
import { type ReactNode, useId } from "react";
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
import type {
	EquipmentItemView,
	EquipmentSetupChange,
	EquipmentSetupView,
	EquipmentTypeView,
} from "@/lib/organization/equipment/contracts";
import type { EquipmentArchiveTarget } from "./equipment-archive-dialog";
import {
	EquipmentItemPanel,
	EquipmentRetentionPanel,
	EquipmentTypePanel,
} from "./equipment-forms";
import { EquipmentItemList, EquipmentTypeList } from "./equipment-lists";

export type EquipmentSetupPanel =
	| { kind: "retention" }
	| { kind: "type"; type?: EquipmentTypeView }
	| { kind: "item" };

export function EquipmentRetentionCard({
	policy,
	pending,
	onEdit,
}: {
	policy: EquipmentSetupView["policy"];
	pending: boolean;
	onEdit: () => void;
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{t("settings.equipment.retention.title", "Record retention")}</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"settings.equipment.retention.description",
						"Configure a finite period before operational equipment tracking can be used. No legal retention period is assumed.",
					)}
				</CardDescription>
				{policy ? (
					<CardAction>
						<Button
							variant="outline"
							size="sm"
							onClick={onEdit}
							disabled={pending}
						>
							<IconPencil className="size-4" aria-hidden="true" />
							{t("settings.equipment.retention.edit", "Edit retention")}
						</Button>
					</CardAction>
				) : null}
			</CardHeader>
			<CardContent>
				{policy ? (
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
								{ count: policy.retentionMonths },
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
							onClick={onEdit}
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
	);
}

/** `types` is the whole register; `visibleTypes` hides archived types unless they are shown. */
export function EquipmentTypesCard({
	types,
	visibleTypes,
	pending,
	onAdd,
	onEdit,
	onArchive,
}: {
	types: EquipmentTypeView[];
	visibleTypes: EquipmentTypeView[];
	pending: boolean;
	onAdd: () => void;
	onEdit: (type: EquipmentTypeView) => void;
	onArchive: (target: EquipmentArchiveTarget) => void;
}) {
	const { t } = useTranslate();
	const addTypeButton = (variant: "default" | "outline") => (
		<Button
			variant={variant}
			size={variant === "outline" ? "sm" : "default"}
			onClick={onAdd}
			disabled={pending}
		>
			<IconPlus className="size-4" aria-hidden="true" />
			{t("settings.equipment.types.add", "Add type")}
		</Button>
	);
	return (
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
				{types.length > 0 ? (
					<CardAction>{addTypeButton("outline")}</CardAction>
				) : null}
			</CardHeader>
			<CardContent>
				{visibleTypes.length > 0 ? (
					<EquipmentTypeList
						types={visibleTypes}
						pending={pending}
						onEdit={onEdit}
						onArchive={(type) =>
							onArchive({
								kind: "archive_type",
								id: type.id,
								expectedRevision: type.revision,
								name: type.name,
							})
						}
					/>
				) : types.length === 0 ? (
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
	);
}

/** `visibleItems` hides archived items unless they are shown. */
export function EquipmentItemsCard({
	data,
	visibleItems,
	pending,
	onRegister,
	onArchive,
}: {
	data: EquipmentSetupView;
	visibleItems: EquipmentItemView[];
	pending: boolean;
	onRegister: () => void;
	onArchive: (target: EquipmentArchiveTarget) => void;
}) {
	const { t } = useTranslate();
	const registerBlockedId = useId();
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
			onClick={onRegister}
			disabled={pending || registerBlocked !== null}
			aria-describedby={registerBlocked ? registerBlockedId : undefined}
		>
			<IconPlus className="size-4" aria-hidden="true" />
			{t("settings.equipment.items.register", "Register item")}
		</Button>
	);
	return (
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
				{visibleItems.length > 0 ? (
					<EquipmentItemList
						items={visibleItems}
						types={data.types}
						pending={pending}
						onArchive={(item) =>
							onArchive({
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
	);
}

/** The retention, type and item action panels; at most one is open. */
export function EquipmentSetupPanels({
	panel,
	open,
	onOpenChange,
	data,
	submit,
	pending,
}: {
	panel: EquipmentSetupPanel | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	data: EquipmentSetupView;
	submit: (change: EquipmentSetupChange) => Promise<boolean>;
	pending: boolean;
}) {
	return (
		<>
			<EquipmentRetentionPanel
				open={open && panel?.kind === "retention"}
				onOpenChange={onOpenChange}
				policy={data.policy}
				submit={submit}
				pending={pending}
			/>
			<EquipmentTypePanel
				open={open && panel?.kind === "type"}
				onOpenChange={onOpenChange}
				type={panel?.kind === "type" ? panel.type : undefined}
				submit={submit}
				pending={pending}
			/>
			<EquipmentItemPanel
				open={open && panel?.kind === "item"}
				onOpenChange={onOpenChange}
				types={data.selectableTypes}
				submit={submit}
				pending={pending}
			/>
		</>
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
