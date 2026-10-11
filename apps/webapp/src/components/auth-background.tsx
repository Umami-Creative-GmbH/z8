import { connection } from "next/server";
import { Suspense } from "react";
import {
	AuthBackgroundImage,
	AuthBackgroundPlaceholder,
} from "./auth-background-image";
import {
	AUTH_BACKGROUND_IMAGES,
	selectRandomAuthBackgroundImage,
} from "./auth-background-images";

export function AuthBackground() {
	return (
		<Suspense
			fallback={
				<AuthBackgroundPlaceholder initialImage={AUTH_BACKGROUND_IMAGES[0]} />
			}
		>
			<SelectedAuthBackground />
		</Suspense>
	);
}

async function SelectedAuthBackground() {
	// Keep selection request-specific without waiting for domain or consent lookups.
	await connection();
	return (
		<AuthBackgroundImage initialImage={selectRandomAuthBackgroundImage()} />
	);
}
