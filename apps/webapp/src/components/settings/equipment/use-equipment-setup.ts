import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	changeEquipmentSetup,
	getEquipmentSetup,
	getEquipmentSetupDetail,
} from "@/lib/organization/equipment/actions";
import type {
	EquipmentSetupChange,
	EquipmentSetupView,
} from "@/lib/organization/equipment/contracts";
import type { EquipmentArchiveTarget } from "./equipment-archive-dialog";
import { equipmentRefusalMessage } from "./equipment-feedback";

function successMessage(
	kind: EquipmentSetupChange["kind"],
	t: (key: string, fallback: string) => string,
) {
	switch (kind) {
		case "configure_policy":
			return t("settings.equipment.retention.saved", "Retention policy saved.");
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

/**
 * The local copy of the equipment setup and its commands. A change reports
 * success only once the refreshed setup has loaded.
 */
export function useEquipmentSetup(initialData: EquipmentSetupView) {
	const { t } = useTranslate();
	const [data, setData] = useState(initialData);
	// A server refresh (header reload, officer change) replaces the local copy.
	const [source, setSource] = useState(initialData);
	if (initialData !== source) {
		setSource(initialData);
		setData(initialData);
	}
	const [pending, setPending] = useState(false);
	// A retried archive of the same record revision keeps its request identity.
	const archiveRequests = useRef(new Map<string, string>());

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
		toast.success(successMessage(change.kind, t));
		return true;
	}

	/** The current active type for editing; `null` once a load failure is reported. */
	async function loadType(id: string) {
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
			return null;
		}
		return result.data.record;
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

	return { data, pending, submit, loadType, archive };
}
