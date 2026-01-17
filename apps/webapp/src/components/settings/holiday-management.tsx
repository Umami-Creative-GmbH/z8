"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useCallback, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/lib/query";
import { AssignmentDialog } from "./assignment-dialog";
import { AssignmentManager } from "./assignment-manager";
import { CategoryDialog } from "./category-dialog";
import { CategoryManager } from "./category-manager";
import { HolidayAssignmentDialog } from "./holiday-assignment-dialog";
import { HolidayDialog } from "./holiday-dialog";
import { HolidayImportDialog } from "./holiday-import-dialog";
import { HolidayList } from "./holiday-list";
import { PresetDialog } from "./preset-dialog";
import { PresetManager } from "./preset-manager";

interface HolidayManagementProps {
	organizationId: string;
}

// Type definitions for entities used in handlers
interface Holiday {
	id: string;
	name: string;
	description: string | null;
	startDate: Date;
	endDate: Date;
	recurrenceType: string;
	isActive: boolean;
	categoryId: string;
	category: {
		id: string;
		name: string;
		type: string;
		color: string | null;
	};
}

interface HolidayCategory {
	id: string;
	name: string;
	description: string | null;
	type: string;
	color: string | null;
	blocksTimeEntry: boolean;
	excludeFromCalculations: boolean;
	isActive: boolean;
}

interface Preset {
	id: string;
	name: string;
	description: string | null;
	countryCode: string | null;
	stateCode: string | null;
	regionCode: string | null;
	color: string | null;
	isActive: boolean;
}

type AssignmentType = "organization" | "team" | "employee";

