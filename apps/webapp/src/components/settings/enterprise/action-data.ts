import type { ServerActionResult } from "@/lib/effect/result";

/**
 * The data of an enterprise settings action, or a rejection carrying its
 * refusal message, so the forms keep their `try`/`catch` and `.catch` flows.
 */
export async function actionData<T>(result: Promise<ServerActionResult<T>>): Promise<T> {
	const settled = await result;
	if (!settled.success) throw new Error(settled.error);
	return settled.data;
}

/** The data type an enterprise settings action resolves with. */
export type ActionData<Action extends (...args: never[]) => Promise<ServerActionResult<unknown>>> =
	Extract<Awaited<ReturnType<Action>>, { success: true }>["data"];
