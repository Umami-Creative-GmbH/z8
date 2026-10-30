interface PostgresPoolTimeoutEnvironment {
	POSTGRES_POOL_ACQUISITION_TIMEOUT_MS?: string;
}

/** Keep validation active when a script or CI skips the application env schema. */
export function getPostgresPoolAcquisitionTimeout(
	env: PostgresPoolTimeoutEnvironment,
): number {
	const value = env.POSTGRES_POOL_ACQUISITION_TIMEOUT_MS;
	if (value === undefined || value === "") return 10000;
	const milliseconds = Number(value);
	if (
		!/^\d+$/.test(value) ||
		!Number.isSafeInteger(milliseconds) ||
		milliseconds <= 0 ||
		milliseconds > 2_147_483_647
	)
		throw new Error(
			"POSTGRES_POOL_ACQUISITION_TIMEOUT_MS must be a positive integer no greater than 2147483647.",
		);
	return milliseconds;
}
