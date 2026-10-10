/**
 * Browser adoption of frozen clock commands (#279 / T15, resolution #263 §1–§3, §7).
 *
 * The page prepares one command request per clock action: version 2, or version 3
 * when it carries the position taken at the event (#826). The service
 * worker persists it in IndexedDB, resolves the clock-out target inside that same
 * transaction, and only then sends it. This module is the pure page half: when a
 * command may be frozen at all, and how a stored record reads back to the caller.
 */
import type { ClockOutResult } from "./clocking/types";
import type { Instant } from "@/lib/datetime/temporal-core";
import {
	CLOCK_COMMAND_VERSION,
	type ClockCommandContext,
	type ClockCommandPosition,
	type ClockOutCommand,
	UNSTAMPED_CLOCK_COMMAND_VERSION,
} from "./clock-command";
import { isValidIanaTimezone } from "./timezone-capture";
import { normalizeWorkLocationType, type WorkLocationType } from "./work-location";

/** `GET /api/time-entries/commands`, as the page reads it. */
export type BrowserClockCommandCapabilities = {
	commandVersions: number[];
	submit: "available" | "unavailable";
	context: Omit<ClockCommandContext, "server"> & { server: string | null };
};

type Attribution = ClockOutCommand["project"];

/**
 * What the page hands the worker. The worker adds `version`, turns
 * `knownWorkPeriodId` into the command's `target` and serializes the result once.
 */
export type ClockCommandCaptureRequest = {
	operationId: string;
	kind: "clock_in" | "clock_out";
	/** Every browser command is queued before its first attempt, so it may arrive late. */
	admission: "delayed";
	occurredAt: string;
	timezone: string;
	context: ClockCommandContext;
	/**
	 * The position taken at the event (#826): the worker then freezes a version 3
	 * command. Absent, it freezes version 2.
	 */
	position?: ClockCommandPosition;
} & (
	| { kind: "clock_in"; workLocationType: WorkLocationType }
	| {
			kind: "clock_out";
			/** The period the page last saw active; a queued clock-in on this device wins. */
			knownWorkPeriodId: string | null;
			project: Attribution;
			workCategory: Attribution;
			/** Explicit billability (#900); omitted applies the project's billable default. */
			billable?: boolean;
			/** The project task (#875); present only when the page names one. */
			task?: Attribution;
	  }
);

export type PreparedBrowserClockCommand =
	| { ok: true; request: ClockCommandCaptureRequest }
	| {
			ok: false;
			reason: "unavailable" | "context_changed" | "timezone_unknown" | "attribution_unsupported";
	  };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function attribution(value: string | null | undefined): Attribution | null {
	if (value === undefined) return { kind: "preserve" };
	if (value === null) return { kind: "clear" };
	return UUID.test(value) ? { kind: "replace", id: value } : null;
}

type PageSession = { userId: string; organizationId: string; origin: string };

/** Whether this page may freeze commands at all (the capture mode it shows). */
export function frozenClockCommandsAvailable(
	capabilities: BrowserClockCommandCapabilities | null | undefined,
	session: PageSession,
): boolean {
	return Boolean(
		capabilities &&
			capabilities.submit === "available" &&
			capabilities.commandVersions.includes(UNSTAMPED_CLOCK_COMMAND_VERSION) &&
			capabilities.context.server === session.origin &&
			capabilities.context.userId === session.userId &&
			capabilities.context.organizationId === session.organizationId,
	);
}

/**
 * Whether a clock command may be captured on this device while offline (#845).
 * Only an adopted organization accepts frozen clock commands (time-tracking ADR
 * 0002), so a capture anywhere else could never be sent. The page decides from
 * the capabilities it last read online for this account and organization;
 * none read, or read for another context, count as not adopted. Adoption shows
 * up the next time the device is online.
 */
export function offlineClockCaptureAllowed(
	capabilities: BrowserClockCommandCapabilities | null | undefined,
	session: Pick<PageSession, "userId" | "organizationId">,
): boolean {
	return Boolean(
		capabilities &&
			capabilities.submit === "available" &&
			capabilities.context.userId === session.userId &&
			capabilities.context.organizationId === session.organizationId,
	);
}

/** The outcome code of a clock command refused offline before anything was captured (#845). */
export const CLOCK_CONNECTION_REQUIRED = "connection_required";

