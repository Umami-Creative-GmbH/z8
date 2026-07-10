import { describe, expect, it } from "vitest";
import { Ed25519SigningProvider } from "./signing-provider";

describe("Ed25519SigningProvider", () => {
	it("derives a public key that verifies data signed by the private key", async () => {
		const provider = new Ed25519SigningProvider();
		const keyPair = await provider.generateKeyPair();
		const derivedPublicKey = provider.derivePublicKey(keyPair.privateKeyPem);
		const data = Buffer.from("audit package");
		const signature = await provider.sign(data, keyPair.privateKeyPem);

		expect(derivedPublicKey).toBe(keyPair.publicKeyPem);
		expect(await provider.verify(data, signature)).toBe(true);
		expect(await provider.verify(Buffer.from("tampered"), signature)).toBe(false);
	});
});
