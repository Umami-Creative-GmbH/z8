import { describe, expect, it } from "vitest";
import { itemTitle, removedItemTitle } from "./item-title";

const t = (_key: string, fallback: string, params?: Record<string, string | number>) =>
	fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match));

describe("itemTitle", () => {
	it("prefixes the running number with the item type", () => {
		expect(itemTitle(t, "receipt", 1)).toBe("Receipt 1");
		expect(itemTitle(t, "mileage", 2)).toBe("Mileage 2");
		expect(itemTitle(t, "per_diem", 3)).toBe("Per diem 3");
	});

	it("names an item removed since a note was written on it", () => {
		expect(removedItemTitle(t, "mileage")).toBe("Mileage (removed)");
	});
});