/** How the page words that refusal. */
export const CLOCK_CONNECTION_REQUIRED_MESSAGE = [
	"timeTracking.errors.clockConnectionRequired",
	"Clocking needs a connection in this organization. Reconnect and try again.",
] as const;

/** Refused offline in an organization that is not adopted: nothing was captured or stored. */
export function clockConnectionRequired() {
	return {
		success: false as const,
		code: CLOCK_CONNECTION_REQUIRED,
		error: CLOCK_CONNECTION_REQUIRED_MESSAGE[1],
	};
}

/** Whether a clock command result is that refusal, shown inline rather than as an error. */
export function isClockConnectionRequired(result: { success: boolean; code?: unknown }): boolean {
	return !result.success && result.code === CLOCK_CONNECTION_REQUIRED;
}

/**
 * Freeze only when the server offers version 2 submission for exactly the
 * session the page is in. Anything else keeps the legacy path; a command that
 * was never frozen is not a downgrade.
 */
export function prepareBrowserClockCommand(input: {
	kind: "clock_in" | "clock_out";
	operationId: string;
	capabilities: BrowserClockCommandCapabilities | null | undefined;
	/** The signed-in page: its account, organization and its own origin. */
	session: PageSession;
	now: Instant;
	timezone: string | null | undefined;
	workLocationType?: WorkLocationType;
	knownWorkPeriodId?: string | null;
	projectId?: string | null;
	workCategoryId?: string | null;
	billable?: boolean;
	/** Omitted, the task follows the project; `null` clears it (#875). */
	taskId?: string | null;
	/** The position taken at this event, if the employee's capture is on and consented (#826). */
	position?: ClockCommandPosition | null;
}): PreparedBrowserClockCommand {
	const { capabilities } = input;
	if (
		capabilities?.submit !== "available" ||
		!capabilities.commandVersions.includes(UNSTAMPED_CLOCK_COMMAND_VERSION) ||
		// The worker sends to its own origin; the asserted server must be that one.
		capabilities.context.server !== input.session.origin
	) {
		return { ok: false, reason: "unavailable" };
	}
	if (
		capabilities.context.userId !== input.session.userId ||
		capabilities.context.organizationId !== input.session.organizationId
	) {
		return { ok: false, reason: "context_changed" };
	}
	if (!isValidIanaTimezone(input.timezone)) {
		return { ok: false, reason: "timezone_unknown" };
	}
	const common = {
		operationId: input.operationId,
		admission: "delayed" as const,
		occurredAt: input.now.toString({ fractionalSecondDigits: 3 }),
		timezone: input.timezone,
		// Checked equal to the page origin above; typed here as a string.
		context: { ...capabilities.context, server: input.session.origin },
		// A server without version 3 gets the unstamped command; the event never waits.
		...(input.position && capabilities.commandVersions.includes(CLOCK_COMMAND_VERSION)
			? { position: input.position }
			: {}),
	};
	if (input.kind === "clock_in") {
		return {
			ok: true,
			request: {
				...common,
				kind: "clock_in",
				workLocationType: normalizeWorkLocationType(input.workLocationType),
			},
		};
	}
	const project = attribution(input.projectId);
	const workCategory = attribution(input.workCategoryId);
	const task = input.taskId === undefined ? undefined : attribution(input.taskId);
	if (!project || !workCategory || task === null) {
		return { ok: false, reason: "attribution_unsupported" };
	}
	return {
		ok: true,
		request: {
			...common,
			kind: "clock_out",
			knownWorkPeriodId: input.knownWorkPeriodId ?? null,
			project,
			workCategory,
			...(input.billable === undefined ? {} : { billable: input.billable }),
			...(task ? { task } : {}),
		},
	};
}

/** The lifecycle fields of a stored command record that the caller reads. */
export type BrowserClockCommandOutcome = {
	state: "pending" | "exhausted" | "review_required" | "committed" | "rejected" | "archived";
	kind: "clock_in" | "clock_out";
	lastOutcome?: { kind: string; code?: string; holidayName?: string };
	receipt?: {
		kind: "start_live_work" | "close_active_work";
		result: { clockInEntryId?: string; clockOutEntryId?: string };
	};
	clockOut?: Pick<ClockOutResult, "complianceWarnings" | "breakAdjustment">;
};

