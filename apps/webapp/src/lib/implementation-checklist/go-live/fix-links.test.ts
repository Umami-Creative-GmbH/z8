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

	it("offers a detail page under an entry the viewer may open, and gates it by that entry", () => {
		const href = "/settings/teams/5f0c7a52-36a4-4d43-9d5e-3b7f1f3f8a10";

		expect(goLiveFixLinks({ accessTier: "manager", featureFlags: {} })(href, label)).toEqual({
			href,
			label,
		});
		expect(goLiveFixLinks({ accessTier: "member", featureFlags: {} })(href, label)).toBeNull();
		expect(
			goLiveFixLinks({ accessTier: "orgAdmin", featureFlags: {} })("/settings/teamsx/1", label),
		).toBeNull();
	});

	it("leaves out a page that is not a settings entry", () => {
		const fixLink = goLiveFixLinks({ accessTier: "orgAdmin", featureFlags: {} });

		expect(fixLink("/settings/nowhere", label)).toBeNull();
	});
});
