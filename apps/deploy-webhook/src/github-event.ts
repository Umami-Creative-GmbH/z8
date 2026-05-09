import { DateTime } from "luxon";

export type ImageObservation = {
  packageName: "z8-webapp" | "z8-worker" | "z8-migration" | "z8-docs" | "z8-marketing";
  publishedAt: string;
  tag: string;
};

const allowedPackages = new Set<ImageObservation["packageName"]>([
  "z8-webapp",
  "z8-worker",
  "z8-migration",
  "z8-docs",
  "z8-marketing"
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseTimestamp(value: unknown): string | null {
  const timestamp = getString(value);
  if (!timestamp) return null;

  const parsed = DateTime.fromISO(timestamp, { setZone: true });
  if (!parsed.isValid) return null;
  return parsed.toUTC().toISO({ suppressMilliseconds: false });
}

export function parseGitHubPackageEvent(payload: unknown, expectedOwner: string): ImageObservation | null {
  if (!isObject(payload)) return null;
  if (payload.action !== "published") return null;

  const packageValue = payload.package;
  if (!isObject(packageValue)) return null;
  if (packageValue.package_type !== "container") return null;

  const owner = isObject(packageValue.owner) ? getString(packageValue.owner.login) : null;
  if (owner !== expectedOwner) return null;

  const packageName = getString(packageValue.name);
  if (!packageName || !allowedPackages.has(packageName as ImageObservation["packageName"])) return null;

  const packageVersion = isObject(packageValue.package_version) ? packageValue.package_version : null;
  const publishedAt = packageVersion ? parseTimestamp(packageVersion.created_at) : null;
  const containerMetadata = packageVersion && isObject(packageVersion.container_metadata) ? packageVersion.container_metadata : null;
  const tagObject = containerMetadata && isObject(containerMetadata.tag) ? containerMetadata.tag : null;
  const tag = tagObject ? getString(tagObject.name) : null;

  if (!publishedAt) return null;
  if (!tag || !/^sha-[a-f0-9]+$/.test(tag)) return null;

  return { packageName: packageName as ImageObservation["packageName"], publishedAt, tag };
}
