import type { Queue } from "bullmq";

export async function obliterateJobQueue(
	queue: Pick<Queue, "obliterate" | "close">,
	confirmation: string | undefined,
): Promise<void> {
	let operationFailed = false;
	let operationError: unknown;
	try {
		if (confirmation !== "z8-jobs") {
			throw new Error('Confirmation must equal "z8-jobs"');
		}

		await queue.obliterate({ force: true });
	} catch (error) {
		operationFailed = true;
		operationError = error;
	}

	let closeFailed = false;
	let closeError: unknown;
	try {
		await queue.close();
	} catch (error) {
		closeFailed = true;
		closeError = error;
	}

	if (operationFailed && closeFailed) {
		const operationMessage =
			operationError instanceof Error
				? operationError.message
				: String(operationError);
		throw new AggregateError(
			[operationError, closeError],
			`Job queue operation failed: ${operationMessage}`,
			{ cause: operationError },
		);
	}
	if (operationFailed) throw operationError;
	if (closeFailed) {
		throw new Error(
			'Queue "z8-jobs" was obliterated, but closing its connection failed',
			{ cause: closeError },
		);
	}
}
