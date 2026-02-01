"use client";

import { X } from "lucide-react";
import { useState, useCallback } from "react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

interface EmailTagInputProps {
	value: string[];
	onChange: (emails: string[]) => void;
	placeholder?: string;
	disabled?: boolean;
	/** Accessible label for the input */
	ariaLabel?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailTagInput({
	value,
	onChange,
	placeholder,
	disabled = false,
	ariaLabel,
}: EmailTagInputProps) {
	const { t } = useTranslate();
	const [inputValue, setInputValue] = useState("");
	const [error, setError] = useState<string | null>(null);

	const defaultPlaceholder = t("settings.scheduledExports.emailInput.placeholder", "Enter email address");

	const addEmail = useCallback(
		(email: string) => {
			const trimmed = email.trim().toLowerCase();
			if (!trimmed) return;

			if (!EMAIL_REGEX.test(trimmed)) {
				setError(t("settings.scheduledExports.emailInput.invalidFormat", "Invalid email format"));
				return;
			}

			if (value.includes(trimmed)) {
				setError(t("settings.scheduledExports.emailInput.alreadyAdded", "Email already added"));
				return;
			}

			setError(null);
			onChange([...value, trimmed]);
			setInputValue("");
		},
		[value, onChange, t],
	);

	const removeEmail = useCallback(
		(emailToRemove: string) => {
			onChange(value.filter((e) => e !== emailToRemove));
		},
		[value, onChange],
	);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter" || e.key === ",") {
			e.preventDefault();
			addEmail(inputValue);
		} else if (e.key === "Backspace" && !inputValue && value.length > 0) {
			removeEmail(value[value.length - 1]);
		}
	};

	const handleBlur = () => {
		if (inputValue.trim()) {
			addEmail(inputValue);
		}
	};

	return (
		<div className="space-y-2">
			<div
				className="flex flex-wrap gap-2 p-2 border rounded-md min-h-[42px] bg-background"
				role="listbox"
				aria-label={ariaLabel || t("settings.scheduledExports.emailInput.listLabel", "Email recipients")}
			>
				{value.map((email) => (
					<Badge key={email} variant="secondary" className="gap-1 pl-2 pr-1" role="option" aria-selected="true">
						{email}
						<button
							type="button"
							onClick={() => removeEmail(email)}
							disabled={disabled}
							className="ml-1 rounded-full hover:bg-muted p-0.5"
							aria-label={t("settings.scheduledExports.emailInput.remove", "Remove {email}", { email })}
						>
							<X className="h-3 w-3" aria-hidden="true" />
						</button>
					</Badge>
				))}
				<Input
					type="email"
					value={inputValue}
					onChange={(e) => {
						setInputValue(e.target.value);
						setError(null);
					}}
					onKeyDown={handleKeyDown}
					onBlur={handleBlur}
					placeholder={value.length === 0 ? (placeholder || defaultPlaceholder) : ""}
					disabled={disabled}
					className="flex-1 min-w-[200px] border-0 shadow-none focus-visible:ring-0 h-7 px-1"
					aria-label={ariaLabel || t("settings.scheduledExports.emailInput.inputLabel", "Add email address")}
					aria-invalid={error ? "true" : "false"}
					aria-describedby={error ? "email-input-error" : "email-input-hint"}
				/>
			</div>
			{error && (
				<p id="email-input-error" className="text-sm text-destructive" role="alert">
					{error}
				</p>
			)}
			<p id="email-input-hint" className="text-xs text-muted-foreground">
				{t("settings.scheduledExports.emailInput.hint", "Press Enter or comma to add an email")}
			</p>
		</div>
	);
}
