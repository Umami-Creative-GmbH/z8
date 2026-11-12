import type { ServerActionResult } from "@/lib/effect/result";
import {
	type ActionFailure,
	type ActionMessage,
	actionErrorMessage,
	actionMessageText,
	type Translate,
} from "@/lib/organization-action/action-error-message";

/** A failed enterprise settings action, thrown by `actionData` with the whole failed result. */
export class ActionFailureError extends Error {
	constructor(readonly failure: ActionFailure & { readonly error: string }) {
		super(failure.error);
		this.name = "ActionFailureError";
	}
}

/**
 * The data of an enterprise settings action, or a rejection carrying the failed
 * result (`ActionFailureError`), so the forms keep their `try`/`catch` and
 * `.catch` flows. Word a caught error with `enterpriseErrorMessage`.
 */
export async function actionData<T>(result: Promise<ServerActionResult<T>>): Promise<T> {
	const settled = await result;
	if (!settled.success) throw new ActionFailureError(settled);
	return settled.data;
}

/**
 * The translated message for an error caught around `actionData`: an action's
 * failure through `actionErrorMessage` (the server's English text is never
 * shown), anything else (a network error) as `fallback`.
 */
export function enterpriseErrorMessage(
	t: Translate,
	error: unknown,
	fallback: ActionMessage,
	overrides = {},
): string {
	return error instanceof ActionFailureError
		? actionErrorMessage(t, error.failure, overrides, fallback)
		: actionMessageText(t, fallback);
}

/** The data type an enterprise settings action resolves with. */
export type ActionData<Action extends (...args: never[]) => Promise<ServerActionResult<unknown>>> =
	Extract<Awaited<ReturnType<Action>>, { success: true }>["data"];
