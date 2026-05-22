"use client";

import { IconCoffee, IconLoader2 } from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface QuickBreakPopoverProps {
	onAddBreak: (breakMinutes: number) => Promise<{ success: boolean; error?: string }>;
	isAddingBreak: boolean;
	isDisabled: boolean;
	t: TFnType;
	buttonClassName?: string;
	iconOnly?: boolean;
}

export function QuickBreakPopover({
	onAddBreak,
	isAddingBreak,
	isDisabled,
	t,
	buttonClassName,
	iconOnly = false,
}: QuickBreakPopoverProps) {
	const [open, setOpen] = useState(false);
	const [minutes, setMinutes] = useState("30");
	const [error, setError] = useState<string | null>(null);
	const [localSubmitting, setLocalSubmitting] = useState(false);
	const submittingRef = useRef(false);
	const inputId = useId();
	const errorId = useId();
	const controlsDisabled = isDisabled || isAddingBreak || localSubmitting;
	const applying = isAddingBreak || localSubmitting;

	const addBreakLabel = t("timeTracking.quickBreak.addBreak", "Add break");
	const validationError = t(
		"timeTracking.quickBreak.errors.durationTooShort",
		"Enter a break duration of at least 1 minute.",
	);

	const handleOpenChange = (nextOpen: boolean) => {
		setOpen(nextOpen);
		if (nextOpen) {
			setError(null);
		}
	};

	const handleApply = async () => {
		if (isDisabled || isAddingBreak || submittingRef.current) {
			return;
		}

		const parsedMinutes = Number(minutes);

		if (!Number.isInteger(parsedMinutes) || parsedMinutes < 1) {
			setError(validationError);
			return;
		}

		setError(null);
		submittingRef.current = true;
		setLocalSubmitting(true);

		try {
			const result = await onAddBreak(parsedMinutes);

			if (result.success) {
				setOpen(false);
				setMinutes("30");
				return;
			}

			setError(
				result.error ||
					t("timeTracking.quickBreak.errors.addFailed", "Failed to add break. Please try again."),
			);
		} catch {
			setError(
				t("timeTracking.quickBreak.errors.addFailed", "Failed to add break. Please try again."),
			);
		} finally {
			submittingRef.current = false;
			setLocalSubmitting(false);
		}
	};

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="lg"
					className={buttonClassName}
					disabled={isDisabled}
					aria-label={addBreakLabel}
				>
					<IconCoffee className="size-4" aria-hidden="true" />
					{iconOnly ? null : <span className="hidden sm:inline">{addBreakLabel}</span>}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-80" align="end">
				<div className="flex flex-col gap-4">
					<div className="space-y-1">
						<div className="font-medium">{t("timeTracking.quickBreak.title", "Add break")}</div>
						<p className="text-muted-foreground text-sm">
							{t(
								"timeTracking.quickBreak.helper",
								"Record a break ending now and stay clocked in.",
							)}
						</p>
					</div>

					<div className="space-y-2">
						<label className="font-medium text-sm" htmlFor={inputId}>
							{t("timeTracking.quickBreak.durationLabel", "Break duration in minutes")}
						</label>
						<Input
							id={inputId}
							name="breakMinutes"
							autoComplete="off"
							type="number"
							inputMode="numeric"
							min={1}
							step={1}
							value={minutes}
							onChange={(event) => {
								setMinutes(event.target.value);
								setError(null);
							}}
							aria-invalid={!!error}
							aria-describedby={error ? errorId : undefined}
							disabled={controlsDisabled}
						/>
						{error && (
							<p id={errorId} className="text-destructive text-sm" role="alert">
								{error}
							</p>
						)}
					</div>

					<Button
						type="button"
						onClick={handleApply}
						disabled={controlsDisabled}
						className={cn("w-full", applying && "cursor-wait")}
					>
						{applying && <IconLoader2 className="size-4 animate-spin" aria-hidden="true" />}
						{applying
							? t("timeTracking.quickBreak.applying", "Applying…")
							: t("timeTracking.quickBreak.apply", "Apply")}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
