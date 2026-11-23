import { describe, expect, it } from "vitest";
import { getSsoDomainTxtRecord } from "./sso-domain-verification";

describe("getSsoDomainTxtRecord", () => {
	it("names the record the way Better Auth SSO resolves it", () => {
		expect(
			getSsoDomainTxtRecord({
				providerId: "entra-86bf24d7-79a1-4b3f-811b-60a7fcd5cac3",
				domain: "umami-creative.de",
				token: "-7BvIK4VWr-LEYJMNo63bEAr",
			}),
		).toEqual({
			host: "_z8-auth--entra-86bf24d7-79a1-4b3f-811b-60a7fcd5cac3",
			fqdn: "_z8-auth--entra-86bf24d7-79a1-4b3f-811b-60a7fcd5cac3.umami-creative.de",
			value: "-7BvIK4VWr-LEYJMNo63bEAr",
		});
	});
});
