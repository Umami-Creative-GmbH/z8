"use client";

import { IconListCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectTasksPanel } from "./project-tasks-panel";

interface ProjectTaskManagementProps {
	/** The projects whose tasks the viewer manages. */
	projects: { id: string; name: string; color: string | null }[];
}

/**
 * Project settings for project managers without project settings access
 * (#872): only the tasks of the projects they manage.
 */
export function ProjectTaskManagement({ projects }: ProjectTaskManagementProps) {
	const { t } = useTranslate();
	const [tasksProjectId, setTasksProjectId] = useState<string | null>(null);
	const tasksProject = projects.find((project) => project.id === tasksProjectId) ?? null;

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.projects.title", "Projects")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.projects.tasks.managerDescription",
						"Manage the tasks of the projects you manage",
					)}
				</p>
			</div>
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.projects.tasks.managedTitle", "Your projects")}</CardTitle>
					<CardDescription>
						{t("settings.projects.list.description", "{count} projects total", {
							count: projects.length,
						})}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<ul className="divide-y rounded-md border">
						{projects.map((project) => (
							<li key={project.id} className="flex items-center justify-between gap-2 px-3 py-2">
								<span className="flex min-w-0 items-center gap-2 font-medium">
									{project.color && (
										<span
											className="size-3 shrink-0 rounded-full"
											style={{ backgroundColor: project.color }}
											aria-hidden="true"
										/>
									)}
									<span className="truncate">{project.name}</span>
								</span>
								<Button
									variant="ghost"
									size="sm"
									className="gap-1 text-muted-foreground"
									onClick={() => setTasksProjectId(project.id)}
								>
									<IconListCheck className="size-4" aria-hidden="true" />
									{t("settings.projects.tasks.open", "Tasks")}
									<span className="sr-only">
										{t("settings.projects.tasks.manage", "Manage tasks of {name}", {
											name: project.name,
										})}
									</span>
								</Button>
							</li>
						))}
					</ul>
				</CardContent>
			</Card>
			<ProjectTasksPanel
				project={tasksProject}
				open={tasksProject !== null}
				onOpenChange={(open) => {
					if (!open) setTasksProjectId(null);
				}}
			/>
		</div>
	);
}
