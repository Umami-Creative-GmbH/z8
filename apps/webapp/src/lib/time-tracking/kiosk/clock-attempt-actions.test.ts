import { describe, expect, it } from "vitest";
import { KIOSK_ATTEMPT_ACTIONS } from "@/db/schema/kiosk";
import { KIOSK_CLOCK_ACTIONS } from "./protocol";

describe("kiosk clock attempt actions (#1363)", () => {
	it("records exactly the actions a kiosk can send", () => {
		expect([...KIOSK_ATTEMPT_ACTIONS].sort()).toEqual([...KIOSK_CLOCK_ACTIONS].sort());
	});
});
