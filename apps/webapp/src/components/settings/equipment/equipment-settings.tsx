"use client";

import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { EquipmentSetupView } from "@/lib/organization/equipment/contracts";
import {
	EquipmentArchiveDialog,
	type EquipmentArchiveTarget,
} from "./equipment-archive-dialog";
import {
	EquipmentItemsCard,
	EquipmentRetentionCard,
	type EquipmentSetupPanel,
	EquipmentSetupPanels,
	EquipmentTypesCard,
} from "./equipment-setup-sections";
import { useEquipmentSetup } from "./use-equipment-setup";

export function EquipmentSettings({
	initialData,
}: {
	initialData: EquipmentSetupView;
}) {
	const { t } = useTranslate();
	const { data, pending, submit, loadType, archive } =
		useEquipmentSetup(initialData);
	const [panel, setPanel] = useState<EquipmentSetupPanel | null>(null);
	const [panelOpen, setPanelOpen] = useState(false);
	const [archiveTarget, setArchiveTarget] =
		useState<EquipmentArchiveTarget | null>(null);
	const [showArchived, setShowArchived] = useState(false);
	const archivedSwitchId = useId();

	function openPanel(next: EquipmentSetupPanel) {
		setPanel(next);
		setPanelOpen(true);
	}

	async function editType(id: string) {
		const type = await loadType(id);
		if (type) openPanel({ kind: "type", type });
	}

	const types = data.types.filter((type) => showArchived || !type.archived);
	const items = data.items.filter((item) => showArchived || !item.archived);

	return (
		<div className="space-y-6" aria-busy={pending}>
			<p role="status" className="sr-only">
				{pending ? t("settings.equipment.saving", "Saving…") : ""}
			</p>
			<EquipmentRetentionCard
				policy={data.policy}
				pending={pending}
				onEdit={() => openPanel({ kind: "retention" })}
			/>

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

			<EquipmentTypesCard
				types={data.types}
				visibleTypes={types}
				pending={pending}
				onAdd={() => openPanel({ kind: "type" })}
				onEdit={(type) => void editType(type.id)}
				onArchive={setArchiveTarget}
			/>

			<EquipmentItemsCard
				data={data}
				visibleItems={items}
				pending={pending}
				onRegister={() => openPanel({ kind: "item" })}
				onArchive={setArchiveTarget}
			/>

			<EquipmentSetupPanels
				panel={panel}
				open={panelOpen}
				onOpenChange={setPanelOpen}
				data={data}
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
