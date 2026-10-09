"use client";

import { useTranslate } from "@tolgee/react";
import { cn } from "@/lib/utils";
import { PROJECT_COLOR_OPTIONS } from "./project-appearance";

const SELECTED = "border-foreground ring-2 ring-foreground ring-offset-2";

/**
 * The project colour swatches, shared by the project form and the template
 * form; the dash clears the colour. `value` is "" for no colour.
 */
export function ProjectColorPicker({
	value,
	onChange,
}: {
	value: string;
	onChange: (color: string) => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex flex-wrap gap-2">
			{PROJECT_COLOR_OPTIONS.map((color) => (
				<button
					key={color}
					type="button"
					aria-label={t("settings.projects.field.colorOption", "Select color {color}", { color })}
					aria-pressed={value === color}
					onClick={() => onChange(color)}
					className={cn(
						"size-8 rounded-full border-2 transition-transform hover:scale-110",
						value === color ? SELECTED : "border-transparent",
					)}
					style={{ backgroundColor: color }}
				/>
			))}
			<button
				type="button"
				aria-label={t("settings.projects.field.clearColor", "Clear color")}
				aria-pressed={!value}
				onClick={() => onChange("")}
				className={cn(
					"flex size-8 items-center justify-center rounded-full border-2 text-xs",
					!value ? SELECTED : "border-muted",
				)}
			>
				-
			</button>
		</div>
	);
}
