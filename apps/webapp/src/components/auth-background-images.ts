import chosenSoul from "@/../public/backgrounds/a-chosen-soul-sJ_nxQIAUvg-unsplash.webp";
import allyGriffin from "@/../public/backgrounds/ally-griffin-3hsrEvJi_gw-unsplash.webp";
import andreiaBohner from "@/../public/backgrounds/andreia-bohner-6XZdT2jeymc-unsplash.webp";
import philipOroni from "@/../public/backgrounds/philip-oroni-2KBQdhqHpOM-unsplash.webp";
import rohitChoudhari from "@/../public/backgrounds/rohit-choudhari-_E6sXQHsgQc-unsplash.webp";
import vimalS from "@/../public/backgrounds/vimal-s-J69ERsG93hI-unsplash.webp";

export const AUTH_BACKGROUND_IMAGES = [
	allyGriffin,
	chosenSoul,
	andreiaBohner,
	philipOroni,
	rohitChoudhari,
	vimalS,
] as const;

export function selectRandomAuthBackgroundImage() {
	return AUTH_BACKGROUND_IMAGES[
		Math.floor(Math.random() * AUTH_BACKGROUND_IMAGES.length)
	];
}
