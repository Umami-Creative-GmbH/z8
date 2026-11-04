"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
	EquipmentItemView,
	EquipmentTypeView,
} from "@/lib/organization/equipment/contracts";
import { EquipmentArchiveButton } from "./equipment-archive-button";
import type { SubmitEquipment } from "./equipment-forms";

interface ListActions {
	pending: boolean;
	submit: SubmitEquipment;
}

export function EquipmentTypeList({
	types,
	pending,
	submit,
	editType,
}: ListActions & {
	types: EquipmentTypeView[];
	editType: (id: string) => Promise<void>;
}) {
	const { t } = useTranslate();
	if (types.length === 0)
		return (
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.types.empty",
					"No equipment types to show. Add a type to start your register.",
				)}
			</p>
		);
	return (
		<ul className="divide-y">
			{types.map((type) => (
				<li
					key={type.id}
					className="flex flex-wrap items-center justify-between gap-3 py-3 [content-visibility:auto] [contain-intrinsic-size:auto_64px]"
				>
					<div className="min-w-0 space-y-1">
						<p className="break-words font-medium">
							{type.name}{" "}
							{type.archived ? (
								<Badge variant="secondary">
									{t("settings.equipment.archived", "Archived")}
								</Badge>
							) : null}
						</p>
						<p className="text-sm text-muted-foreground">
							{type.trackingMode === "individual"
								? t("settings.equipment.types.individual", "Individual items")
								: t("settings.equipment.types.quantity", "Quantity")}{" "}
							·{" "}
							{type.defaultReturnRequired
								? t("settings.equipment.types.required", "Return required")
								: t("settings.equipment.types.toKeep", "Issued to keep")}
						</p>
					</div>
					{!type.archived ? (
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={pending}
								onClick={() => void editType(type.id)}
								aria-label={t(
									"settings.equipment.types.editNamed",
									"Edit type {name}",
									{ name: type.name },
								)}
							>
								{t("settings.equipment.edit", "Edit")}
							</Button>
							<EquipmentArchiveButton
								target={{
									kind: "archive_type",
									id: type.id,
									expectedRevision: type.revision,
								}}
								name={type.name}
								pending={pending}
								submit={submit}
								label={t(
									"settings.equipment.types.archiveNamed",
									"Archive type {name}",
									{ name: type.name },
								)}
							/>
						</div>
					) : null}
				</li>
			))}
		</ul>
	);
}

export function EquipmentItemList({
	items,
	types,
	pending,
	submit,
}: ListActions & { items: EquipmentItemView[]; types: EquipmentTypeView[] }) {
	const { t } = useTranslate();
	if (items.length === 0)
		return (
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.items.empty",
					"No individual equipment items to show.",
				)}
			</p>
		);
	const typeNames = new Map(types.map((type) => [type.id, type.name]));
	return (
		<ul className="divide-y">
			{items.map((item) => (
				<li
					key={item.id}
					className="py-3 [content-visibility:auto] [contain-intrinsic-size:auto_48px]"
				>
					<details>
						<summary className="cursor-pointer rounded-sm break-words font-medium focus-visible:outline-2 focus-visible:outline-ring">
							<span translate="no">{item.identifier}</span>{" "}
							{item.archived ? (
								<Badge variant="secondary">
									{t("settings.equipment.archived", "Archived")}
								</Badge>
							) : null}
						</summary>
						<dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[12rem_1fr]">
							<dt className="text-muted-foreground">
								{t("settings.equipment.items.type", "Equipment type")}
							</dt>
							<dd className="break-words">{typeNames.get(item.typeId)}</dd>
							<dt className="text-muted-foreground">
								{t(
									"settings.equipment.items.serial",
									"Manufacturer serial number (optional)",
								)}
							</dt>
							<dd className="break-all" translate="no">
								{item.serialNumber ??
									t("settings.equipment.notRecorded", "Not recorded")}
							</dd>
							<dt className="text-muted-foreground">
								{t("settings.equipment.items.status", "Availability")}
							</dt>
							<dd>
								{item.archived
									? t(
											"settings.equipment.items.archivedAvailability",
											"Archived; unavailable for new assignments",
										)
									: item.status === "available"
										? t("settings.equipment.items.available", "Available")
										: item.status === "retired"
											? t("settings.equipment.items.retired", "Retired")
											: t(
													"settings.equipment.items.unavailable",
													"Unavailable",
												)}
							</dd>
						</dl>
						{!item.archived ? (
							<div className="mt-3">
								<EquipmentArchiveButton
									target={{
										kind: "archive_item",
										id: item.id,
										expectedRevision: item.revision,
									}}
									name={item.identifier}
									pending={pending}
									submit={submit}
									label={t(
										"settings.equipment.items.archiveNamed",
										"Archive item {identifier}",
										{ identifier: item.identifier },
									)}
								/>
							</div>
						) : null}
					</details>
				</li>
			))}
		</ul>
	);
}
