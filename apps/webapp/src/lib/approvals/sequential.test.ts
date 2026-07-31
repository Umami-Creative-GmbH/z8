import { describe, expect, it } from "vitest";
import { mapSequentially } from "./sequential";

describe("mapSequentially", () => {
	it("waits for each operation before starting the next one", async () => {
		const calls: string[] = [];
		const resolvers: Array<() => void> = [];
		let markSecondStarted: () => void = () => undefined;
		const secondStarted = new Promise<void>((resolve) => {
			markSecondStarted = resolve;
		});

		const resultPromise = mapSequentially(["first", "second"], (item) => {
			calls.push(`start:${item}`);
			if (item === "second") markSecondStarted();
			return new Promise<string>((resolve) => {
				resolvers.push(() => {
					calls.push(`finish:${item}`);
					resolve(item);
				});
			});
		});

		await Promise.resolve();
		expect(calls).toEqual(["start:first"]);
		resolvers[0]?.();
		await secondStarted;
		expect(calls).toEqual(["start:first", "finish:first", "start:second"]);
		resolvers[1]?.();

		await expect(resultPromise).resolves.toEqual(["first", "second"]);
	});
});
