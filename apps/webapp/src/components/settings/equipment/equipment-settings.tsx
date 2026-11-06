"use client";

import { IconLoader2, IconPlus } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import { equipmentRefusalMessage } from "./equipment-feedback";
import {
	EquipmentItemForm,
	EquipmentRetentionForm,
	EquipmentTypeForm,
} from "./equipment-forms";
import { EquipmentItemList, EquipmentTypeList } from "./equipment-lists";

export function EquipmentSettings({
	initialData,
}: {
	initialData: EquipmentSetupView;
}) {
	const { t } = useTranslate();
	const [data, setData] = useState(initialData);
	const [pending, setPending] = useState(false);
	const [editor, setEditor] = useState<{ type?: EquipmentTypeView } | null>(
		null,
	);
	const [showArchived, setShowArchived] = useState(false);

	async function reload() {
		const result = await getEquipmentSetup().catch(() => null);
		if (!result?.success) return false;
		setData(result.data);
		return true;
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
		toast.success(
			change.kind === "configure_policy"
				? t("settings.equipment.retention.saved", "Retention policy saved.")
				: t("settings.equipment.saved", "Equipment setup saved."),
		);
		return true;
	}
	const types = data.types.filter((type) => showArchived || !type.archived);
	const items = data.items.filter((item) => showArchived || !item.archived);
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
		setEditor({ type: result.data.record });
	}
	return (
		<div className="space-y-6" aria-busy={pending}>
			{pending ? (
				<p
					role="status"
					className="flex items-center gap-2 text-sm text-muted-foreground"
				>
					<IconLoader2
						aria-hidden="true"
						className="size-4 motion-safe:animate-spin"
					/>
					{t("settings.equipment.saving", "Saving…")}
				</p>
			) : null}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						className="size-4 accent-primary"
						checked={showArchived}
						onChange={(e) => setShowArchived(e.target.checked)}
					/>
					{t("settings.equipment.showArchived", "Show archived records")}
				</label>
				<Button
					variant="outline"
					disabled={pending}
					onClick={async () => {
						setPending(true);
						const refreshed = await reload();
						setPending(false);
						if (refreshed) {
							setEditor(null);
						} else {
							toast.error(
								t(
									"settings.equipment.errors.load",
									"Equipment setup could not be loaded. Reload the page.",
								),
							);
						}
					}}
				>
					{t("settings.equipment.reload", "Reload setup")}
				</Button>
			</div>
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
				</CardHeader>
				<CardContent>
					<EquipmentRetentionForm
						key={data.policy?.revision ?? 0}
						policy={data.policy}
						pending={pending}
						submit={submit}
					/>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<CardTitle>
							<h2>{t("settings.equipment.types.title", "Equipment types")}</h2>
						</CardTitle>
						<Button
							variant="outline"
							onClick={() => setEditor({})}
							disabled={pending}
						>
							<IconPlus className="size-4" aria-hidden="true" />
							{t("settings.equipment.types.add", "Add type")}
						</Button>
					</div>
					<CardDescription>
						{t(
							"settings.equipment.types.description",
							"Define tracking and return defaults once. Archive types to stop offering them for new assignments while retaining their history.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{editor ? (
						<EquipmentTypeForm
							key={`${editor.type?.id ?? "new"}:${editor.type?.revision ?? 0}`}
							type={editor.type}
							submit={submit}
							pending={pending}
							onCancel={() => setEditor(null)}
						/>
					) : null}
					<EquipmentTypeList
						types={types}
						pending={pending}
						submit={submit}
						editType={editType}
					/>
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
				</CardHeader>
				<CardContent className="space-y-6">
					<EquipmentItemForm
						types={data.selectableTypes}
						configured={data.policy !== null}
						pending={pending}
						submit={submit}
					/>
					<EquipmentItemList
						items={items}
						types={data.types}
						pending={pending}
						submit={submit}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
