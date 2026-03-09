import {
	IconAlertTriangle,
	IconBuilding,
	IconCheck,
	IconClock,
	IconClockPause,
	IconDots,
	IconHome,
	IconLoader2,
	IconMapPin,
	IconX,
} from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDurationWithSeconds } from "@/lib/time-tracking/time-utils";

const timeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
});

export function ActiveSessionSummary({
	elapsedSeconds,
	startTime,
	t,
}: {
	elapsedSeconds: number;
	startTime: Date;
	t: TFnType;
}) {
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

export function WorkLocationSelector({
	value,
	onChange,
	t,
}: {
	value: "office" | "home" | "field" | "other";
	onChange: (value: "office" | "home" | "field" | "other") => void;
	t: TFnType;
}) {
	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			value={value}
			onValueChange={(nextValue) => {
				if (nextValue) {
					onChange(nextValue as typeof value);
				}
			}}
			className="w-full"
		>
			<ToggleGroupItem value="office" aria-label={t("timeTracking.workLocationOffice", "Office")}>
				<IconBuilding className="size-4" />
				<span className="hidden @[20rem]/widget:inline text-xs">
					{t("timeTracking.workLocationOffice", "Office")}
				</span>
			</ToggleGroupItem>
			<ToggleGroupItem value="home" aria-label={t("timeTracking.workLocationHome", "Home")}>
				<IconHome className="size-4" />
				<span className="hidden @[20rem]/widget:inline text-xs">
					{t("timeTracking.workLocationHome", "Home")}
				</span>
			</ToggleGroupItem>
			<ToggleGroupItem value="field" aria-label={t("timeTracking.workLocationField", "Field")}>
				<IconMapPin className="size-4" />
				<span className="hidden @[20rem]/widget:inline text-xs">
					{t("timeTracking.workLocationField", "Field")}
				</span>
			</ToggleGroupItem>
			<ToggleGroupItem value="other" aria-label={t("timeTracking.workLocationOther", "Other")}>
				<IconDots className="size-4" />
				<span className="hidden @[20rem]/widget:inline text-xs">
					{t("timeTracking.workLocationOther", "Other")}
				</span>
			</ToggleGroupItem>
		</ToggleGroup>
	);
}

export function ClockActionButton({
	isClockedIn,
	isMutating,
	isClockingOut,
	onClick,
	t,
}: {
	isClockedIn: boolean;
	isMutating: boolean;
	isClockingOut: boolean;
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
			{isMutating ? (
				<>
					<IconLoader2 className="size-5 animate-spin" />
					{isClockingOut
						? t("timeTracking.clockingOut", "Clocking Out…")
						: t("timeTracking.clockingIn", "Clocking In…")}
				</>
			) : isClockedIn ? (
				<>
					<IconClockPause className="size-5" />
					{t("timeTracking.clockOut", "Clock Out")}
				</>
			) : (
				<>
					<IconClock className="size-5" />
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
		<div className="flex flex-col gap-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200">
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
