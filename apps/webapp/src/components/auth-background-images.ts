import chosenSoul from "@/../public/backgrounds/a-chosen-soul-sJ_nxQIAUvg-unsplash.jpg";
import allyGriffin from "@/../public/backgrounds/ally-griffin-3hsrEvJi_gw-unsplash.jpg";
import andreiaBohner from "@/../public/backgrounds/andreia-bohner-6XZdT2jeymc-unsplash.jpg";
import philipOroni from "@/../public/backgrounds/philip-oroni-2KBQdhqHpOM-unsplash.jpg";
import rohitChoudhari from "@/../public/backgrounds/rohit-choudhari-_E6sXQHsgQc-unsplash.jpg";
import vimalS from "@/../public/backgrounds/vimal-s-J69ERsG93hI-unsplash.jpg";

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
