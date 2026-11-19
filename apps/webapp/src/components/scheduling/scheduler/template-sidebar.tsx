"use client";

import { IconClock, IconGripVertical } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ShiftTemplate } from "@/app/[locale]/(app)/scheduling/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TemplateSidebarProps {
	templates: ShiftTemplate[];
	onSelectTemplate: (template: ShiftTemplate) => void;
}

interface TemplateCardProps {
	template: ShiftTemplate;
	onDragStart: (e: React.DragEvent, template: ShiftTemplate) => void;
	onSelect: (template: ShiftTemplate) => void;
}

function formatTime(time: string): string {
	const [hours, minutes] = time.split(":");
	const hour = parseInt(hours, 10);
	const ampm = hour >= 12 ? "PM" : "AM";
	const hour12 = hour % 12 || 12;
	return `${hour12}:${minutes} ${ampm}`;
}

function calculateDuration(startTime: string, endTime: string): string {
	const [startH, startM] = startTime.split(":").map(Number);
	const [endH, endM] = endTime.split(":").map(Number);

	const startMinutes = startH * 60 + startM;
	let endMinutes = endH * 60 + endM;

	// Handle overnight shifts
	if (endMinutes < startMinutes) {
		endMinutes += 24 * 60;
	}

	const durationMinutes = endMinutes - startMinutes;
	const hours = Math.floor(durationMinutes / 60);
	const minutes = durationMinutes % 60;

	if (minutes === 0) {
		return `${hours}h`;
	}
	return `${hours}h ${minutes}m`;
}

function handleDragStart(e: React.DragEvent, template: ShiftTemplate) {
	e.dataTransfer.setData("application/json", JSON.stringify(template));
	e.dataTransfer.effectAllowed = "copy";
}

function TemplateCard({ template, onDragStart, onSelect }: TemplateCardProps) {
	const duration = calculateDuration(template.startTime, template.endTime);

	const backgroundColor = template.color || "#3b82f6";

	return (
		<li
			draggable
			onDragStart={(e) => onDragStart(e, template)}
			className="group rounded-lg border bg-card"
			style={{
				borderLeftWidth: "4px",
				borderLeftColor: backgroundColor,
			}}
		>
			<button
				type="button"
				onClick={() => onSelect(template)}
				className="flex w-full items-start gap-2 rounded-lg p-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<IconGripVertical className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
				<div className="flex-1 min-w-0">
					<span className="block break-words font-medium text-sm">{template.name}</span>
					<div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground tabular-nums">
						<IconClock className="size-3" />
						<span>
							{formatTime(template.startTime)} - {formatTime(template.endTime)}
						</span>
						<span className="text-muted-foreground/60">({duration})</span>
					</div>
				</div>
			</button>
		</li>
	);
}

export function TemplateSidebar({ templates, onSelectTemplate }: TemplateSidebarProps) {
	const { t } = useTranslate();
	const activeTemplates = templates.filter((t) => t.isActive);

	if (activeTemplates.length === 0) {
		return (
			<Card className="w-full min-w-0 shrink-0 lg:w-64">
				<CardHeader className="pb-3">
					<CardTitle className="text-sm font-medium">
						{t("scheduling:scheduling.templates.title", "Shift Templates")}
					</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						{t(
							"scheduling:scheduling.templates.empty",
							"No templates available. Create templates in Settings to quickly add shifts.",
						)}
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="w-full min-w-0 shrink-0 lg:w-64">
			<CardHeader className="pb-3">
				<CardTitle className="text-sm font-medium">
					{t("scheduling:scheduling.templates.title", "Shift Templates")}
				</CardTitle>
				<p className="text-xs text-muted-foreground">
					{t(
						"scheduling:scheduling.templates.selectHint",
						"Choose a template, then set the shift date and assignment.",
					)}
				</p>
			</CardHeader>
			<CardContent className="p-0">
				<ScrollArea className="h-40 lg:h-[calc(100vh-320px)]">
					<ul className="flex flex-col gap-2 px-4 pb-4">
						{activeTemplates.map((template) => (
							<TemplateCard
								key={template.id}
								template={template}
								onDragStart={handleDragStart}
								onSelect={onSelectTemplate}
							/>
						))}
					</ul>
				</ScrollArea>
			</CardContent>
		</Card>
	);
}
