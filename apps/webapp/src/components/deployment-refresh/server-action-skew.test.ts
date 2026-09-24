import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { describe, expect, it, vi } from "vitest";
import {
	createServerActionSkewHandler,
	isServerActionVersionSkewError,
} from "./server-action-skew";

const clientSkewMessage =
	'Server Action "7f3a" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action';

describe("isServerActionVersionSkewError", () => {
	it("recognizes the error Next.js throws for an unknown server action", () => {
		expect(isServerActionVersionSkewError(new UnrecognizedActionError(clientSkewMessage))).toBe(
			true,
		);
	});

	it("recognizes skew errors from another bundle copy by name or message", () => {
		const renamed = new Error("whatever");
		renamed.name = "UnrecognizedActionError";

		expect(isServerActionVersionSkewError(renamed)).toBe(true);
		expect(
			isServerActionVersionSkewError(
				new Error(
					"Failed to find Server Action. This request might be from an older or newer deployment.",
				),
			),
		).toBe(true);
	});

	it("ignores ordinary failures", () => {
		expect(isServerActionVersionSkewError(new Error("connection reset"))).toBe(false);
		expect(isServerActionVersionSkewError(new Error("Employee was not found on the server"))).toBe(
			false,
		);
		expect(isServerActionVersionSkewError("Server Action")).toBe(false);
		expect(isServerActionVersionSkewError(null)).toBe(false);
	});
});

describe("createServerActionSkewHandler", () => {
	it("notifies once per page and reports which errors it handled", () => {
		const notify = vi.fn();
		const handle = createServerActionSkewHandler(notify);

		expect(handle(new Error("connection reset"))).toBe(false);
		expect(notify).not.toHaveBeenCalled();

		expect(handle(new UnrecognizedActionError(clientSkewMessage))).toBe(true);
		expect(handle(new UnrecognizedActionError(clientSkewMessage))).toBe(true);
		expect(notify).toHaveBeenCalledTimes(1);
	});
});
