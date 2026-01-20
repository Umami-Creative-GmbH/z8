"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/lib/query";
import { WorkCategoryAssignmentDialog } from "./work-category-assignment-dialog";
import { WorkCategoryAssignmentManager } from "./work-category-assignment-manager";
import { WorkCategoryTable } from "./work-category-table";

interface WorkCategoryManagementProps {
	organizationId: string;
	children: React.ReactNode; // The existing category sets content
}

export function WorkCategoryManagement({ organizationId, children }: WorkCategoryManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Assignment dialog state
	const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
	const [assignmentType, setAssignmentType] = useState<"organization" | "team" | "employee">(
		"organization",
	);

	// Assignment handlers
	const handleAssignClick = (type: "organization" | "team" | "employee") => {
		setAssignmentType(type);
		setAssignmentDialogOpen(true);
	};

	const handleAssignmentSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.workCategorySetAssignments.list(organizationId),
		});
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.workCategories.title", "Work Categories")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.workCategories.description",
						"Define work categories with time factors for effective time calculation",
					)}
				</p>
			</div>

			<Tabs defaultValue="categories" className="space-y-4">
				<TabsList>
					<TabsTrigger value="categories">
						{t("settings.workCategories.tab.categories", "Categories")}
					</TabsTrigger>
					<TabsTrigger value="sets">
						{t("settings.workCategories.tab.sets", "Category Sets")}
					</TabsTrigger>
					<TabsTrigger value="assignments">
						{t("settings.workCategories.tab.assignments", "Assignments")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="categories" className="space-y-4">
					<WorkCategoryTable organizationId={organizationId} />
				</TabsContent>

				<TabsContent value="sets" className="space-y-4">
					{children}
				</TabsContent>

				<TabsContent value="assignments" className="space-y-4">
					<WorkCategoryAssignmentManager
						organizationId={organizationId}
						onAssignClick={handleAssignClick}
					/>
				</TabsContent>
			</Tabs>

			<WorkCategoryAssignmentDialog
				open={assignmentDialogOpen}
				onOpenChange={setAssignmentDialogOpen}
				organizationId={organizationId}
				assignmentType={assignmentType}
				onSuccess={handleAssignmentSuccess}
			/>
		</div>
	);
}
