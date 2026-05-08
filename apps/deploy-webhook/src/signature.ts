import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGitHubSignature(body: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const receivedHex = signatureHeader.slice("sha256=".length);
  if (!/^[a-fA-F0-9]{64}$/.test(receivedHex)) return false;

  const expectedHex = createHmac("sha256", secret).update(body).digest("hex");

  const received = Buffer.from(receivedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");

  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}
