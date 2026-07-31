"use client";

import {
	IconClock,
	IconDots,
	IconLoader2,
	IconMapPin,
	IconPalette,
	IconPencil,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ShiftTemplate } from "@/app/[locale]/(app)/scheduling/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PRESET_COLORS = [
	{ key: "blue", value: "#3b82f6" },
	{ key: "green", value: "#22c55e" },
	{ key: "purple", value: "#a855f7" },
	{ key: "orange", value: "#f97316" },
	{ key: "red", value: "#ef4444" },
	{ key: "teal", value: "#14b8a6" },
	{ key: "pink", value: "#ec4899" },
	{ key: "indigo", value: "#6366f1" },
] as const;

function useColorName() {
	const { t } = useTranslate();
	const names: Record<string, string> = {
		blue: t("common:colors.blue", "Blue"),
		green: t("common:colors.green", "Green"),
		purple: t("common:colors.purple", "Purple"),
		orange: t("common:colors.orange", "Orange"),
		red: t("common:colors.red", "Red"),
		teal: t("common:colors.teal", "Teal"),
		pink: t("common:colors.pink", "Pink"),
		indigo: t("common:colors.indigo", "Indigo"),
	};
	return (key: string) => names[key] || key;
}

export function ShiftTemplateColorPicker({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const { t } = useTranslate();
	const getColorName = useColorName();
	return (
		<div className="space-y-2">
			<Label className="flex items-center gap-2">
				<IconPalette className="size-4" aria-hidden="true" />
				{t("settings.shiftTemplates.form.color", "Color")}
			</Label>
			<div
				className="flex flex-wrap gap-2"
				role="radiogroup"
				aria-label={t(
					"settings.shiftTemplates.form.colorSelection",
					"Color selection",
				)}
			>
				{PRESET_COLORS.map((color) => (
					<input
						key={color.value}
						type="radio"
						name="shift-template-color"
						checked={value === color.value}
						aria-label={getColorName(color.key)}
						onChange={() => onChange(color.value)}
						className={cn(
							"size-8 rounded-full transition-transform hover:scale-110",
							value === color.value && "ring-2 ring-offset-2 ring-primary",
						)}
						style={{ backgroundColor: color.value }}
					/>
				))}
			</div>
		</div>
	);
}

export function ShiftTemplateList({
	templates,
	isLoading,
	formatTime,
	calculateDuration,
	onCreate,
	onEdit,
	onToggleActive,
	onDelete,
}: {
	templates: ShiftTemplate[];
	isLoading: boolean;
	formatTime: (time: string) => string;
	calculateDuration: (startTime: string, endTime: string) => string;
	onCreate: () => void;
	onEdit: (template: ShiftTemplate) => void;
	onToggleActive: (template: ShiftTemplate) => void;
	onDelete: (template: ShiftTemplate) => void;
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-y-0 pb-4">
				<div>
					<CardTitle className="text-base font-medium">
						{t("settings.shiftTemplates.list.title", "Templates")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.shiftTemplates.list.description",
							"Manage your shift templates",
						)}
					</CardDescription>
				</div>
				<Button onClick={onCreate} size="sm">
					<IconPlus className="mr-2 size-4" />
					{t("settings.shiftTemplates.add", "Add Template")}
				</Button>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<IconLoader2
							className="size-6 animate-spin text-muted-foreground"
							aria-hidden="true"
						/>
					</div>
				) : templates.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-8 text-center">
						<IconClock
							className="size-12 text-muted-foreground/50 mb-4"
							aria-hidden="true"
						/>
						<h3 className="font-medium">
							{t("settings.shiftTemplates.empty.title", "No templates yet")}
						</h3>
						<p className="text-sm text-muted-foreground mt-1 max-w-sm">
							{t(
								"settings.shiftTemplates.empty.description",
								"Create shift templates to quickly add shifts when scheduling. Common examples include Morning Shift, Evening Shift, and Night Shift.",
							)}
						</p>
						<Button onClick={onCreate} className="mt-4" variant="outline">
							<IconPlus className="mr-2 size-4" />
							{t(
								"settings.shiftTemplates.createFirst",
								"Create your first template",
							)}
						</Button>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>
									{t("settings.shiftTemplates.table.name", "Name")}
								</TableHead>
								<TableHead>
									{t("settings.shiftTemplates.table.time", "Time")}
								</TableHead>
								<TableHead>
									{t("settings.shiftTemplates.table.duration", "Duration")}
								</TableHead>
								<TableHead>
									{t("settings.shiftTemplates.table.status", "Status")}
								</TableHead>
								<TableHead className="w-[70px]" />
							</TableRow>
						</TableHeader>
						<TableBody>
							{templates.map((template) => (
								<TableRow key={template.id}>
									<TableCell>
										<div className="flex items-center gap-3">
											<div
												className="size-4 rounded-full shrink-0"
												style={{ backgroundColor: template.color || "#3b82f6" }}
												aria-hidden="true"
											/>
											<span className="font-medium">{template.name}</span>
										</div>
									</TableCell>
									<TableCell>
										<span className="text-muted-foreground">
											{formatTime(template.startTime)} –{" "}
											{formatTime(template.endTime)}
										</span>
									</TableCell>
									<TableCell>
										<span className="text-muted-foreground">
											{calculateDuration(template.startTime, template.endTime)}
										</span>
									</TableCell>
									<TableCell>
										<Badge
											variant={template.isActive ? "default" : "secondary"}
										>
											{template.isActive
												? t("settings.shiftTemplates.active", "Active")
												: t("settings.shiftTemplates.inactive", "Inactive")}
										</Badge>
									</TableCell>
									<TableCell>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button variant="ghost" size="icon" className="size-8">
													<IconDots className="size-4" />
													<span className="sr-only">
														{t("common.openMenu", "Open menu")}
													</span>
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onClick={() => onEdit(template)}>
													<IconPencil
														className="mr-2 size-4"
														aria-hidden="true"
													/>
													{t("common.edit", "Edit")}
												</DropdownMenuItem>
												<DropdownMenuItem
													onClick={() => onToggleActive(template)}
												>
													{template.isActive
														? t(
																"settings.shiftTemplates.deactivate",
																"Deactivate",
															)
														: t("settings.shiftTemplates.activate", "Activate")}
												</DropdownMenuItem>
												<DropdownMenuItem
													onClick={() => onDelete(template)}
													className="text-destructive focus:text-destructive"
												>
													<IconTrash
														className="mr-2 size-4"
														aria-hidden="true"
													/>
													{t("common.delete", "Delete")}
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}

export function ShiftTemplatePreview({
	values,
	formatTime,
	calculateDuration,
	getSubareaDisplay,
}: {
	values: {
		name: string;
		startTime: string;
		endTime: string;
		color: string;
		subareaId: string;
	};
	formatTime: (time: string) => string;
	calculateDuration: (startTime: string, endTime: string) => string;
	getSubareaDisplay: (subareaId: string) => string;
}) {
	const { t } = useTranslate();
	return (
		<div className="rounded-lg border p-3 bg-muted/50">
			<p className="text-xs text-muted-foreground mb-2">
				{t("settings.shiftTemplates.form.preview", "Preview")}
			</p>
			<div className="flex items-center gap-3">
				<div
					className="size-4 rounded-full shrink-0"
					style={{ backgroundColor: values.color || "#3b82f6" }}
					aria-hidden="true"
				/>
				<div>
					<p className="font-medium text-sm">
						{values.name ||
							t("settings.shiftTemplates.form.untitled", "Untitled")}
					</p>
					<p className="text-xs text-muted-foreground">
						{formatTime(values.startTime)} – {formatTime(values.endTime)} (
						{calculateDuration(values.startTime, values.endTime)})
					</p>
					{values.subareaId && (
						<p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
							<IconMapPin className="size-3" aria-hidden="true" />
							{getSubareaDisplay(values.subareaId)}
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