export function HolidayManagement({ organizationId }: HolidayManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Holiday dialog state
	const [holidayDialogOpen, setHolidayDialogOpen] = useState(false);
	const [editingHoliday, setEditingHoliday] = useState<Holiday | undefined>(undefined);

	// Category dialog state
	const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
	const [editingCategory, setEditingCategory] = useState<HolidayCategory | undefined>(undefined);

	// Import dialog state
	const [importDialogOpen, setImportDialogOpen] = useState(false);

	// Preset dialog state
	const [presetDialogOpen, setPresetDialogOpen] = useState(false);
	const [editingPresetId, setEditingPresetId] = useState<string | null>(null);

	// Preset assignment dialog state
	const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
	const [assignmentType, setAssignmentType] = useState<AssignmentType>("organization");

	// Holiday assignment dialog state
	const [holidayAssignmentDialogOpen, setHolidayAssignmentDialogOpen] = useState(false);
	const [holidayAssignmentType, setHolidayAssignmentType] = useState<AssignmentType>("organization");

	// Holiday handlers - memoized to prevent unnecessary child re-renders
	const handleAddHolidayClick = useCallback(() => {
		setEditingHoliday(undefined);
		setHolidayDialogOpen(true);
	}, []);

	const handleEditHolidayClick = useCallback((holiday: Holiday) => {
		setEditingHoliday(holiday);
		setHolidayDialogOpen(true);
	}, []);

	const handleHolidaySuccess = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: queryKeys.holidays.list(organizationId) });
	}, [queryClient, organizationId]);

	// Category handlers - memoized
	const handleAddCategoryClick = useCallback(() => {
		setEditingCategory(undefined);
		setCategoryDialogOpen(true);
	}, []);

	const handleEditCategoryClick = useCallback((category: HolidayCategory) => {
		setEditingCategory(category);
		setCategoryDialogOpen(true);
	}, []);

	const handleCategorySuccess = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: queryKeys.holidayCategories.list(organizationId) });
	}, [queryClient, organizationId]);

	// Preset handlers - memoized
	const handleImportClick = useCallback(() => {
		setImportDialogOpen(true);
	}, []);

	const handleEditPresetClick = useCallback((preset: Preset) => {
		setEditingPresetId(preset.id);
		setPresetDialogOpen(true);
	}, []);

	const handlePresetSuccess = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: queryKeys.holidayPresets.list(organizationId) });
	}, [queryClient, organizationId]);

	// Preset assignment handlers - memoized
	const handleAssignClick = useCallback((type: AssignmentType) => {
		setAssignmentType(type);
		setAssignmentDialogOpen(true);
	}, []);

	const handleAssignmentSuccess = useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.holidayPresetAssignments.list(organizationId),
		});
	}, [queryClient, organizationId]);

	// Holiday assignment handlers - memoized
	const handleHolidayAssignClick = useCallback((type: AssignmentType) => {
		setHolidayAssignmentType(type);
		setHolidayAssignmentDialogOpen(true);
	}, []);

	const handleHolidayAssignmentSuccess = useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.holidayAssignments.list(organizationId),
		});
	}, [queryClient, organizationId]);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-bold">{t("settings.holidays.title", "Holiday Management")}</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.holidays.description",
						"Manage holiday presets and assignments for your organization",
					)}
				</p>
			</div>

			<Tabs defaultValue="presets" className="space-y-4">
				<TabsList>
					<TabsTrigger value="presets">
						{t("settings.holidays.tab.presets", "Holiday Presets")}
					</TabsTrigger>
					<TabsTrigger value="assignments">
						{t("settings.holidays.tab.assignments", "Assignments")}
					</TabsTrigger>
					<TabsTrigger value="custom">
						{t("settings.holidays.tab.custom", "Custom Holidays")}
					</TabsTrigger>
					<TabsTrigger value="categories">
						{t("settings.holidays.tab.categories", "Categories")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="presets" className="space-y-4">
					<PresetManager
						organizationId={organizationId}
						onImportClick={handleImportClick}
						onEditClick={handleEditPresetClick}
					/>
				</TabsContent>

				<TabsContent value="assignments" className="space-y-4">
					<AssignmentManager
						organizationId={organizationId}
						onAssignClick={handleAssignClick}
						onHolidayAssignClick={handleHolidayAssignClick}
					/>
				</TabsContent>

				<TabsContent value="custom" className="space-y-4">
					<HolidayList
						organizationId={organizationId}
						onAddClick={handleAddHolidayClick}
						onEditClick={handleEditHolidayClick}
					/>
				</TabsContent>

				<TabsContent value="categories" className="space-y-4">
					<CategoryManager
						organizationId={organizationId}
						onAddClick={handleAddCategoryClick}
						onEditClick={handleEditCategoryClick}
					/>
				</TabsContent>
			</Tabs>

			<HolidayDialog
				open={holidayDialogOpen}
				onOpenChange={setHolidayDialogOpen}
				organizationId={organizationId}
				editingHoliday={editingHoliday}
				onSuccess={handleHolidaySuccess}
			/>

			<CategoryDialog
				open={categoryDialogOpen}
				onOpenChange={setCategoryDialogOpen}
				organizationId={organizationId}
				editingCategory={editingCategory}
				onSuccess={handleCategorySuccess}
			/>

			<HolidayImportDialog
				open={importDialogOpen}
				onOpenChange={setImportDialogOpen}
				organizationId={organizationId}
				onSuccess={handlePresetSuccess}
			/>

			<PresetDialog
				open={presetDialogOpen}
				onOpenChange={setPresetDialogOpen}
				organizationId={organizationId}
				presetId={editingPresetId}
				onSuccess={handlePresetSuccess}
			/>

			<AssignmentDialog
				open={assignmentDialogOpen}
				onOpenChange={setAssignmentDialogOpen}
				organizationId={organizationId}
				assignmentType={assignmentType}
				onSuccess={handleAssignmentSuccess}
			/>

			<HolidayAssignmentDialog
				open={holidayAssignmentDialogOpen}
				onOpenChange={setHolidayAssignmentDialogOpen}
				organizationId={organizationId}
				assignmentType={holidayAssignmentType}
				onSuccess={handleHolidayAssignmentSuccess}
			/>
		</div>
	);
}
