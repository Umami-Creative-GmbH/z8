/** Database-boundary timestamp callbacks that stay safe to load in schema tooling. */
export function currentTimestamp(): Date {
	return new Date();
}

export function defaultTimestamp(): Date {
	return new Date();
}
