import type { StaticImageData } from "next/image";
import Image from "next/image";

type AuthBackgroundImageProps = {
	initialImage: StaticImageData;
};

export function AuthBackgroundImage({
	initialImage,
}: AuthBackgroundImageProps) {
	return (
		<Image
			alt=""
			className="absolute inset-0 size-full object-cover"
			fill
			placeholder="blur"
			preload
			sizes={`(min-aspect-ratio: ${initialImage.width}/${initialImage.height}) 100vw, ${Math.ceil((initialImage.width / initialImage.height) * 100)}vh`}
			src={initialImage}
		/>
	);
}

export function AuthBackgroundPlaceholder({
	initialImage,
}: AuthBackgroundImageProps) {
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 overflow-hidden"
		>
			<div
				className="absolute inset-0 scale-110 bg-cover bg-center blur-xl"
				style={{ backgroundImage: `url("${initialImage.blurDataURL}")` }}
			/>
		</div>
	);
}
