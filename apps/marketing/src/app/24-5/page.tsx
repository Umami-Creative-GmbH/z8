import Image from "next/image";
import Link from "next/link";

export default function Design24_5() {
	return (
		<div
			className="noise min-h-screen"
			style={{
				fontFamily: "'Syne', 'Lexend', 'Outfit', sans-serif",
				backgroundColor: "#09090b",
				color: "#e4e4ec",
			}}
		>
			{/* Prismatic ambient */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(ellipse 40% 30% at 20% 30%, rgba(100,120,255,0.04) 0%, transparent 60%), radial-gradient(ellipse 30% 25% at 80% 60%, rgba(255,80,160,0.03) 0%, transparent 50%), radial-gradient(ellipse 35% 30% at 50% 80%, rgba(60,220,180,0.03) 0%, transparent 50%)",
				}}
			/>

			{/* Prismatic top line */}
			<div className="relative z-10">
				<div
					className="h-[2px]"
					style={{
						background: "linear-gradient(90deg, #6478ff 0%, #c850c0 20%, #ff5088 40%, #ffb347 60%, #3cdcb4 80%, #6478ff 100%)",
						opacity: 0.4,
					}}
				/>
			</div>

			{/* Header */}
			<header className="relative z-10 flex items-center justify-between px-8 py-7 lg:px-16">
				<div className="flex items-center gap-4">
					<span
						className="text-[24px] font-bold tracking-[-0.02em]"
						style={{
							background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Z8
					</span>
					<div className="h-4 w-px" style={{ background: "linear-gradient(180deg, transparent, #ffffff10, transparent)" }} />
					<span className="text-[10px] uppercase tracking-[0.4em] text-[#404050]">
						Prisma
					</span>
				</div>
				<nav className="hidden items-center gap-10 text-[11px] tracking-[0.1em] text-[#404050] md:flex">
					<a href="#features" className="transition-colors hover:text-[#e4e4ec]">Funktionen</a>
					<a href="#spectrum" className="transition-colors hover:text-[#e4e4ec]">Spektrum</a>
					<a href="#contact" className="transition-colors hover:text-[#e4e4ec]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="group relative overflow-hidden px-6 py-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-white"
					style={{
						background: "linear-gradient(135deg, #6478ff, #c850c0)",
					}}
				>
					<span className="relative z-10">Anfragen</span>
					<div
						className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
						style={{ background: "linear-gradient(135deg, #c850c0, #ff5088)" }}
					/>
				</a>
			</header>

			{/* Hero */}
			<section className="relative z-10 px-8 pb-24 pt-32 lg:px-16">
				<div className="mx-auto max-w-5xl text-center">
					<p
						className="animate-fade-up mb-10 text-[10px] font-semibold uppercase tracking-[0.7em]"
						style={{
							background: "linear-gradient(90deg, #6478ff, #c850c0, #ff5088, #3cdcb4)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
							animationDelay: "0.1s",
						}}
					>
						Licht wird Farbe
					</p>

					<h1
						className="animate-fade-up"
						style={{
							fontSize: "clamp(3.5rem, 10vw, 8rem)",
							fontWeight: 800,
							lineHeight: 0.95,
							letterSpacing: "-0.04em",
							animationDelay: "0.2s",
						}}
					>
						<span
							style={{
								background: "linear-gradient(180deg, #ffffff 0%, #e4e4ec 40%, #a0a0b0 100%)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							Prisma
						</span>
						<span
							style={{
								background: "linear-gradient(180deg, #c850c0, #6478ff)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							tisch
						</span>
						<span style={{ color: "#2a2a35" }}>.</span>
					</h1>

					<p
						className="animate-fade-up mx-auto mt-10 max-w-md text-[15px] leading-[1.9] text-[#606070]"
						style={{ animationDelay: "0.4s" }}
					>
						Wei&szlig;es Licht trifft auf Chrom &mdash; und entfaltet ein ganzes
						Spektrum. Z8 bricht Komplexit&auml;t in klare Farben: GoBD, SSO, Echtzeit.
					</p>

					<div className="animate-fade-up mt-12 flex items-center justify-center gap-6" style={{ animationDelay: "0.5s" }}>
						<a
							href="#contact"
							className="group relative overflow-hidden px-10 py-4 text-[11px] font-semibold uppercase tracking-[0.15em] text-white"
							style={{ background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)" }}
						>
							<span className="relative z-10">Demo anfragen</span>
							<div
								className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
								style={{ background: "linear-gradient(135deg, #ff5088, #ffb347, #3cdcb4)" }}
							/>
						</a>
						<a href="#features" className="text-[11px] tracking-[0.15em] text-[#404050] transition-colors hover:text-[#e4e4ec]">
							Erkunden &darr;
						</a>
					</div>
				</div>
			</section>

			{/* Hero image with prismatic border */}
			<section className="relative z-10 mx-8 mb-32 lg:mx-16">
				<div className="animate-scale-in mx-auto max-w-4xl" style={{ animationDelay: "0.6s" }}>
					<div
						className="relative overflow-hidden"
						style={{
							padding: "1px",
							background: "linear-gradient(135deg, #6478ff40, #c850c030, #ff508820, #3cdcb430)",
						}}
					>
						<div className="relative h-[40vh] overflow-hidden" style={{ backgroundColor: "#09090b" }}>
							<Image
								src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&q=80&auto=format&fit=crop"
								alt=""
								fill
								className="object-cover"
								style={{ filter: "saturate(0.15) brightness(0.45) contrast(1.3)" }}
								priority
							/>
							{/* Prismatic refraction overlay */}
							<div
								className="absolute inset-0"
								style={{
									background:
										"linear-gradient(135deg, rgba(100,120,255,0.04) 0%, transparent 25%, rgba(200,80,192,0.03) 50%, transparent 75%, rgba(60,220,180,0.04) 100%)",
								}}
							/>
						</div>
					</div>
					{/* Rainbow reflection line */}
					<div
						className="mx-auto mt-2 h-[1px] max-w-md"
						style={{
							background: "linear-gradient(90deg, transparent, #6478ff40, #c850c040, #ff508840, #3cdcb440, transparent)",
						}}
					/>
				</div>
			</section>

			{/* Features — with prismatic accents */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-5xl">
					<div className="mb-16 text-center">
						<span
							className="mb-4 block text-[10px] font-semibold uppercase tracking-[0.5em]"
							style={{
								background: "linear-gradient(90deg, #6478ff, #c850c0, #ff5088)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							Funktionen
						</span>
						<h2 className="text-4xl font-bold tracking-[-0.02em]">
							Sechs Wellenl&auml;ngen.
						</h2>
					</div>

					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Echtzeit-Synchronisation \u00fcber alle Ger\u00e4te.", color: "#6478ff" },
							{ title: "GoBD-konform", desc: "Revisionssichere Eintr\u00e4ge. Unver\u00e4nderbar dokumentiert.", color: "#8860e0" },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Nahtloser Transfer.", color: "#c850c0" },
							{ title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Organisationen isoliert und geh\u00e4rtet.", color: "#ff5088" },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Verschmolzen mit Ihrer Infrastruktur.", color: "#ffb347" },
							{ title: "Echtzeit-Analyse", desc: "\u00dcberstunden, Trends, Dashboards. Sofort reflektiert.", color: "#3cdcb4" },
						].map((f, i) => (
							<div
								key={i}
								className="group relative overflow-hidden p-7 transition-all duration-500 hover:translate-y-[-2px]"
								style={{
									backgroundColor: `${f.color}06`,
									border: `1px solid ${f.color}15`,
								}}
							>
								{/* Prismatic shine */}
								<div
									className="absolute inset-0 translate-x-[-100%] transition-transform duration-700 group-hover:translate-x-[100%]"
									style={{
										background: `linear-gradient(90deg, transparent, ${f.color}08, transparent)`,
									}}
								/>
								{/* Color accent dot */}
								<div className="mb-4 flex items-center gap-3">
									<div
										className="h-1.5 w-1.5 rounded-full transition-all duration-500 group-hover:scale-150"
										style={{ backgroundColor: f.color }}
									/>
									<span className="text-[9px] tracking-[0.3em]" style={{ color: `${f.color}60` }}>
										0{i + 1}
									</span>
								</div>
								<h3
									className="mb-3 text-[16px] font-bold tracking-tight transition-colors"
									style={{ color: "#808090" }}
								>
									{f.title}
								</h3>
								<p className="text-[12px] leading-[1.85] text-[#404050]">{f.desc}</p>
								{/* Bottom color line */}
								<div
									className="absolute bottom-0 left-0 h-[1px] w-full opacity-0 transition-opacity duration-500 group-hover:opacity-100"
									style={{ background: `linear-gradient(90deg, ${f.color}50, transparent)` }}
								/>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image row */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
					<div
						className="relative h-56 overflow-hidden"
						style={{ padding: "1px", background: "linear-gradient(135deg, #6478ff20, #c850c010)" }}
					>
						<div className="relative h-full overflow-hidden">
							<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=700&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.1) brightness(0.4) contrast(1.2)" }} />
						</div>
					</div>
					<div
						className="relative h-56 overflow-hidden"
						style={{ padding: "1px", background: "linear-gradient(135deg, #ff508820, #3cdcb410)" }}
					>
						<div className="relative h-full overflow-hidden">
							<Image src="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=700&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.1) brightness(0.4) contrast(1.2)" }} />
						</div>
					</div>
				</div>
			</section>

			{/* Spectrum philosophy */}
			<section id="spectrum" className="relative z-10 px-8 py-32 lg:px-16">
				<div className="mx-auto max-w-2xl text-center">
					<div className="mb-8 flex items-center justify-center">
						<div
							className="h-px w-32"
							style={{ background: "linear-gradient(90deg, transparent, #6478ff30, #c850c030, #ff508830, #3cdcb430, transparent)" }}
						/>
					</div>
					<blockquote className="text-[clamp(1.4rem,3vw,2.2rem)] font-bold leading-[1.5] tracking-[-0.01em]">
						<span style={{ color: "#808090" }}>Komplexit&auml;t ist nur</span>{" "}
						<span
							style={{
								background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088, #3cdcb4)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							wei&szlig;es Licht
						</span>
						<span style={{ color: "#808090" }}>, das darauf wartet, gebrochen zu werden.</span>
					</blockquote>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
				<div
					className="mx-auto max-w-3xl overflow-hidden p-12 lg:p-16"
					style={{
						background: "linear-gradient(135deg, rgba(100,120,255,0.04), rgba(200,80,192,0.02), rgba(60,220,180,0.03))",
						border: "1px solid rgba(200,80,192,0.08)",
					}}
				>
					<div className="text-center">
						<h2 className="mb-4 text-4xl font-bold tracking-[-0.02em]">
							Bereit f&uuml;r das volle{" "}
							<span
								style={{
									background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}
							>
								Spektrum
							</span>
							?
						</h2>
						<p className="mb-8 text-[14px] leading-relaxed text-[#505060]">
							Erleben Sie jede Facette von Z8 in einer pers&ouml;nlichen Demo.
						</p>
						<div className="flex items-center justify-center gap-4">
							<a
								href="mailto:hello@z8.app"
								className="group relative overflow-hidden px-10 py-4 text-[11px] font-semibold uppercase tracking-[0.15em] text-white"
								style={{ background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)" }}
							>
								<span className="relative z-10">Demo vereinbaren</span>
								<div
									className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
									style={{ background: "linear-gradient(135deg, #ff5088, #ffb347, #3cdcb4)" }}
								/>
							</a>
							<a href="mailto:hello@z8.app" className="px-6 py-4 text-[11px] tracking-[0.1em] text-[#404050] transition-colors hover:text-[#e4e4ec]">
								hello@z8.app
							</a>
						</div>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16">
				<div
					className="h-[1px]"
					style={{
						background: "linear-gradient(90deg, #6478ff15, #c850c010, #ff508815, #3cdcb410, transparent)",
					}}
				/>
				<div className="flex items-center justify-between pt-6 text-[10px] tracking-[0.2em] text-[#252530]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#e4e4ec]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
