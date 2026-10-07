/** S3 reports a missing object as NoSuchKey (GET), NotFound (HEAD), NoSuchVersion or a 404. */
export function isMissingObjectError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
	return (
		error.name === "NoSuchKey" ||
		error.name === "NotFound" ||
		error.name === "NoSuchVersion" ||
		status === 404
	);
}
