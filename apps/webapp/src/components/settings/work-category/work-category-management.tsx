"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/lib/query";
import { WorkCategoryAssignmentDialog } from "./work-category-assignment-dialog";
import { WorkCategoryAssignmentManager } from "./work-category-assignment-manager";
import { WorkCategoryTable } from "./work-category-table";

interface WorkCategoryManagementProps {
	organizationId: string;
	canManage: boolean;
	children: React.ReactNode; // The existing category sets content
}

export function WorkCategoryManagement({
	organizationId,
	canManage,
	children,
}: WorkCategoryManagementProps) {
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
		<div className="page-frame flex min-w-0 flex-1 flex-col gap-6">
			<PageHeader
				title={t("settings.workCategories.title", "Work Categories")}
				description={t(
					"settings.workCategories.description",
					"Define work categories with time factors for effective time calculation",
				)}
			/>

			<Tabs defaultValue="categories" className="min-w-0 space-y-4">
				<div className="max-w-full overflow-x-auto">
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
				</div>

				<TabsContent value="categories" className="space-y-4">
					<WorkCategoryTable organizationId={organizationId} canManage={canManage} />
				</TabsContent>

				<TabsContent value="sets" className="space-y-4">
					{children}
				</TabsContent>

				<TabsContent value="assignments" className="space-y-4">
					<WorkCategoryAssignmentManager
						organizationId={organizationId}
						canManage={canManage}
						onAssignClick={handleAssignClick}
					/>
				</TabsContent>
			</Tabs>

			{canManage ? (
				<WorkCategoryAssignmentDialog
					open={assignmentDialogOpen}
					onOpenChange={setAssignmentDialogOpen}
					organizationId={organizationId}
					assignmentType={assignmentType}
					onSuccess={handleAssignmentSuccess}
				/>
			) : null}
		</div>
	);
}
