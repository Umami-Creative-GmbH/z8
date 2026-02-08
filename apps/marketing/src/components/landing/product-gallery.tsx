import Image from "next/image";
import { galleryImages } from "./data";

export function ProductGallery() {
	return (
		<section className="relative z-10 mx-8 lg:mx-16">
			<div className="grid gap-4 md:grid-cols-3">
				{galleryImages.map((src, i) => (
					<div key={i} className="relative h-56 overflow-hidden rounded-2xl">
						<Image src={src} alt="" fill className="object-cover transition-transform duration-700 hover:scale-105" />
					</div>
				))}
			</div>
		</section>
	);
}
