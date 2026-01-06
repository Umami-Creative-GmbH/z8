"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CategoryDialog } from "./category-dialog";
import { CategoryManager } from "./category-manager";
import { HolidayDialog } from "./holiday-dialog";
import { HolidayList } from "./holiday-list";

interface HolidayManagementProps {
	organizationId: string;
}

export function HolidayManagement({ organizationId }: HolidayManagementProps) {
	const { t } = useTranslate();

	// Holiday dialog state
	const [holidayDialogOpen, setHolidayDialogOpen] = useState(false);
	const [editingHoliday, setEditingHoliday] = useState<any>(null);

	// Category dialog state
	const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
	const [editingCategory, setEditingCategory] = useState<any>(null);

	// Refs to trigger refreshes
	const [holidayRefreshKey, setHolidayRefreshKey] = useState(0);
	const [categoryRefreshKey, setCategoryRefreshKey] = useState(0);

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
		setHolidayRefreshKey((prev) => prev + 1);
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
		setCategoryRefreshKey((prev) => prev + 1);
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-bold">{t("settings.holidays.title", "Holiday Management")}</h1>
				<p className="text-muted-foreground">
					{t("settings.holidays.description", "Manage organizational holidays and closing days")}
				</p>
			</div>

			<Tabs defaultValue="holidays" className="space-y-4">
				<TabsList>
					<TabsTrigger value="holidays">
						{t("settings.holidays.tab.holidays", "Holidays")}
					</TabsTrigger>
					<TabsTrigger value="categories">
						{t("settings.holidays.tab.categories", "Categories")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="holidays" className="space-y-4">
					<HolidayList
						key={holidayRefreshKey}
						organizationId={organizationId}
						onAddClick={handleAddHolidayClick}
						onEditClick={handleEditHolidayClick}
					/>
				</TabsContent>

				<TabsContent value="categories" className="space-y-4">
					<CategoryManager
						key={categoryRefreshKey}
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
		</div>
	);
}
