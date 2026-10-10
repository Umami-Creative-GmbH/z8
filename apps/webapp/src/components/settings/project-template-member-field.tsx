"use client";

import { IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ManagerOrAssignmentAvailability } from "@/lib/projects/project-template-model";

export interface SelectionOption {
	id: string;
	name: string;
}

/** One project manager, team or employee the template holds. */
export interface ManagerOrAssignmentItem {
	key: string;
	name: string;
	availability: ManagerOrAssignmentAvailability;
	/** Omitted for removed teams and employees, which are dropped on save anyway. */
	onRemove?: () => void;
}

/**
 * The template form's list of project managers, teams or employees, each
 * marked when it has left or no longer exists, with a picker to add one.
 */
export function ManagerOrAssignmentField({
	title,
	pickerLabel,
	placeholder,
	emptyText,
	items,
	options,
	onAdd,
}: {
	title: string;
	pickerLabel: string;
	placeholder: string;
	emptyText: string;
	items: ManagerOrAssignmentItem[];
	options: SelectionOption[];
	onAdd: (id: string) => void;
}) {
	const { t } = useTranslate();
	const headingId = useId();

	return (
		<section aria-labelledby={headingId} className="space-y-2">
			<h4 id={headingId} className="text-sm font-medium">
				{title}
			</h4>
			{items.length === 0 ? (
				<p className="text-sm text-muted-foreground">{emptyText}</p>
			) : (
				<ul className="divide-y rounded-md border">
					{items.map((item) => (
						<li
							key={item.key}
							aria-label={item.name}
							className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
						>
							<span className="flex min-w-0 flex-wrap items-center gap-2">
								<span className={item.availability === "available" ? "" : "text-muted-foreground"}>
									{item.name}
								</span>
								{item.availability === "departed" && (
									<Badge variant="secondary">
										{t("settings.projects.templates.member.departed", "Left the organization")}
									</Badge>
								)}
								{item.availability === "removed" && (
									<Badge variant="outline">
										{t("settings.projects.templates.member.removed", "No longer exists")}
									</Badge>
								)}
							</span>
							{item.onRemove && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-8"
									aria-label={t("settings.projects.templates.member.remove", "Remove {name}", {
										name: item.name,
									})}
									onClick={item.onRemove}
								>
									<IconX className="size-4" aria-hidden="true" />
								</Button>
							)}
						</li>
					))}
				</ul>
			)}
			<Select
				value=""
				onValueChange={(value) => {
					if (value) onAdd(value);
				}}
			>
				<SelectTrigger aria-label={pickerLabel}>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.id} value={option.id}>
							{option.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</section>
	);
}
