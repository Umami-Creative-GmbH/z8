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
