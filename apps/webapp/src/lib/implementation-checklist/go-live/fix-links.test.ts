import { describe, expect, it } from "vitest";
import { WORK_POLICY_ASSIGNMENTS_HREF } from "./checks/work-policy";
import { goLiveFixLinks } from "./fix-links";

const label = { key: "settings.implementationChecklist.test", fallback: "Fix" };

describe("go-live fix links", () => {
	it("offers a settings page the viewer may open, keeping its query", () => {
		const fixLink = goLiveFixLinks({ accessTier: "orgAdmin", featureFlags: {} });

		expect(fixLink(WORK_POLICY_ASSIGNMENTS_HREF, label)).toEqual({
			href: "/settings/work-policies?tab=work&view=assignments",
			label,
		});
	});

	it("leaves out a page above the viewer's tier", () => {
		const fixLink = goLiveFixLinks({ accessTier: "manager", featureFlags: {} });

		expect(fixLink("/settings/approval-policies", label)).toBeNull();
		expect(fixLink(WORK_POLICY_ASSIGNMENTS_HREF, label)).not.toBeNull();
	});

	it("leaves out a page whose feature is off", () => {
		expect(
			goLiveFixLinks({ accessTier: "orgAdmin", featureFlags: { shiftsEnabled: false } })(
				"/settings/shifts",
				label,
			),
		).toBeNull();
	});

	it("leaves out a page that is not a settings entry", () => {
		const fixLink = goLiveFixLinks({ accessTier: "orgAdmin", featureFlags: {} });

		expect(fixLink("/settings/nowhere", label)).toBeNull();
	});
});
