type BaseUIPreventableEvent = { preventBaseUIHandler?: () => void };

/**
 * Stops a Base UI `AlertDialogAction` (a Close button) from closing its dialog,
 * so a mutation it starts can keep the dialog open while it runs. Base UI's Close
 * ignores `preventDefault`; its own handler has to be stopped.
 */
export function keepAlertDialogOpen(event: unknown) {
	const preventable = event as
		| ({ preventDefault?: () => void } & BaseUIPreventableEvent)
		| null
		| undefined;
	preventable?.preventDefault?.();
	preventable?.preventBaseUIHandler?.();
}

/**
 * Wording of a failed confirmation: the thrown message when there is one,
 * otherwise the caller's fallback.
 */
export function describeFailure(failure: unknown, fallback: string) {
	if (failure instanceof Error && failure.message) return failure.message;
	if (typeof failure === "string" && failure) return failure;
	return fallback;
}
