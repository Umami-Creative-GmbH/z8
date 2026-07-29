"use client";

import { IconLoader2, IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	type DatevConfigResult,
	deleteMappingAction,
	getAbsenceCategoriesAction,
	getMappingsAction,
	getWorkCategoriesAction,
	saveMappingAction,
} from "@/app/[locale]/(app)/settings/payroll-export/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
	ActionPanelTrigger,
} from "@/components/ui/action-panel";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { WageTypeMapping } from "@/lib/payroll-export/types";

interface WageTypeMappingsProps {
	organizationId: string;
	config: DatevConfigResult | null;
}
interface WorkCategory {
	id: string;
	name: string;
	factor: string | null;
}
interface AbsenceCategory {
	id: string;
	name: string;
	type: string | null;
}
type SourceType = "work_category" | "absence_category" | "special";
type Translate = ReturnType<typeof useTranslate>["t"];
interface MappingDraft {
	sourceType: SourceType;
	workCategoryId: string;
	absenceCategoryId: string;
	specialCategory: string;
	datevCode: string;
	datevName: string;
	lexwareCode: string;
	lexwareName: string;
	sageCode: string;
	sageName: string;
}
const EMPTY_DRAFT: MappingDraft = {
	sourceType: "work_category",
	workCategoryId: "",
	absenceCategoryId: "",
	specialCategory: "",
	datevCode: "",
	datevName: "",
	lexwareCode: "",
	lexwareName: "",
	sageCode: "",
	sageName: "",
};

export function WageTypeMappings({
	organizationId,
	config,
}: WageTypeMappingsProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const [mappings, setMappings] = useState<WageTypeMapping[]>([]);
	const [workCategories, setWorkCategories] = useState<WorkCategory[]>([]);
	const [absenceCategories, setAbsenceCategories] = useState<AbsenceCategory[]>(
		[],
	);
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [draft, setDraft] = useState<MappingDraft>(EMPTY_DRAFT);
	const updateDraft = <K extends keyof MappingDraft>(
		key: K,
		value: MappingDraft[K],
	) => setDraft((current) => ({ ...current, [key]: value }));
	const resetForm = () => setDraft(EMPTY_DRAFT);
	const refreshData = async () =>
		startTransition(async () => {
			const [mappingsResult, workResult, absenceResult] = await Promise.all([
				getMappingsAction(organizationId),
				getWorkCategoriesAction(organizationId),
				getAbsenceCategoriesAction(organizationId),
			]);
			if (mappingsResult.success) setMappings(mappingsResult.data);
			if (workResult.success) setWorkCategories(workResult.data);
			if (absenceResult.success) setAbsenceCategories(absenceResult.data);
		});
	const loadData = useEffectEvent(refreshData);
	useEffect(() => {
		if (config) loadData();
	}, [config]);
	const saveMapping = () => {
		if (!config) return;
		startTransition(async () => {
			const result = await saveMappingAction({
				organizationId,
				configId: config.id,
				workCategoryId:
					draft.sourceType === "work_category" ? draft.workCategoryId : null,
				absenceCategoryId:
					draft.sourceType === "absence_category"
						? draft.absenceCategoryId
						: null,
				specialCategory:
					draft.sourceType === "special" ? draft.specialCategory : null,
				datevWageTypeCode: draft.datevCode || null,
				datevWageTypeName: draft.datevName || null,
				lexwareWageTypeCode: draft.lexwareCode || null,
				lexwareWageTypeName: draft.lexwareName || null,
				sageWageTypeCode: draft.sageCode || null,
				sageWageTypeName: draft.sageName || null,
			});
			if (result.success) {
				toast.success(
					t("settings.payrollExport.mappings.saveSuccess", "Mapping saved"),
				);
				setIsDialogOpen(false);
				resetForm();
				refreshData();
			} else
				toast.error(
					t(
						"settings.payrollExport.mappings.saveError",
						"Failed to save mapping",
					),
					{ description: result.error },
				);
		});
	};
	const deleteMapping = (mappingId: string) =>
		startTransition(async () => {
			const result = await deleteMappingAction({ organizationId, mappingId });
			if (result.success) {
				toast.success(
					t("settings.payrollExport.mappings.deleteSuccess", "Mapping deleted"),
				);
				refreshData();
			} else
				toast.error(
					t(
						"settings.payrollExport.mappings.deleteError",
						"Failed to delete mapping",
					),
					{ description: result.error },
				);
		});

	if (!config)
		return (
			<Card>
				<CardHeader>
					<CardTitle>
						{t("settings.payrollExport.mappings.title", "Wage Type Mappings")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.payrollExport.mappings.configureFirst",
							"Please configure at least one payroll export format (DATEV, Lexware, or Sage) before setting up mappings.",
						)}
					</CardDescription>
				</CardHeader>
			</Card>
		);
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between">
				<div>
					<CardTitle>
						{t("settings.payrollExport.mappings.title", "Wage Type Mappings")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.payrollExport.mappings.description",
							"Map your work categories and absence types to payroll wage type codes",
						)}
					</CardDescription>
				</div>
				<MappingPanel
					open={isDialogOpen}
					onOpenChange={setIsDialogOpen}
					draft={draft}
					updateDraft={updateDraft}
					workCategories={workCategories}
					absenceCategories={absenceCategories}
					isPending={isPending}
					onReset={resetForm}
					onSave={saveMapping}
					t={t}
				/>
			</CardHeader>
			<CardContent>
				<MappingsTable
					mappings={mappings}
					isPending={isPending}
					onDelete={deleteMapping}
					t={t}
				/>
			</CardContent>
		</Card>
	);
}

