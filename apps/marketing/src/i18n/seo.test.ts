import { describe, expect, it } from "vitest";
import { localizedMetadata } from "./seo";

describe("localizedMetadata", () => {
	it("treats locale prefixes as exact path segments", () => {
		expect(localizedMetadata("de", "/deals").alternates?.canonical).toBe("https://z8-time.app/de/deals");
		expect(localizedMetadata("en", "/de/pricing").alternates?.canonical).toBe("https://z8-time.app/en/pricing");
	});
});
