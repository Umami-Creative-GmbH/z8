"use client";

import { IconArrowLeft, IconBriefcase, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import type { KioskAttribution, KioskAttributionField } from "@/lib/time-tracking/kiosk/protocol";
import { cn } from "@/lib/utils";
import {
	attributionChoicesOf,
	type KioskAttributionChoice,
	type KioskAttributionValues,
} from "./kiosk-attribution";

interface KioskAttributionStepProps {
	/** Whose turn it is. */
	name: string;
	attribution: KioskAttribution;
	/** The choices to start from: the default keeps both, a retry keeps the last ones. */
	values: KioskAttributionValues;
	/** The action's button label ("Clock out"). */
	actionLabel: string;
	pending: boolean;
	disabled: boolean;
	error: string | null;
	onConfirm: (values: KioskAttributionValues) => void;
	onBack: () => void;
}

/**
 * The kiosk's project and work-category step (#887), between "Clock out" and
 * the clock-out: the employee keeps the live work's project and category (the
 * default), picks one the kiosk offers, or clears it. Nothing is required, so
 * an empty list never blocks the clock-out. No task or billability is asked.
 * Touch-sized for the kiosk.
 */
export function KioskAttributionStep({
	name,
	attribution,
	values,
	actionLabel,
	pending,
	disabled,
	error,
	onConfirm,
	onBack,
}: KioskAttributionStepProps) {
	const { t } = useTranslate();
	const { project, workCategory } = attribution;
	const form = useForm({
		defaultValues: values,
		onSubmit: ({ value }) => onConfirm(value),
	});

	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
			<Button
				variant="ghost"
				size="lg"
				className="h-14 self-start text-lg"
				disabled={pending}
				onClick={onBack}
			>
				<IconArrowLeft className="size-6" aria-hidden="true" />
				{t("timeTracking.kiosk.attribution.back", "Back")}
			</Button>
			<div className="space-y-2 text-center">
				<h1 className="text-3xl font-semibold break-words">{name}</h1>
				<p className="flex items-center justify-center gap-2 text-2xl">
					<IconBriefcase className="size-7 text-muted-foreground" aria-hidden="true" />
					{t("timeTracking.kiosk.attribution.title", "What did you work on?")}
				</p>
			</div>
			{error ? (
				<p
					role="alert"
					className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-center text-lg text-destructive"
				>
					{error}
				</p>
			) : null}
			{/* Client-side TanStack Form submit (docs/refs/forms.md). */}
			{/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
			<form
				className="flex flex-col gap-6"
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void form.handleSubmit();
				}}
			>
				{project ? (
					<form.Field name="project">
						{(field) => (
							<AttributionChoice
								label={t("timeTracking.kiosk.attribution.project", "Project")}
								noneLabel={t("timeTracking.kiosk.attribution.noProject", "No project")}
								field={project}
								value={field.state.value}
								onChange={field.handleChange}
								disabled={pending}
							/>
						)}
					</form.Field>
				) : null}
				{workCategory ? (
					<form.Field name="workCategory">
						{(field) => (
							<AttributionChoice
								label={t("timeTracking.kiosk.attribution.workCategory", "Work category")}
								noneLabel={t("timeTracking.kiosk.attribution.noWorkCategory", "No work category")}
								field={workCategory}
								value={field.state.value}
								onChange={field.handleChange}
								disabled={pending}
							/>
						)}
					</form.Field>
				) : null}
				<Button type="submit" size="lg" className="h-24 text-2xl" disabled={disabled || pending}>
					{pending ? (
						<IconLoader2
							className="size-7 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>
					) : null}
					{actionLabel}
				</Button>
			</form>
		</div>
	);
}

/** One field's choices as touch-sized radio cards: keep the current one, another, or none. */
function AttributionChoice({
	label,
	noneLabel,
	field,
	value,
	onChange,
	disabled,
}: {
	label: string;
	noneLabel: string;
	field: KioskAttributionField;
	value: KioskAttributionChoice;
	onChange: (value: KioskAttributionChoice) => void;
	disabled: boolean;
}) {
	const { t } = useTranslate();
	const name = useId();
	const headingId = useId();
	return (
		<div className="grid gap-3">
			<p id={headingId} className="text-xl font-medium">
				{label}
			</p>
			<div
				role="radiogroup"
				aria-labelledby={headingId}
				className="grid max-h-80 gap-3 overflow-y-auto sm:grid-cols-2"
			>
				{attributionChoicesOf(field).map((choice) => (
					<label
						key={choice.value}
						className={cn(
							"flex min-h-16 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-xl",
							"has-[:checked]:border-primary has-[:checked]:bg-primary/10",
							"has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
						)}
					>
						<input
							type="radio"
							name={name}
							className="size-6 accent-primary"
							value={choice.value}
							checked={value === choice.value}
							onChange={() => onChange(choice.value)}
							disabled={disabled}
						/>
						<span className="break-words">
							{choice.option === null
								? noneLabel
								: choice.keeps
									? t("timeTracking.kiosk.attribution.keep", "Keep {name}", {
											name: choice.option.name,
										})
									: choice.option.name}
						</span>
					</label>
				))}
			</div>
		</div>
	);
}
