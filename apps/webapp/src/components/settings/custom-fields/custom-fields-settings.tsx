"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	IconArchive,
	IconGripVertical,
	IconPencil,
	IconPlus,
	IconRestore,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { changeCustomFields } from "@/app/[locale]/(app)/settings/custom-fields/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	CUSTOM_FIELD_ENTITIES,
	type CustomFieldChange,
	type CustomFieldEntity,
	MAX_ACTIVE_CUSTOM_FIELDS,
} from "@/lib/organization/custom-fields/definition-rules";
import type { CustomFieldDefinitionView } from "@/lib/organization/custom-fields/definitions";
import { CustomFieldDialog } from "./custom-field-dialog";
import { entityLabel, levelLabel, refusalMessage, typeLabel } from "./custom-field-labels";

export type RunCustomFieldChange = (change: CustomFieldChange) => Promise<boolean>;

/** `session` remounts the dialog each time it opens; `fieldId` null creates a field. */
type DialogState = { session: number; open: boolean; fieldId: string | null };

/** The server action's result, or null when the request itself failed. */
async function sendChange(change: CustomFieldChange) {
	try {
		return await changeCustomFields(change);
	} catch {
		return null;
	}
}

const isEntity = (value: unknown): value is CustomFieldEntity =>
	typeof value === "string" && (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(value);

/**
 * The custom fields settings (#817): one tab per entity, active fields in
 * drag-and-drop order, archived fields apart. Org admins only (page gate and
 * server actions).
 */
export function CustomFieldsSettings({
	initialFields,
}: {
	initialFields: CustomFieldDefinitionView[];
}) {
	const { t } = useTranslate();
	const [fields, setFields] = useState(initialFields);
	const [entity, setEntity] = useState<CustomFieldEntity>("employee");
	const [dialog, setDialog] = useState<DialogState>({ session: 0, open: false, fieldId: null });
	const [pending, setPending] = useState(false);

	const runChange: RunCustomFieldChange = async (change) => {
		setPending(true);
		const result = await sendChange(change);
		setPending(false);
		if (result === null) {
			toast.error(t("settings.customFields.saveFailed", "The change could not be saved."));
			return false;
		}
		if (!result.success) {
			toast.error(result.error);
			return false;
		}
		if (!result.data.ok) {
			toast.error(refusalMessage(t, result.data.reason, result.data.configurations));
			return false;
		}
		setFields(result.data.fields);
		return true;
	};

	const editedField =
		dialog.fieldId === null ? undefined : fields.find((field) => field.id === dialog.fieldId);
	const openDialog = (fieldId: string | null) =>
		setDialog((current) => ({ session: current.session + 1, open: true, fieldId }));

	return (
		<>
			<Tabs
				value={entity}
				onValueChange={(value: unknown) => {
					if (isEntity(value)) setEntity(value);
				}}
				className="gap-4"
			>
				<div className="max-w-full overflow-x-auto">
					<TabsList>
						{CUSTOM_FIELD_ENTITIES.map((value) => (
							<TabsTrigger key={value} value={value}>
								{entityLabel(t, value)}
							</TabsTrigger>
						))}
					</TabsList>
				</div>
				{CUSTOM_FIELD_ENTITIES.map((value) => (
					<TabsContent key={value} value={value}>
						<EntityFields
							entity={value}
							fields={fields.filter((field) => field.entity === value)}
							pending={pending}
							onAdd={() => openDialog(null)}
							onEdit={(fieldId) => openDialog(fieldId)}
							onReorder={(ordered) => {
								const previous = fields;
								setFields(
									fields.map((field) => {
										const position = ordered.indexOf(field.id);
										return position === -1 ? field : { ...field, position };
									}),
								);
								void runChange({ kind: "reorder", entity: value, fieldIds: ordered }).then((ok) => {
									if (!ok) setFields(previous);
								});
							}}
							runChange={runChange}
						/>
					</TabsContent>
				))}
			</Tabs>
			<CustomFieldDialog
				key={dialog.session}
				open={dialog.open && (dialog.fieldId === null || editedField !== undefined)}
				onOpenChange={(open) => {
					if (!open) setDialog((current) => ({ ...current, open: false }));
				}}
				entity={entity}
				field={editedField}
				pending={pending}
				runChange={runChange}
			/>
		</>
	);
}

function EntityFields({
	entity,
	fields,
	pending,
	onAdd,
	onEdit,
	onReorder,
	runChange,
}: {
	entity: CustomFieldEntity;
	fields: CustomFieldDefinitionView[];
	pending: boolean;
	onAdd: () => void;
	onEdit: (fieldId: string) => void;
	onReorder: (orderedIds: string[]) => void;
	runChange: RunCustomFieldChange;
}) {
	const { t } = useTranslate();
	const dndId = useId();
	const active = fields.filter((field) => !field.archived).sort((a, b) => a.position - b.position);
	const archived = fields.filter((field) => field.archived);
	const atCap = active.length >= MAX_ACTIVE_CUSTOM_FIELDS;
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	function handleDragEnd(event: DragEndEvent) {
		const { active: dragged, over } = event;
		if (!over || dragged.id === over.id) return;
		const ids = active.map((field) => field.id);
		const from = ids.indexOf(String(dragged.id));
		const to = ids.indexOf(String(over.id));
		if (from === -1 || to === -1) return;
		onReorder(arrayMove(ids, from, to));
	}

	return (
		<section className="space-y-4" aria-label={entityLabel(t, entity)}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-sm text-muted-foreground">
					{t("settings.customFields.activeCount", "{count} of {max} active fields", {
						count: active.length,
						max: MAX_ACTIVE_CUSTOM_FIELDS,
					})}
				</p>
				<Button type="button" size="sm" onClick={onAdd} disabled={atCap || pending}>
					<IconPlus aria-hidden="true" className="size-4" />
					{t("settings.customFields.add", "Add custom field")}
				</Button>
			</div>
			{atCap ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.customFields.capReached",
						"Each record type can have at most 25 active custom fields. Archive one to add another.",
					)}
				</p>
			) : null}

			{active.length === 0 ? (
				<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					{t("settings.customFields.empty", "No custom fields yet.")}
				</p>
			) : (
				<DndContext
					id={dndId}
					sensors={sensors}
					collisionDetection={closestCenter}
					modifiers={[restrictToVerticalAxis]}
					onDragEnd={handleDragEnd}
				>
					<SortableContext
						items={active.map((field) => field.id)}
						strategy={verticalListSortingStrategy}
					>
						<ul
							aria-label={t("settings.customFields.activeList", "Active custom fields")}
							className="divide-y rounded-lg border"
						>
							{active.map((field) => (
								<SortableFieldRow
									key={field.id}
									field={field}
									pending={pending}
									onEdit={() => onEdit(field.id)}
									onArchive={() => void runChange({ kind: "archive", fieldId: field.id })}
								/>
							))}
						</ul>
					</SortableContext>
				</DndContext>
			)}

			{archived.length > 0 ? (
				<div className="space-y-2">
					<h3 className="text-sm font-medium">
						{t("settings.customFields.archivedTitle", "Archived")}
					</h3>
					<ul
						aria-label={t("settings.customFields.archivedList", "Archived custom fields")}
						className="divide-y rounded-lg border"
					>
						{archived.map((field) => (
							<li key={field.id} className="flex items-center gap-3 p-3">
								<div className="min-w-0 flex-1">
									<p className="truncate font-medium text-muted-foreground">{field.name}</p>
									<p className="text-xs text-muted-foreground">{typeLabel(t, field.type)}</p>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={pending}
									onClick={() => void runChange({ kind: "restore", fieldId: field.id })}
									aria-label={t("settings.customFields.restoreField", "Restore {name}", {
										name: field.name,
									})}
								>
									<IconRestore aria-hidden="true" className="size-4" />
									{t("settings.customFields.restore", "Restore")}
								</Button>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</section>
	);
}

function SortableFieldRow({
	field,
	pending,
	onEdit,
	onArchive,
}: {
	field: CustomFieldDefinitionView;
	pending: boolean;
	onEdit: () => void;
	onArchive: () => void;
}) {
	const { t } = useTranslate();
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: field.id });

	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Transform.toString(transform), transition }}
			className={`flex items-center gap-3 bg-card p-3 ${isDragging ? "relative z-10 shadow-md" : ""}`}
		>
			<button
				type="button"
				ref={setActivatorNodeRef}
				className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-2"
				aria-label={t("settings.customFields.reorderField", "Reorder {name}", { name: field.name })}
				{...attributes}
				{...listeners}
			>
				<IconGripVertical aria-hidden="true" className="size-4" />
			</button>
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex flex-wrap items-center gap-2">
					<span data-testid="custom-field-name" className="truncate font-medium">
						{field.name}
					</span>
					<Badge variant="secondary">{typeLabel(t, field.type)}</Badge>
					{field.required ? (
						<Badge variant="outline">{t("settings.customFields.required", "Required")}</Badge>
					) : null}
					{field.tracked ? (
						<Badge variant="outline">{t("settings.customFields.tracked", "Tracked")}</Badge>
					) : null}
				</div>
				<p className="text-xs text-muted-foreground">
					{t(
						"settings.customFields.accessSummary",
						"Visible to: {visibility} · Edited by: {edit}",
						{
							visibility: levelLabel(t, field.visibility),
							edit: levelLabel(t, field.editLevel),
						},
					)}
				</p>
			</div>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				disabled={pending}
				onClick={onEdit}
				aria-label={t("settings.customFields.editField", "Edit {name}", { name: field.name })}
			>
				<IconPencil aria-hidden="true" className="size-4" />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				disabled={pending}
				onClick={onArchive}
				aria-label={t("settings.customFields.archiveField", "Archive {name}", { name: field.name })}
			>
				<IconArchive aria-hidden="true" className="size-4" />
			</Button>
		</li>
	);
}
