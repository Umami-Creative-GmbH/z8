import { expect } from "vitest";

expect.extend({
	toHaveTextContent(received: HTMLElement, expected: string) {
		const actual = received.textContent ?? "";
		return {
			pass: actual.includes(expected),
			message: () =>
				`expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`,
		};
	},
});

declare module "vitest" {
	interface Assertion<R extends void | Promise<void> = void, T = unknown> {
		toHaveTextContent(expected: string): R;
	}
}
