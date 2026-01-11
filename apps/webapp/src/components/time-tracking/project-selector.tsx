"use client";

import { IconBriefcase, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAssignedProjects, type AssignedProject } from "@/lib/query/use-assigned-projects";

const LAST_PROJECT_KEY = "z8-last-project-id";

interface ProjectSelectorProps {
	/**
	 * Currently selected project ID
	 */
	value: string | undefined;
	/**
	 * Callback when project selection changes
	 */
	onValueChange: (projectId: string | undefined) => void;
	/**
	 * Whether the selector is disabled
	 */
	disabled?: boolean;
	/**
	 * Whether to show the label
	 */
	showLabel?: boolean;
	/**
	 * Whether to auto-select the last used project
	 */
	autoSelectLast?: boolean;
}

/**
 * Project selector component for time tracking
 * Shows bookable projects the employee is assigned to
 */
export function ProjectSelector({
	value,
	onValueChange,
	disabled = false,
	showLabel = true,
	autoSelectLast = true,
}: ProjectSelectorProps) {
	const { t } = useTranslate();
	const { projects, isLoading, isError } = useAssignedProjects();
	const [hasAutoSelected, setHasAutoSelected] = useState(false);

	// Auto-select last used project on initial load
	useEffect(() => {
		if (autoSelectLast && !hasAutoSelected && projects.length > 0 && value === undefined) {
			const lastProjectId = localStorage.getItem(LAST_PROJECT_KEY);
			if (lastProjectId) {
				// Check if the last project is still in the list
				const lastProject = projects.find((p) => p.id === lastProjectId);
				if (lastProject) {
					onValueChange(lastProjectId);
				}
			}
			setHasAutoSelected(true);
		}
	}, [autoSelectLast, hasAutoSelected, projects, value, onValueChange]);

	// Save selected project to localStorage
	const handleValueChange = (newValue: string) => {
		if (newValue === "none") {
			localStorage.removeItem(LAST_PROJECT_KEY);
			onValueChange(undefined);
		} else {
			localStorage.setItem(LAST_PROJECT_KEY, newValue);
			onValueChange(newValue);
		}
	};

	// Don't render if no projects available or error
	if (isError) {
		return null;
	}

	// Show loading state
	if (isLoading) {
		return (
			<div className="grid gap-2">
				{showLabel && (
					<Label className="text-sm text-muted-foreground">
						{t("timeTracking.project", "Project")}
					</Label>
				)}
				<div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
					<IconLoader2 className="size-4 animate-spin" />
					{t("common.loading", "Loading...")}
				</div>
			</div>
		);
	}

	// Don't render if no projects assigned
	if (projects.length === 0) {
		return null;
	}

	return (
		<div className="grid gap-2">
			{showLabel && (
				<Label className="text-sm text-muted-foreground">
					{t("timeTracking.project", "Project")}
				</Label>
			)}
			<Select
				value={value ?? "none"}
				onValueChange={handleValueChange}
				disabled={disabled}
			>
				<SelectTrigger className="w-full">
					<SelectValue placeholder={t("timeTracking.selectProject", "Select a project")}>
						{value ? (
							<ProjectOption project={projects.find((p) => p.id === value)} />
						) : (
							<span className="text-muted-foreground">
								{t("timeTracking.noProject", "No project")}
							</span>
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="none">
						<div className="flex items-center gap-2">
							<div className="size-3 rounded-full border border-dashed border-muted-foreground" />
							<span>{t("timeTracking.noProject", "No project")}</span>
						</div>
					</SelectItem>
					{projects.map((project) => (
						<SelectItem key={project.id} value={project.id}>
							<ProjectOption project={project} />
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function ProjectOption({ project }: { project: AssignedProject | undefined }) {
	if (!project) {
		return <span>Unknown project</span>;
	}

	return (
		<div className="flex items-center gap-2">
			{project.color ? (
				<div
					className="size-3 rounded-full"
					style={{ backgroundColor: project.color }}
				/>
			) : (
				<IconBriefcase className="size-3 text-muted-foreground" />
			)}
			<span>{project.name}</span>
		</div>
	);
}
