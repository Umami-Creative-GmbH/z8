import { describe, expect, it } from "vitest";

import {
	organizationSecret as dbOrganizationSecret,
	organizationSecretKey as dbOrganizationSecretKey,
	secretStoreProviderEnum as dbSecretStoreProviderEnum,
} from "@/db";
import {
	organizationSecret as schemaOrganizationSecret,
	organizationSecretKey as schemaOrganizationSecretKey,
	secretStoreProviderEnum as schemaSecretStoreProviderEnum,
} from "@/db/schema";
import { organizationSecret, organizationSecretKey, secretStoreProviderEnum } from "@/db/schema/secret-store";

describe("secret store schema", () => {
	it("types Scaleway organization key metadata without key material", () => {
		const row: typeof organizationSecretKey.$inferInsert = {
			organizationId: "org_123",
			provider: "scaleway",
			scalewayKeyId: "6170692e-7363-616c-6577-61792e636f6d",
			region: "fr-par",
		};

		expect(row.provider).toBe("scaleway");
		expect("keyMaterial" in organizationSecretKey).toBe(false);
	});

	it("types encrypted organization secret rows without plaintext", () => {
		const row: typeof organizationSecret.$inferInsert = {
			organizationId: "org_123",
			key: "email/smtp_password",
			provider: "scaleway",
			kmsKeyId: "6170692e-7363-616c-6577-61792e636f6d",
			ciphertext: "encrypted-payload",
		};

		expect(row.key).toBe("email/smtp_password");
		expect("keyMaterial" in organizationSecret).toBe(false);
		expect("value" in organizationSecret).toBe(false);
		expect("plaintext" in organizationSecret).toBe(false);
	});

	it("exposes expected Drizzle column names", () => {
		expect(organizationSecretKey.organizationId.name).toBe("organization_id");
		expect(organizationSecretKey.scalewayKeyId.name).toBe("scaleway_key_id");
		expect(organizationSecret.organizationId.name).toBe("organization_id");
		expect(organizationSecret.ciphertext.name).toBe("ciphertext");
	});

	it("exports secret store schema through database barrels", () => {
		expect(schemaOrganizationSecret).toBe(organizationSecret);
		expect(schemaOrganizationSecretKey).toBe(organizationSecretKey);
		expect(schemaSecretStoreProviderEnum).toBe(secretStoreProviderEnum);
		expect(dbOrganizationSecret).toBe(organizationSecret);
		expect(dbOrganizationSecretKey).toBe(organizationSecretKey);
		expect(dbSecretStoreProviderEnum).toBe(secretStoreProviderEnum);
	});
});