function MappingPanel({
	open,
	onOpenChange,
	draft,
	updateDraft,
	workCategories,
	absenceCategories,
	isPending,
	onReset,
	onSave,
	t,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	draft: MappingDraft;
	updateDraft: <K extends keyof MappingDraft>(
		key: K,
		value: MappingDraft[K],
	) => void;
	workCategories: WorkCategory[];
	absenceCategories: AbsenceCategory[];
	isPending: boolean;
	onReset: () => void;
	onSave: () => void;
	t: Translate;
}) {
	const specialCategories = [
		{
			id: "overtime",
			name: t("settings.payrollExport.specialCategory.overtime", "Overtime"),
		},
		{
			id: "holiday_compensation",
			name: t(
				"settings.payrollExport.specialCategory.holidayCompensation",
				"Holiday Compensation",
			),
		},
		{
			id: "overtime_reduction",
			name: t(
				"settings.payrollExport.specialCategory.overtimeReduction",
				"Overtime Reduction",
			),
		},
	];
	const sourceMissing =
		draft.sourceType === "work_category"
			? !draft.workCategoryId
			: draft.sourceType === "absence_category"
				? !draft.absenceCategoryId
				: !draft.specialCategory;
	const disabled =
		isPending ||
		(!draft.datevCode && !draft.lexwareCode && !draft.sageCode) ||
		sourceMissing;
	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelTrigger asChild>
				<Button
					onClick={onReset}
					aria-label={t(
						"settings.payrollExport.mappings.addMapping",
						"Add Mapping",
					)}
				>
					<IconPlus className="mr-2 size-4" aria-hidden="true" />
					{t("settings.payrollExport.mappings.addMapping", "Add Mapping")}
				</Button>
			</ActionPanelTrigger>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t(
							"settings.payrollExport.mappings.addMappingTitle",
							"Add Wage Type Mapping",
						)}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.payrollExport.mappings.addMappingDescription",
							"Map a category to payroll wage type codes for each format",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody className="space-y-4">
					<div className="space-y-2">
						<Label>
							{t("settings.payrollExport.mappings.sourceType", "Source Type")}
						</Label>
						<Select
							value={draft.sourceType}
							onValueChange={(value) =>
								updateDraft("sourceType", value as SourceType)
							}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="work_category">
									{t(
										"settings.payrollExport.mappings.type.workCategory",
										"Work Category",
									)}
								</SelectItem>
								<SelectItem value="absence_category">
									{t(
										"settings.payrollExport.mappings.type.absenceCategory",
										"Absence Category",
									)}
								</SelectItem>
								<SelectItem value="special">
									{t(
										"settings.payrollExport.mappings.type.special",
										"Special Category",
									)}
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{draft.sourceType === "work_category" ? (
						<CategorySelect
							label={t(
								"settings.payrollExport.mappings.workCategory",
								"Work Category",
							)}
							placeholder={t(
								"settings.payrollExport.mappings.selectWorkCategory",
								"Select work category",
							)}
							value={draft.workCategoryId}
							items={workCategories}
							onChange={(value) => updateDraft("workCategoryId", value)}
						/>
					) : null}
					{draft.sourceType === "absence_category" ? (
						<CategorySelect
							label={t(
								"settings.payrollExport.mappings.absenceCategory",
								"Absence Category",
							)}
							placeholder={t(
								"settings.payrollExport.mappings.selectAbsenceCategory",
								"Select absence category",
							)}
							value={draft.absenceCategoryId}
							items={absenceCategories}
							onChange={(value) => updateDraft("absenceCategoryId", value)}
						/>
					) : null}
					{draft.sourceType === "special" ? (
						<CategorySelect
							label={t(
								"settings.payrollExport.mappings.specialCategory",
								"Special Category",
							)}
							placeholder={t(
								"settings.payrollExport.mappings.selectSpecialCategory",
								"Select special category",
							)}
							value={draft.specialCategory}
							items={specialCategories}
							onChange={(value) => updateDraft("specialCategory", value)}
						/>
					) : null}
					<Separator />
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.payrollExport.mappings.formatSpecificHint",
							"Configure wage type codes for each payroll format. At least one is required.",
						)}
					</p>
					<WageTypeFields
						format="DATEV"
						code={draft.datevCode}
						name={draft.datevName}
						codePlaceholder="1000"
						namePlaceholder="Arbeitszeit"
						onCodeChange={(value) => updateDraft("datevCode", value)}
						onNameChange={(value) => updateDraft("datevName", value)}
						t={t}
					/>
					<WageTypeFields
						format="Lexware"
						code={draft.lexwareCode}
						name={draft.lexwareName}
						codePlaceholder="100"
						namePlaceholder="Lohn"
						onCodeChange={(value) => updateDraft("lexwareCode", value)}
						onNameChange={(value) => updateDraft("lexwareName", value)}
						t={t}
					/>
					<WageTypeFields
						format="Sage"
						code={draft.sageCode}
						name={draft.sageName}
						codePlaceholder="1000"
						namePlaceholder="Arbeitszeit"
						onCodeChange={(value) => updateDraft("sageCode", value)}
						onNameChange={(value) => updateDraft("sageName", value)}
						t={t}
					/>
				</ActionPanelBody>
				<ActionPanelFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel", "Cancel")}
					</Button>
					<Button onClick={onSave} disabled={disabled}>
						{isPending ? (
							<>
								<IconLoader2 className="mr-2 size-4 animate-spin" />
								{t("common.saving", "Saving…")}
							</>
						) : (
							t("common.save", "Save")
						)}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function CategorySelect({
	label,
	placeholder,
	value,
	items,
	onChange,
}: {
	label: string;
	placeholder: string;
	value: string;
	items: Array<{ id: string; name: string }>;
	onChange: (value: string) => void;
}) {
	return (
		<div className="space-y-2">
			<Label>{label}</Label>
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					{items.map((item) => (
						<SelectItem key={item.id} value={item.id}>
							{item.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function WageTypeFields({
	format,
	code,
	name,
	codePlaceholder,
	namePlaceholder,
	onCodeChange,
	onNameChange,
	t,
}: {
	format: string;
	code: string;
	name: string;
	codePlaceholder: string;
	namePlaceholder: string;
	onCodeChange: (value: string) => void;
	onNameChange: (value: string) => void;
	t: Translate;
}) {
	return (
		<div className="space-y-2 rounded-lg border p-3">
			<Badge variant="outline" className="font-mono text-xs">
				{format}
			</Badge>
			<div className="grid grid-cols-2 gap-2">
				<div className="space-y-1">
					<Label className="text-xs">
						{t("settings.payrollExport.mappings.code", "Code")}
					</Label>
					<Input
						placeholder={codePlaceholder}
						value={code}
						onChange={(event) => onCodeChange(event.target.value)}
						autoComplete="off"
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">
						{t("settings.payrollExport.mappings.description", "Description")}
					</Label>
					<Input
						placeholder={namePlaceholder}
						value={name}
						onChange={(event) => onNameChange(event.target.value)}
						autoComplete="off"
					/>
				</div>
			</div>
		</div>
	);
}

function MappingsTable({
	mappings,
	isPending,
	onDelete,
	t,
}: {
	mappings: WageTypeMapping[];
	isPending: boolean;
	onDelete: (id: string) => void;
	t: Translate;
}) {
	if (isPending && mappings.length === 0)
		return (
			<div className="flex items-center justify-center py-8">
				<IconLoader2 className="size-6 animate-spin text-muted-foreground" />
			</div>
		);
	if (mappings.length === 0)
		return (
			<div className="py-8 text-center text-muted-foreground">
				{t(
					"settings.payrollExport.mappings.noMappings",
					"No mappings configured yet",
				)}
			</div>
		);
	return (
		<TooltipProvider>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>
							{t("settings.payrollExport.mappings.table.type", "Type")}
						</TableHead>
						<TableHead>
							{t("settings.payrollExport.mappings.table.category", "Category")}
						</TableHead>
						<TableHead>
							{t("settings.payrollExport.mappings.table.datev", "DATEV")}
						</TableHead>
						<TableHead>
							{t("settings.payrollExport.mappings.table.lexware", "Lexware")}
						</TableHead>
						<TableHead>
							{t("settings.payrollExport.mappings.table.sage", "Sage")}
						</TableHead>
						<TableHead className="w-[100px]" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{mappings.map((mapping) => (
						<TableRow key={mapping.id}>
							<TableCell className="text-muted-foreground">
								{getSourceTypeLabel(mapping, t)}
							</TableCell>
							<TableCell className="font-medium">
								{getDisplayName(mapping)}
							</TableCell>
							<WageCodeCell
								code={mapping.datevWageTypeCode}
								name={mapping.datevWageTypeName}
							/>
							<WageCodeCell
								code={mapping.lexwareWageTypeCode}
								name={mapping.lexwareWageTypeName}
							/>
							<WageCodeCell
								code={mapping.sageWageTypeCode}
								name={mapping.sageWageTypeName}
							/>
							<TableCell>
								<DeleteMappingButton
									mappingId={mapping.id}
									onDelete={onDelete}
									t={t}
								/>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</TooltipProvider>
	);
}

function WageCodeCell({
	code,
	name,
}: {
	code: string | null;
	name: string | null;
}) {
	return (
		<TableCell>
			{code ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="cursor-help font-mono">{code}</span>
					</TooltipTrigger>
					<TooltipContent>{name || code}</TooltipContent>
				</Tooltip>
			) : (
				<span className="text-muted-foreground">-</span>
			)}
		</TableCell>
	);
}

function DeleteMappingButton({
	mappingId,
	onDelete,
	t,
}: {
	mappingId: string;
	onDelete: (id: string) => void;
	t: Translate;
}) {
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="text-destructive"
					aria-label={t(
						"settings.payrollExport.mappings.deleteMapping",
						"Delete mapping",
					)}
				>
					<IconTrash className="size-4" />
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("settings.payrollExport.mappings.deleteTitle", "Delete Mapping")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.payrollExport.mappings.deleteDescription",
							"Are you sure you want to delete this wage type mapping?",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => onDelete(mappingId)}
						className="bg-destructive text-destructive-foreground"
					>
						{t("common.delete", "Delete")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function getDisplayName(mapping: WageTypeMapping) {
	if (mapping.workCategoryName) return mapping.workCategoryName;
	if (mapping.absenceCategoryName) return mapping.absenceCategoryName;
	return (
		mapping.specialCategory
			?.split("_")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" ") ?? "-"
	);
}

function getSourceTypeLabel(mapping: WageTypeMapping, t: Translate) {
	if (mapping.workCategoryId)
		return t(
			"settings.payrollExport.mappings.type.workCategory",
			"Work Category",
		);
	if (mapping.absenceCategoryId)
		return t("settings.payrollExport.mappings.type.absenceCategory", "Absence");
	if (mapping.specialCategory)
		return t("settings.payrollExport.mappings.type.special", "Special");
	return "-";
}
