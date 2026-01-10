"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
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

export function HolidayManagement({ organizationId }: HolidayManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Holiday dialog state
	const [holidayDialogOpen, setHolidayDialogOpen] = useState(false);
	const [editingHoliday, setEditingHoliday] = useState<any>(null);

	// Category dialog state
	const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
	const [editingCategory, setEditingCategory] = useState<any>(null);

	// Import dialog state
	const [importDialogOpen, setImportDialogOpen] = useState(false);

	// Preset dialog state
	const [presetDialogOpen, setPresetDialogOpen] = useState(false);
	const [editingPresetId, setEditingPresetId] = useState<string | null>(null);

	// Preset assignment dialog state
	const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
	const [assignmentType, setAssignmentType] = useState<"organization" | "team" | "employee">(
		"organization",
	);

	// Holiday assignment dialog state
	const [holidayAssignmentDialogOpen, setHolidayAssignmentDialogOpen] = useState(false);
	const [holidayAssignmentType, setHolidayAssignmentType] = useState<
		"organization" | "team" | "employee"
	>("organization");

	// Holiday handlers
	const handleAddHolidayClick = () => {
		setEditingHoliday(null);
		setHolidayDialogOpen(true);
	};

	const handleEditHolidayClick = (holiday: any) => {
		setEditingHoliday(holiday);
		setHolidayDialogOpen(true);
	};

	const handleHolidaySuccess = () => {
		queryClient.invalidateQueries({ queryKey: queryKeys.holidays.list(organizationId) });
	};

	// Category handlers
	const handleAddCategoryClick = () => {
		setEditingCategory(null);
		setCategoryDialogOpen(true);
	};

	const handleEditCategoryClick = (category: any) => {
		setEditingCategory(category);
		setCategoryDialogOpen(true);
	};

	const handleCategorySuccess = () => {
		queryClient.invalidateQueries({ queryKey: queryKeys.holidayCategories.list(organizationId) });
	};

	// Preset handlers
	const handleImportClick = () => {
		setImportDialogOpen(true);
	};

	const handleEditPresetClick = (preset: any) => {
		setEditingPresetId(preset.id);
		setPresetDialogOpen(true);
	};

	const handlePresetSuccess = () => {
		queryClient.invalidateQueries({ queryKey: queryKeys.holidayPresets.list(organizationId) });
	};

	// Preset assignment handlers
	const handleAssignClick = (type: "organization" | "team" | "employee") => {
		setAssignmentType(type);
		setAssignmentDialogOpen(true);
	};

	const handleAssignmentSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.holidayPresetAssignments.list(organizationId),
		});
	};

	// Holiday assignment handlers
	const handleHolidayAssignClick = (type: "organization" | "team" | "employee") => {
		setHolidayAssignmentType(type);
		setHolidayAssignmentDialogOpen(true);
	};

	const handleHolidayAssignmentSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.holidayAssignments.list(organizationId),
		});
	};

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
