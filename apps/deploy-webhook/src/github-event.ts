export type ImageObservation = {
  packageName: "z8-webapp" | "z8-worker" | "z8-migration" | "z8-docs" | "z8-marketing";
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

export function parseGitHubPackageEvent(payload: unknown, expectedOwner: string): ImageObservation | null {
  if (!isObject(payload)) return null;
  const packageValue = payload.package;
  if (!isObject(packageValue)) return null;

  const owner = isObject(packageValue.owner) ? getString(packageValue.owner.login) : null;
  if (owner !== expectedOwner) return null;

  const packageName = getString(packageValue.name);
  if (!packageName || !allowedPackages.has(packageName as ImageObservation["packageName"])) return null;

  const packageVersion = isObject(packageValue.package_version) ? packageValue.package_version : null;
  const containerMetadata = packageVersion && isObject(packageVersion.container_metadata) ? packageVersion.container_metadata : null;
  const tagObject = containerMetadata && isObject(containerMetadata.tag) ? containerMetadata.tag : null;
  const tag = tagObject ? getString(tagObject.name) : null;

  if (!tag || !/^sha-[a-f0-9]+$/.test(tag)) return null;

  return { packageName: packageName as ImageObservation["packageName"], tag };
}
