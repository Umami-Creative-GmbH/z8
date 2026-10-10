// Generates the app icons and splash screens of both native projects from the
// web app's brand icon. The outputs are committed; rerun after a brand change:
//   pnpm --filter mobile generate-assets
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp, { type Sharp } from "sharp";

/** The PWA icon: white "z8" on a rounded brand-blue square, 512 x 512. */
const SOURCE = fileURLToPath(
	new URL("../../webapp/public/android-chrome-512x512.png", import.meta.url),
);
/** Brand blue of the source icon. */
const BRAND = "#3860c6";

const app = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const androidRes = (path: string) => app(`android/app/src/main/res/${path}`);
const iosAssets = (path: string) => app(`ios/App/App/Assets.xcassets/${path}`);

async function write(image: Sharp, path: string) {
	mkdirSync(dirname(path), { recursive: true });
	await image.png({ compressionLevel: 9 }).toFile(path);
}

/** The icon as an opaque brand square: its rounded, transparent corners filled with brand blue. */
function brandSquare(size: number) {
	// Flatten before resizing, so the white of transparent pixels never bleeds into the edge.
	return sharp(SOURCE).flatten({ background: BRAND }).resize(size, size);
}

async function fullBleed(size: number) {
	return sharp(await brandSquare(size).png().toBuffer());
}

/** The icon centered on a brand canvas, at its native size or smaller. */
async function centered(width: number, height: number, iconSize: number) {
	const icon = await brandSquare(iconSize).png().toBuffer();
	return sharp({ create: { width, height, channels: 3, background: BRAND } }).composite([
		{ input: icon, gravity: "center" },
	]);
}

async function circle(size: number) {
	const mask = Buffer.from(
		`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`,
	);
	const square = await (await fullBleed(size)).png().toBuffer();
	return sharp(square)
		.ensureAlpha()
		.composite([{ input: mask, blend: "dest-in" }]);
}

/** Adaptive-icon foreground: the icon inside the 66 dp safe zone of a 108 dp layer. */
async function adaptiveForeground(size: number) {
	const iconSize = Math.round((size * 66) / 108);
	const icon = await brandSquare(iconSize).png().toBuffer();
	return sharp({
		create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
	}).composite([{ input: icon, gravity: "center" }]);
}

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 } as const;

for (const [density, scale] of Object.entries(densities)) {
	const launcher = Math.round(48 * scale);
	await write(
		sharp(SOURCE).resize(launcher, launcher),
		androidRes(`mipmap-${density}/ic_launcher.png`),
	);
	await write(await circle(launcher), androidRes(`mipmap-${density}/ic_launcher_round.png`));
	await write(
		await adaptiveForeground(Math.round(108 * scale)),
		androidRes(`mipmap-${density}/ic_launcher_foreground.png`),
	);

	const short = Math.round(320 * scale);
	const long = Math.round(480 * scale);
	const iconSize = Math.min(512, Math.round(short * 0.4));
	await write(
		await centered(short, long, iconSize),
		androidRes(`drawable-port-${density}/splash.png`),
	);
	await write(
		await centered(long, short, iconSize),
		androidRes(`drawable-land-${density}/splash.png`),
	);
}
await write(await centered(480, 320, 128), androidRes("drawable/splash.png"));

// iOS: one 1024 x 1024 opaque app icon (Xcode 14+) and the 2732 x 2732 launch image.
await write(await fullBleed(1024), iosAssets("AppIcon.appiconset/AppIcon-512@2x.png"));
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
	await write(await centered(2732, 2732, 512), iosAssets(`Splash.imageset/${name}`));
}

console.log("Generated Android and iOS icons and splash screens.");
