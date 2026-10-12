"use client";

import {
	IconArchive,
	IconArrowDown,
	IconArrowUp,
	IconPlus,
	IconRestore,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CUSTOM_FIELD_OPTION_LABEL_MAX_LENGTH } from "@/lib/organization/custom-fields/definition-rules";
import type {
	CustomFieldDefinitionView,
	CustomFieldOptionView,
} from "@/lib/organization/custom-fields/definitions";
import type { RunCustomFieldChange } from "./custom-fields-settings";

/**
 * The options of a select custom field (#817): each change is saved at once.
 * Options are renamed in place, moved up or down, archived and restored; an
 * archived option stays on the records that use it.
 */
export function CustomFieldOptionsEditor({
	field,
	pending,
	runChange,
}: {
	field: CustomFieldDefinitionView;
	pending: boolean;
	runChange: RunCustomFieldChange;
}) {
	const { t } = useTranslate();
	const [newLabel, setNewLabel] = useState("");
	const active = field.options.filter((option) => !option.archived);
	const archived = field.options.filter((option) => option.archived);

	function move(index: number, offset: -1 | 1) {
		const ids = active.map((option) => option.id);
		const [moved] = ids.splice(index, 1);
		ids.splice(index + offset, 0, moved);
		void runChange({ kind: "reorderOptions", fieldId: field.id, optionIds: ids });
	}

	async function add() {
		const label = newLabel.trim();
		if (!label) return;
		if (await runChange({ kind: "addOption", fieldId: field.id, label })) setNewLabel("");
	}

	return (
		<div className="space-y-3 rounded-lg border p-3">
			<h3 className="text-sm font-medium">{t("settings.customFields.options.title", "Options")}</h3>
			<ul aria-label={t("settings.customFields.options.list", "Options")} className="space-y-2">
				{active.map((option, index) => (
					<li key={option.id} className="flex items-center gap-2">
						<OptionLabelInput option={option} pending={pending} runChange={runChange} />
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={pending || index === 0}
							onClick={() => move(index, -1)}
							aria-label={t("settings.customFields.options.moveUp", "Move {label} up", {
								label: option.label,
							})}
						>
							<IconArrowUp aria-hidden="true" className="size-4" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={pending || index === active.length - 1}
							onClick={() => move(index, 1)}
							aria-label={t("settings.customFields.options.moveDown", "Move {label} down", {
								label: option.label,
							})}
						>
							<IconArrowDown aria-hidden="true" className="size-4" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={pending || active.length <= 1}
							onClick={() => void runChange({ kind: "archiveOption", optionId: option.id })}
							aria-label={t("settings.customFields.options.archive", "Archive {label}", {
								label: option.label,
							})}
						>
							<IconArchive aria-hidden="true" className="size-4" />
						</Button>
					</li>
				))}
				{archived.map((option) => (
					<li key={option.id} className="flex items-center gap-2">
						<OptionLabelInput option={option} pending={pending} runChange={runChange} />
						<Badge variant="outline">
							{t("settings.customFields.options.archived", "Archived")}
						</Badge>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={pending}
							onClick={() => void runChange({ kind: "restoreOption", optionId: option.id })}
							aria-label={t("settings.customFields.options.restore", "Restore {label}", {
								label: option.label,
							})}
						>
							<IconRestore aria-hidden="true" className="size-4" />
						</Button>
					</li>
				))}
			</ul>
			<div className="flex items-end gap-2">
				<div className="grid flex-1 gap-1">
					<Label htmlFor={`new-option-${field.id}`}>
						{t("settings.customFields.options.new", "New option")}
					</Label>
					<Input
						id={`new-option-${field.id}`}
						value={newLabel}
						maxLength={CUSTOM_FIELD_OPTION_LABEL_MAX_LENGTH}
						onChange={(event) => setNewLabel(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.nativeEvent.isComposing) {
								event.preventDefault();
								void add();
							}
						}}
					/>
				</div>
				<Button
					type="button"
					variant="outline"
					disabled={pending || !newLabel.trim()}
					onClick={() => void add()}
				>
					<IconPlus aria-hidden="true" className="size-4" />
					{t("settings.customFields.options.add", "Add option")}
				</Button>
			</div>
		</div>
	);
}

function OptionLabelInput({
	option,
	pending,
	runChange,
}: {
	option: CustomFieldOptionView;
	pending: boolean;
	runChange: RunCustomFieldChange;
}) {
	const { t } = useTranslate();
	const [label, setLabel] = useState(option.label);

	async function save() {
		const next = label.trim();
		if (!next || next === option.label) {
			setLabel(option.label);
			return;
		}
		if (!(await runChange({ kind: "renameOption", optionId: option.id, label: next }))) {
			setLabel(option.label);
		}
	}

	return (
		<Input
			className="flex-1"
			value={label}
			maxLength={CUSTOM_FIELD_OPTION_LABEL_MAX_LENGTH}
			disabled={pending}
			aria-label={t("settings.customFields.options.label", "Option name")}
			onChange={(event) => setLabel(event.target.value)}
			onBlur={() => void save()}
			onKeyDown={(event) => {
				if (event.key === "Enter" && !event.nativeEvent.isComposing) {
					event.preventDefault();
					void save();
				}
			}}
		/>
	);
}
