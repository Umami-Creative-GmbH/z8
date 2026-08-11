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
	interface Assertion<T> {
		toHaveTextContent(expected: string): T;
	}
}
