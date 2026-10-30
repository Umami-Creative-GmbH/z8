import {
	IconAlertTriangle,
	IconCheck,
	IconLoader2,
	IconPlayerPlay,
	IconPlayerStop,
	IconX,
} from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDurationWithSeconds } from "@/lib/time-tracking/time-utils";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import { getTimeFormatDateTimeOptions, type TimeFormat } from "@/lib/user-preferences/time-format";
import { workLocationIcons } from "./work-location-indicator";

export function ActiveSessionSummary({
	elapsedSeconds,
	startTime,
	t,
	timeFormat = "24h",
}: {
	elapsedSeconds: number;
	startTime: Date;
	t: TFnType;
	timeFormat?: TimeFormat;
}) {
	const timeFormatter = Intl.DateTimeFormat(undefined, getTimeFormatDateTimeOptions(timeFormat));

	return (
		<div className="flex flex-col gap-2">
			<div className="font-bold text-3xl tabular-nums">
				{formatDurationWithSeconds(elapsedSeconds)}
			</div>
			<div className="text-muted-foreground text-sm">
				{t("timeTracking.startedAt", "Started at")} {timeFormatter.format(new Date(startTime))}
			</div>
		</div>
	);
}

export function RestPeriodWarnBanner({ t }: { t: TFnType }) {
	return (
		<div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
			<div className="flex items-center gap-2">
				<IconAlertTriangle className="size-4" />
				<span className="font-medium">
					{t("timeTracking.restPeriodWarning", "Rest Period Warning")}
				</span>
			</div>
			<p className="mt-1 text-xs">
				{t(
					"timeTracking.restPeriodWarningMessage",
					"You have not completed the required rest period. Clocking in now will be logged as a violation.",
				)}
			</p>
		</div>
	);
}

/** The clock's work location choice, named so it reads as a question before Clock In. */
export function WorkLocationField({
	value,
	onChange,
	t,
}: {
	value: WorkLocationType | null;
	onChange: (value: WorkLocationType) => void;
	t: TFnType;
}) {
	return (
		<fieldset className="min-w-0">
			<legend className="mb-2 font-medium text-muted-foreground text-xs">
				{t("timeTracking.workLocation", "Work location")}
			</legend>
			<WorkLocationSelector value={value} onChange={onChange} t={t} />
		</fieldset>
	);
}

export function WorkLocationSelector({
	value,
	onChange,
	t,
}: {
	value: WorkLocationType | null;
	onChange: (value: WorkLocationType) => void;
	t: TFnType;
}) {
	// Every option always names itself. Two columns below 22rem keep German labels ("Homeoffice")
	// whole; from 22rem the four sit in a row with the label under the icon. Options are 44 px
	// tall on touch screens (#846).
	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			value={value ?? ""}
			onValueChange={(nextValue) => {
				if (nextValue) {
					onChange(nextValue as WorkLocationType);
				}
			}}
			className="grid w-full grid-cols-2 items-stretch gap-1.5 data-[variant=outline]:shadow-none @[22rem]/widget:grid-cols-4"
		>
			<WorkLocationOption value="office" label={t("timeTracking.workLocationOffice", "Office")} />
			<WorkLocationOption value="home" label={t("timeTracking.workLocationHome", "Home")} />
			<WorkLocationOption value="remote" label={t("timeTracking.workLocationRemote", "Remote")} />
			<WorkLocationOption value="other" label={t("timeTracking.workLocationOther", "Other")} />
		</ToggleGroup>
	);
}

function WorkLocationOption({ value, label }: { value: WorkLocationType; label: string }) {
	const Icon = workLocationIcons[value];
	return (
		<ToggleGroupItem
			value={value}
			className="h-auto min-h-9 rounded-md px-2 py-1.5 shadow-xs data-[variant=outline]:border-l pointer-coarse:min-h-11 @[22rem]/widget:min-h-14 @[22rem]/widget:flex-col @[22rem]/widget:gap-1 data-pressed:border-primary data-pressed:bg-primary/10 data-pressed:text-primary data-pressed:hover:bg-primary/15 data-pressed:hover:text-primary"
		>
			<Icon aria-hidden="true" className="size-4" />
			<span className="min-w-0 truncate text-xs">{label}</span>
		</ToggleGroupItem>
	);
}

/** Clock In plays, Clock Out stops: the same marks the break controls use (#888). */
export function ClockActionButton({
	isClockedIn,
	isMutating,
	isClockingOut,
	isClocking = isMutating,
	onClick,
	t,
}: {
	isClockedIn: boolean;
	isMutating: boolean;
	isClockingOut: boolean;
	/** This button's own progress; another clock action only disables it. */
	isClocking?: boolean;
	onClick: () => void;
	t: TFnType;
}) {
	return (
		<Button
			size="lg"
			variant={isClockedIn ? "destructive" : "default"}
			onClick={onClick}
			disabled={isMutating}
			className="w-full"
		>
			{isClocking ? (
				<>
					<IconLoader2 className="size-5 animate-spin" />
					{isClockingOut
						? t("timeTracking.clockingOut", "Clocking Out…")
						: t("timeTracking.clockingIn", "Clocking In…")}
				</>
			) : isClockedIn ? (
				<>
					<IconPlayerStop aria-hidden="true" className="size-5" />
					{t("timeTracking.clockOut", "Clock Out")}
				</>
			) : (
				<>
					<IconPlayerPlay aria-hidden="true" className="size-5" />
					{t("timeTracking.clockIn", "Clock In")}
				</>
			)}
		</Button>
	);
}

export function PostClockOutNotesForm({
	notes,
	onChange,
	onSave,
	onSkip,
	isSaving,
	t,
}: {
	notes: string;
	onChange: (value: string) => void;
	onSave: () => void;
	onSkip: () => void;
	isSaving: boolean;
	t: TFnType;
}) {
	return (
		<div className="flex flex-col gap-3 motion-safe:transition-[opacity,transform] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200">
			<div className="text-sm text-muted-foreground">
				{t("timeTracking.addNotePrompt", "Add a note about your work (optional)")}
			</div>
			<Textarea
				name="notes"
				autoComplete="off"
				placeholder={t("timeTracking.notesPlaceholder", "What did you work on…")}
				value={notes}
				onChange={(event) => onChange(event.target.value)}
				rows={3}
				className="resize-none"
				autoFocus
			/>
			<div className="flex gap-2">
				<Button size="sm" onClick={onSave} disabled={isSaving} className="flex-1">
					{isSaving ? (
						<IconLoader2 className="size-4 animate-spin" />
					) : (
						<IconCheck className="size-4" />
					)}
					{t("common.save", "Save")}
				</Button>
				<Button size="sm" variant="outline" onClick={onSkip} disabled={isSaving}>
					<IconX className="size-4" />
					{t("common.skip", "Skip")}
				</Button>
			</div>
		</div>
	);
}