export type BrowserClockActionResult =
	| {
			success: true;
			data: { id: string } & Partial<
				Pick<ClockOutResult, "complianceWarnings" | "breakAdjustment">
			>;
	  }
	/** Saved on this device and not confirmed. It is never a failed save. */
	| { success: true; queued: true; delivery: "pending" | "held" }
	| { success: false; error: string; code: string; holidayName?: string };

/** The page's `timeTracking` translator: a key, its English fallback and parameters. */
export type ClockMessageTranslate = (
	key: string,
	fallback: string,
	params?: Record<string, string>,
) => string;

type Message = readonly [key: string, fallback: string];
type ClockKind = BrowserClockCommandOutcome["kind"];

const REJECTED: Message = [
	"timeTracking.errors.clockCommandRejected",
	"The server did not accept this clock action",
];

/** How the page words the route's rejections a person can meet, per command kind. */
const REJECTION_MESSAGES: Partial<Record<string, Message | Record<ClockKind, Message>>> = {
	already_clocked_in: ["timeTracking.errors.alreadyClockedIn", "You are already clocked in"],
	target_not_active: [
		"timeTracking.errors.clockTargetNotActive",
		"This work period is no longer active. Refresh your clock status.",
	],
	target_unknown: [
		"timeTracking.errors.clockTargetUnknown",
		"The work period to close was not found. Refresh your clock status.",
	],
	occupancy_conflict: [
		"timeTracking.errors.clockInOccupied",
		"This time overlaps other recorded work",
	],
	attribution_not_allowed: [
		"timeTracking.errors.clockAttributionNotAllowed",
		"The selected project or category is not available",
	],
	append_review_required: {
		clock_in: [
			"timeTracking.errors.clockInAppendReview",
			"Your time history needs review before you can clock in. Please contact your administrator.",
		],
		clock_out: [
			"timeTracking.errors.clockOutAppendReview",
			"Your time history needs review before you can clock out. Please contact your administrator.",
		],
	},
	invalid_interval: [
		"timeTracking.errors.clockOutBeforeClockIn",
		"Clock-out must be after clock-in",
	],
	month_closed: [
		"timeTracking.errors.clockMonthClosed",
		"This time is in a closed month and cannot be changed until the month is reopened.",
	],
};

const HOLIDAY_BLOCKED_CLOCK_IN: Message = [
	"timeTracking.errors.holidayBlockedClockIn",
	"Cannot clock in on {holidayName}",
];
const NOT_ALLOWED_AT_TIME: Message = [
	"timeTracking.errors.clockNotAllowedAtTime",
	"Clocking is not allowed at this time",
];

function rejectionMessage(
	kind: ClockKind,
	code: string,
	holidayName: string | undefined,
	translate: ClockMessageTranslate,
): string {
	if (code === "not_allowed_at_time") {
		// Only a start meets a holiday: a clock-out is never refused for one.
		return kind === "clock_in" && holidayName
			? translate(...HOLIDAY_BLOCKED_CLOCK_IN, { holidayName })
			: translate(...NOT_ALLOWED_AT_TIME);
	}
	const message = REJECTION_MESSAGES[code] ?? REJECTED;
	return translate(...("clock_in" in message ? message[kind] : message));
}

/**
 * How one stored record reads to the person who pressed the button. A committed
 * receipt is success; an attended rejection is a failure that nothing wrote;
 * everything else is saved on this device, including an unknown outcome.
 */
export function toBrowserClockActionResult(
	record: BrowserClockCommandOutcome | null,
	translate: ClockMessageTranslate,
): BrowserClockActionResult {
	if (record?.state === "committed" && record.receipt) {
		const id =
			record.kind === "clock_out"
				? record.receipt.result.clockOutEntryId
				: record.receipt.result.clockInEntryId;
		if (id) {
			return {
				success: true,
				data: record.kind === "clock_out" ? { id, ...record.clockOut } : { id },
			};
		}
	}
	if (record?.state === "rejected" && record.lastOutcome?.code) {
		const { code, holidayName } = record.lastOutcome;
		return {
			success: false,
			code,
			...(holidayName ? { holidayName } : {}),
			error: rejectionMessage(record.kind, code, holidayName, translate),
		};
	}
	return {
		success: true,
		queued: true,
		delivery: !record || record.state === "pending" ? "pending" : "held",
	};
}
