/**
 * The one place a refused settings action becomes a message (#1609). Client-safe:
 * no server or React imports, so lib modules and the server can share override maps.
 *
 * A failure is a `ServerActionResult` failure: `code` is the error's `_tag`
 * (`AuthorizationError`, `ValidationError`, …) and `refusal` a machine-readable
 * reason such as `former_employee`. Actions not yet on `organizationAction`
 * still put their feature reason in `code`; overrides are looked up by both.
 */

/** A Tolgee `t` (client `useTranslate` or server `getTranslate`). */
export type Translate = (
	key: string,
	defaultValue: string,
	params?: Record<string, string | number>,
) => string;

/** What the helper reads from a failed action result. */
export interface ActionFailure {
	readonly code?: string | null;
	readonly refusal?: string | null;
	/** `YYYY-MM` of a closed month refusal. */
	readonly closedMonth?: string | null;
	/** What a refusal carries beside its code, e.g. the payroll configurations using a field. */
	readonly details?: Readonly<Record<string, unknown>> | null;
}

/**
 * How to word one refusal: a `[key, English default]` tuple (statically
 * extractable), or a function when the text needs details of the failure.
 */
export type ActionMessage =
	| readonly [key: string, defaultValue: string]
	| ((t: Translate, failure: ActionFailure) => string);

/** A feature's own texts, keyed by refusal or code. */
export type RefusalOverrides = Readonly<Record<string, ActionMessage>>;

/**
 * An override map with a text for every one of `Code`; write maps as
 * `{ … } satisfies RefusalMessages<FeatureCode>` so a new code needs a text.
 */
export type RefusalMessages<Code extends string> = Readonly<Record<Code, ActionMessage>>;

const GENERIC_MESSAGES: RefusalOverrides = {
	AuthenticationError: ["common.actionErrors.signInRequired", "Sign in to continue."],
	AuthorizationError: ["common.actionErrors.notAllowed", "You do not have access to this setting."],
	ValidationError: ["common.actionErrors.invalidInput", "Check your input and try again."],
	former_employee: [
		"common.actionErrors.formerEmployee",
		"Former employees can't be chosen. Choose someone on the current roster.",
	],
};

const GENERIC_ERROR: ActionMessage = [
	"common.actionErrors.failed",
	"Something went wrong. Try again.",
];

function lookup(messages: RefusalOverrides, key: string | null | undefined): ActionMessage | null {
	return key != null && Object.hasOwn(messages, key) ? (messages[key] ?? null) : null;
}

/** Words one message. */
export function actionMessageText(
	t: Translate,
	message: ActionMessage,
	failure: ActionFailure = {},
): string {
	return typeof message === "function" ? message(t, failure) : t(message[0], message[1]);
}

/**
 * The translated message for a failed action: the feature's override for its
 * refusal or code, else the generic text for it, else `fallback`, else the
 * generic error. The server's English `error` text is never shown.
 */
export function actionErrorMessage(
	t: Translate,
	failure: ActionFailure | null | undefined,
	overrides: RefusalOverrides = {},
	fallback: ActionMessage = GENERIC_ERROR,
): string {
	const shown = failure ?? {};
	const message =
		lookup(overrides, shown.refusal) ??
		lookup(overrides, shown.code) ??
		lookup(GENERIC_MESSAGES, shown.refusal) ??
		lookup(GENERIC_MESSAGES, shown.code) ??
		fallback;
	return actionMessageText(t, message, shown);
}
