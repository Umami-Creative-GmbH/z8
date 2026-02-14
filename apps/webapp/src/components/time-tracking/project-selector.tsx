"use client";

import { IconBriefcase, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useEffect, useMemo, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { type AssignedProject, useAssignedProjects } from "@/lib/query/use-assigned-projects";
import { cn } from "@/lib/utils";

const LAST_PROJECT_KEY = "z8-last-project-id";

// Cache localStorage read at module level to avoid repeated access
let cachedLastProjectId: string | null | undefined;

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

	// Read localStorage once and cache at module level (js-cache-storage)
	const lastProjectIdRef = useRef<string | null>(null);
	if (cachedLastProjectId === undefined) {
		cachedLastProjectId = localStorage.getItem(LAST_PROJECT_KEY);
	}
	lastProjectIdRef.current = cachedLastProjectId;

	// Build a Map for O(1) project lookups (js-index-maps)
	const projectsMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

	// Auto-select last used project on initial load
	useEffect(() => {
		if (autoSelectLast && !hasAutoSelected && projects.length > 0 && value === undefined) {
			const lastProjectId = lastProjectIdRef.current;
			if (lastProjectId && projectsMap.has(lastProjectId)) {
				onValueChange(lastProjectId);
			}
			setHasAutoSelected(true);
		}
	}, [autoSelectLast, hasAutoSelected, projects.length, projectsMap, value, onValueChange]);

	// Save selected project to localStorage and update cache
	const handleValueChange = (newValue: string) => {
		if (newValue === "none") {
			localStorage.removeItem(LAST_PROJECT_KEY);
			cachedLastProjectId = null;
			onValueChange(undefined);
		} else {
			localStorage.setItem(LAST_PROJECT_KEY, newValue);
			cachedLastProjectId = newValue;
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
					<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
					{t("common.loading", "Loading…")}
				</div>
			</div>
		);
	}

	// Don't render if no projects assigned
	if (projects.length === 0) {
		return null;
	}

	const selectedProject = value ? projectsMap.get(value) : undefined;

	return (
		<div className="grid gap-2">
			{showLabel && (
				<Label className="text-sm text-muted-foreground">
					{t("timeTracking.project", "Project")}
				</Label>
			)}
			<Select value={value ?? "none"} onValueChange={handleValueChange} disabled={disabled}>
				<SelectTrigger className="w-full">
					<SelectValue placeholder={t("timeTracking.selectProject", "Select a project")}>
						{value ? (
							<ProjectOption
								project={selectedProject}
								unknownLabel={t("timeTracking.unknownProject", "Unknown project")}
								compact
							/>
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
							<ProjectOption
								project={project}
								unknownLabel={t("timeTracking.unknownProject", "Unknown project")}
							/>
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			{selectedProject && <ProjectDetails project={selectedProject} />}
		</div>
	);
}

function ProjectOption({
	project,
	unknownLabel,
	compact,
}: {
	project: AssignedProject | undefined;
	unknownLabel: string;
	compact?: boolean;
}) {
	if (!project) {
		return <span>{unknownLabel}</span>;
	}

	const budgetBadge = getBudgetBadge(project);
	const deadlineBadge = getDeadlineBadge(project);
	const hasBadges = budgetBadge || deadlineBadge;

	return (
		<div className="flex items-center gap-2 w-full">
			{project.color ? (
				<div
					className="size-3 shrink-0 rounded-full"
					style={{ backgroundColor: project.color }}
				/>
			) : (
				<IconBriefcase className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
			)}
			<span className={cn(hasBadges && !compact && "min-w-0 flex-1 truncate")}>{project.name}</span>
			{hasBadges && !compact && (
				<div className="flex items-center gap-1.5 shrink-0 text-[11px] leading-none">
					{budgetBadge && (
						<span className={cn("tabular-nums", budgetBadge.color)}>
							{budgetBadge.text}
						</span>
					)}
					{budgetBadge && deadlineBadge && (
						<span className="text-muted-foreground/50">|</span>
					)}
					{deadlineBadge && (
						<span className={cn("tabular-nums", deadlineBadge.color)}>
							{deadlineBadge.text}
						</span>
					)}
				</div>
			)}
		</div>
	);
}

function ProjectDetails({ project }: { project: AssignedProject }) {
	const { t } = useTranslate();
	const budgetBadge = getBudgetBadge(project);
	const deadlineBadge = getDeadlineBadge(project);

	if (!budgetBadge && !deadlineBadge) return null;

	return (
		<div className="rounded-lg border bg-muted/50 px-3 py-2 space-y-1.5 text-sm">
			{budgetBadge && (
				<div className="flex items-center justify-between">
					<span className="text-muted-foreground">
						{t("timeTracking.budget", "Budget")}
					</span>
					<span className={cn("font-medium tabular-nums", budgetBadge.color)}>
						{budgetBadge.text}
					</span>
				</div>
			)}
			{deadlineBadge && (
				<div className="flex items-center justify-between">
					<span className="text-muted-foreground">
						{t("timeTracking.deadline", "Deadline")}
					</span>
					<span className={cn("font-medium tabular-nums", deadlineBadge.color)}>
						{deadlineBadge.text}
					</span>
				</div>
			)}
		</div>
	);
}

function getBudgetBadge(project: AssignedProject): { text: string; color: string } | null {
	if (project.budgetHours == null || project.budgetHours <= 0) return null;

	const percentUsed = (project.totalHoursBooked / project.budgetHours) * 100;
	const remainingHours = project.budgetHours - project.totalHoursBooked;

	let color = "text-green-600 dark:text-green-400";
	if (percentUsed > 100) color = "text-red-600 dark:text-red-400";
	else if (percentUsed >= 90) color = "text-amber-600 dark:text-amber-400";
	else if (percentUsed >= 70) color = "text-yellow-600 dark:text-yellow-400";

	const pct = Math.round(percentUsed);
	const hrs = Math.abs(remainingHours).toFixed(1);
	const suffix = remainingHours < 0 ? "over" : "left";

	return { text: `${pct}% · ${hrs}h ${suffix}`, color };
}

function getDeadlineBadge(project: AssignedProject): { text: string; color: string } | null {
	if (!project.deadline) return null;

	const dt = DateTime.fromISO(project.deadline);
	const now = DateTime.now();
	const diffDays = Math.ceil(dt.diff(now, "days").days);

	let color = "text-green-600 dark:text-green-400";
	if (diffDays < 0) color = "text-red-600 dark:text-red-400";
	else if (diffDays <= 7) color = "text-amber-600 dark:text-amber-400";
	else if (diffDays <= 14) color = "text-yellow-600 dark:text-yellow-400";

	const dateStr = dt.toLocaleString({ month: "short", day: "numeric" });
	const daysStr =
		diffDays < 0
			? `${Math.abs(diffDays)}d overdue`
			: diffDays === 0
				? "today"
				: `${diffDays}d left`;

	return { text: `${dateStr} · ${daysStr}`, color };
}
