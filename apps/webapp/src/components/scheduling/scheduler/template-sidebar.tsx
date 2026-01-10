"use client";

import { Clock, GripVertical } from "lucide-react";
import { useMemo } from "react";
import type { ShiftTemplate } from "@/app/[locale]/(app)/scheduling/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TemplateSidebarProps {
	templates: ShiftTemplate[];
	onTemplateDrop: (template: ShiftTemplate, date: Date) => void;
}

interface TemplateCardProps {
	template: ShiftTemplate;
	onDragStart: (e: React.DragEvent, template: ShiftTemplate) => void;
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

function TemplateCard({ template, onDragStart }: TemplateCardProps) {
	const duration = useMemo(
		() => calculateDuration(template.startTime, template.endTime),
		[template.startTime, template.endTime],
	);

	const backgroundColor = template.color || "#3b82f6";

	return (
		<div
			role="listitem"
			draggable
			onDragStart={(e) => onDragStart(e, template)}
			className="group cursor-grab active:cursor-grabbing rounded-lg border bg-card p-3 shadow-sm transition-all hover:shadow-md hover:scale-[1.02]"
			style={{
				borderLeftWidth: "4px",
				borderLeftColor: backgroundColor,
			}}
		>
			<div className="flex items-start gap-2">
				<GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
				<div className="flex-1 min-w-0">
					<h4 className="font-medium text-sm truncate">{template.name}</h4>
					<div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
						<Clock className="h-3 w-3" />
						<span>
							{formatTime(template.startTime)} - {formatTime(template.endTime)}
						</span>
						<span className="text-muted-foreground/60">({duration})</span>
					</div>
				</div>
			</div>
		</div>
	);
}

export function TemplateSidebar({
	templates,
	onTemplateDrop: _onTemplateDrop,
}: TemplateSidebarProps) {
	const activeTemplates = useMemo(() => templates.filter((t) => t.isActive), [templates]);

	const handleDragStart = (e: React.DragEvent, template: ShiftTemplate) => {
		e.dataTransfer.setData("application/json", JSON.stringify(template));
		e.dataTransfer.effectAllowed = "copy";
	};

	// Handle drop on calendar - this needs to be coordinated with Schedule-X
	// For now, we'll use a simpler approach where clicking a template opens the dialog

	if (activeTemplates.length === 0) {
		return (
			<Card className="w-64 shrink-0">
				<CardHeader className="pb-3">
					<CardTitle className="text-sm font-medium">Shift Templates</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						No templates available. Create templates in Settings to quickly add shifts.
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="w-64 shrink-0">
			<CardHeader className="pb-3">
				<CardTitle className="text-sm font-medium">Shift Templates</CardTitle>
				<p className="text-xs text-muted-foreground">
					Drag a template onto the calendar to create a shift
				</p>
			</CardHeader>
			<CardContent className="p-0">
				<ScrollArea className="h-[calc(100vh-320px)]">
					<div className="flex flex-col gap-2 px-4 pb-4">
						{activeTemplates.map((template) => (
							<TemplateCard key={template.id} template={template} onDragStart={handleDragStart} />
						))}
					</div>
				</ScrollArea>
			</CardContent>
		</Card>
	);
}
