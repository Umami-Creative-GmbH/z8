/**
 * A refusal the user can act on, carrying a stable code the client translates,
 * and optionally details the client shows with it (plain, serializable data).
 * Stores throw these; `storeStep` (`lib/organization-action/store-step.ts`)
 * turns one into a `ValidationError` whose `refusal` is the code.
 */
export type ActionRefusal<
	Code extends string,
	Details extends object = Record<never, never>,
> = Error & {
	readonly code: Code;
	readonly details?: Details;
};

/**
 * The legacy result shape of a refusal-coded action: a failure always carries a
 * stable code, `failed` for anything unexpected, and a refusal's details next
 * to it. Shared components still accept it (`kioskRefusalCode` adapts results).
 */
export type RefusalActionResult<
	T,
	Code extends string,
	Details extends object = Record<never, never>,
> =
	| { success: true; data: T }
	| ({ success: false; error: string; code: Code | "failed" } & Partial<Details>);
