"use client";

import { IconArchive, IconDots, IconPencil } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type {
	EquipmentItemView,
	EquipmentTypeView,
} from "@/lib/organization/equipment/contracts";

/** The "•••" menu of an equipment settings row. */
export function EquipmentRowMenu({
	label,
	disabled,
	children,
}: {
	label: string;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label={label}
					disabled={disabled}
				>
					<IconDots className="size-4" aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">{children}</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function EquipmentEditMenuItem({ onClick }: { onClick: () => void }) {
	const { t } = useTranslate();
	return (
		<DropdownMenuItem onClick={onClick}>
			<IconPencil className="size-4" aria-hidden="true" />
			{t("settings.equipment.edit", "Edit")}
		</DropdownMenuItem>
	);
}

function ArchiveMenuItem({ onClick }: { onClick: () => void }) {
	const { t } = useTranslate();
	return (
		<DropdownMenuItem variant="destructive" onClick={onClick}>
			<IconArchive className="size-4" aria-hidden="true" />
			{t("settings.equipment.archive", "Archive")}
		</DropdownMenuItem>
	);
}

function ArchivedBadge() {
	const { t } = useTranslate();
	return (
		<Badge variant="secondary">
			{t("settings.equipment.archived", "Archived")}
		</Badge>
	);
}

export function EquipmentTypeList({
	types,
	pending,
	onEdit,
	onArchive,
}: {
	types: EquipmentTypeView[];
	pending: boolean;
	onEdit: (type: EquipmentTypeView) => void;
	onArchive: (type: EquipmentTypeView) => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="rounded-lg border">
			<Table mobileLayout="stacked">
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="px-4">
							{t("settings.equipment.types.column", "Type")}
						</TableHead>
						<TableHead>
							{t("settings.equipment.types.mode", "Tracking mode")}
						</TableHead>
						<TableHead>
							{t("settings.equipment.types.returnColumn", "Return default")}
						</TableHead>
						<TableHead className="w-12 px-4">
							<span className="sr-only">
								{t("settings.equipment.actions", "Actions")}
							</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{types.map((type) => (
						<TableRow key={type.id}>
							<TableCell className="whitespace-normal px-4">
								<div className="flex min-w-0 flex-wrap items-center gap-2">
									<span className="break-words font-medium">{type.name}</span>
									{type.archived ? <ArchivedBadge /> : null}
								</div>
							</TableCell>
							<TableCell>
								<Badge variant="outline">
									{type.trackingMode === "individual"
										? t(
												"settings.equipment.types.individual",
												"Individual items",
											)
										: t("settings.equipment.types.quantity", "Quantity")}
								</Badge>
							</TableCell>
							<TableCell>
								{type.defaultReturnRequired ? (
									<Badge variant="secondary">
										{t("settings.equipment.types.required", "Return required")}
									</Badge>
								) : (
									<Badge variant="outline">
										{t("settings.equipment.types.toKeep", "Issued to keep")}
									</Badge>
								)}
							</TableCell>
							<TableCell className="px-4 text-right">
								{!type.archived ? (
									<EquipmentRowMenu
										disabled={pending}
										label={t(
											"settings.equipment.types.actionsNamed",
											"Actions for type {name}",
											{ name: type.name },
										)}
									>
										<EquipmentEditMenuItem onClick={() => onEdit(type)} />
										<ArchiveMenuItem onClick={() => onArchive(type)} />
									</EquipmentRowMenu>
								) : null}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function availabilityLabel(
	item: EquipmentItemView,
	t: ReturnType<typeof useTranslate>["t"],
) {
	if (item.archived)
		return t(
			"settings.equipment.items.archivedAvailability",
			"Archived; unavailable for new assignments",
		);
	if (item.inCustody)
		return t(
			"settings.equipment.items.held",
			"Held by employee; unavailable for new issuance",
		);
	if (item.status === "available")
		return t("settings.equipment.items.available", "Available");
	if (item.status === "retired")
		return t("settings.equipment.items.retired", "Retired");
	return t("settings.equipment.items.unavailable", "Unavailable");
}

export function EquipmentItemList({
	items,
	types,
	pending,
	onArchive,
}: {
	items: EquipmentItemView[];
	types: EquipmentTypeView[];
	pending: boolean;
	onArchive: (item: EquipmentItemView) => void;
}) {
	const { t } = useTranslate();
	const typeNames = new Map(types.map((type) => [type.id, type.name]));
	return (
		<div className="rounded-lg border">
			<Table mobileLayout="stacked">
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="px-4">
							{t("settings.equipment.items.identifier", "Equipment identifier")}
						</TableHead>
						<TableHead>
							{t("settings.equipment.items.type", "Equipment type")}
						</TableHead>
						<TableHead>
							{t("settings.equipment.items.serialColumn", "Serial number")}
						</TableHead>
						<TableHead>
							{t("settings.equipment.items.status", "Availability")}
						</TableHead>
						<TableHead className="w-12 px-4">
							<span className="sr-only">
								{t("settings.equipment.actions", "Actions")}
							</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{items.map((item) => (
						<TableRow key={item.id}>
							<TableCell className="whitespace-normal px-4">
								<div className="flex min-w-0 flex-wrap items-center gap-2">
									<span className="break-all font-medium" translate="no">
										{item.identifier}
									</span>
									{item.archived ? <ArchivedBadge /> : null}
								</div>
							</TableCell>
							<TableCell className="whitespace-normal break-words">
								{typeNames.get(item.typeId)}
							</TableCell>
							<TableCell className="whitespace-normal break-all" translate="no">
								{item.serialNumber ?? (
									<span className="text-muted-foreground">
										{t("settings.equipment.notRecorded", "Not recorded")}
									</span>
								)}
							</TableCell>
							<TableCell className="whitespace-normal text-muted-foreground">
								{availabilityLabel(item, t)}
							</TableCell>
							<TableCell className="px-4 text-right">
								{!item.archived ? (
									<EquipmentRowMenu
										disabled={pending}
										label={t(
											"settings.equipment.items.actionsNamed",
											"Actions for item {identifier}",
											{ identifier: item.identifier },
										)}
									>
										<ArchiveMenuItem onClick={() => onArchive(item)} />
									</EquipmentRowMenu>
								) : null}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
