import { z } from "zod";

export type DrivingLicenceActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string };

/**
 * The driving licence settings actions' result: a refusal in `refusals` is returned by its
 * code, invalid input as `invalidCode`, anything else as `save_failed` (details stay on the
 * server).
 */
export async function runDrivingLicenceAction<T>(
	run: () => Promise<T>,
	options: { refusals: readonly string[]; invalidCode: string },
): Promise<DrivingLicenceActionResult<T>> {
	try {
		return { success: true, data: await run() };
	} catch (error) {
		const code =
			error instanceof z.ZodError
				? options.invalidCode
				: error instanceof Error && options.refusals.includes(error.message)
					? error.message
					: "save_failed";
		return { success: false, error: code };
	}
}
