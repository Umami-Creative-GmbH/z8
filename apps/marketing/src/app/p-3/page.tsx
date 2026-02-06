import Image from "next/image";
import Link from "next/link";

export default function DesignP3() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Syne', 'Lexend', 'Outfit', sans-serif",
				backgroundColor: "#f7f6f9",
				color: "#18161f",
			}}
		>
			{/* Prismatic ambient — light version */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(ellipse 50% 35% at 25% 20%, rgba(100,120,255,0.05) 0%, transparent 60%), radial-gradient(ellipse 40% 30% at 75% 70%, rgba(255,80,136,0.04) 0%, transparent 50%), radial-gradient(ellipse 45% 35% at 50% 90%, rgba(60,220,180,0.03) 0%, transparent 50%)",
				}}
			/>

			{/* Prismatic top line */}
			<div className="relative z-10">
				<div
					className="h-[3px]"
					style={{
						background: "linear-gradient(90deg, #6478ff 0%, #c850c0 20%, #ff5088 40%, #ffb347 60%, #3cdcb4 80%, #6478ff 100%)",
						opacity: 0.5,
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
					<div className="h-4 w-px" style={{ backgroundColor: "#18161f10" }} />
					<span
						className="text-[10px] uppercase tracking-[0.4em]"
						style={{
							background: "linear-gradient(90deg, #6478ff, #c850c0)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Prisma
					</span>
				</div>
				<nav className="hidden items-center gap-10 text-[11px] tracking-[0.1em] text-[#8a8696] md:flex">
					<a href="#features" className="transition-colors hover:text-[#18161f]">Funktionen</a>
					<a href="#spectrum" className="transition-colors hover:text-[#18161f]">Spektrum</a>
					<a href="#contact" className="transition-colors hover:text-[#18161f]">Kontakt</a>
				</nav>
				<a
					href="#contact"
					className="group relative overflow-hidden px-6 py-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-white"
					style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
				>
					<span className="relative z-10">Anfragen</span>
					<div
						className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
						style={{ background: "linear-gradient(135deg, #c850c0, #ff5088)" }}
					/>
				</a>
			</header>

			{/* Hero — centered with spectral typography */}
			<section className="relative z-10 px-8 pb-20 pt-32 lg:px-16">
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
						<span style={{ color: "#18161f" }}>Prisma</span>
						<span
							style={{
								background: "linear-gradient(180deg, #6478ff, #c850c0)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							tisch
						</span>
						<span style={{ color: "#c0bcc8" }}>.</span>
					</h1>

					<p
						className="animate-fade-up mx-auto mt-10 max-w-md text-[15px] leading-[1.9] text-[#8a8696]"
						style={{ animationDelay: "0.4s" }}
					>
						Wei&szlig;es Licht trifft auf Pr&auml;zision &mdash; und entfaltet ein ganzes
						Spektrum. Z8 bricht Komplexit&auml;t in klare Farben.
					</p>

					<div className="animate-fade-up mt-12 flex items-center justify-center gap-6" style={{ animationDelay: "0.5s" }}>
						<a
							href="#contact"
							className="group relative overflow-hidden rounded-xl px-10 py-4 text-[12px] font-bold uppercase tracking-[0.1em] text-white"
							style={{ background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)" }}
						>
							<span className="relative z-10">Demo anfragen</span>
							<div
								className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
								style={{ background: "linear-gradient(135deg, #ff5088, #ffb347, #3cdcb4)" }}
							/>
						</a>
						<a href="#features" className="text-[12px] tracking-[0.1em] text-[#8a8696] transition-colors hover:text-[#18161f]">
							Erkunden &darr;
						</a>
					</div>
				</div>
			</section>

			{/* Dashboard mockup — light glass card */}
			<section className="relative z-10 mx-8 mb-32 lg:mx-16">
				<div className="animate-scale-in mx-auto max-w-4xl" style={{ animationDelay: "0.6s" }}>
					<div
						className="overflow-hidden rounded-2xl"
						style={{
							boxShadow: "0 30px 80px rgba(100,120,255,0.08), 0 10px 30px rgba(200,80,192,0.04)",
							border: "1px solid rgba(100,120,255,0.1)",
							backgroundColor: "#fff",
						}}
					>
						{/* Window bar */}
						<div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: "1px solid #f0eef3", backgroundColor: "#fbfafd" }}>
							<div className="flex gap-1.5">
								<div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#6478ff" }} />
								<div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#c850c0" }} />
								<div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: "#3cdcb4" }} />
							</div>
							<div className="ml-4 flex-1">
								<div className="mx-auto max-w-xs rounded-lg px-4 py-1.5 text-center text-[10px] text-[#8a8696]" style={{ backgroundColor: "#f7f6f9" }}>
									z8.app
								</div>
							</div>
						</div>
						{/* Dashboard content */}
						<div className="p-6">
							{/* Stats row */}
							<div className="mb-6 grid grid-cols-4 gap-3">
								{[
									{ label: "Aktive Nutzer", value: "127", change: "+12%", color: "#6478ff" },
									{ label: "Stunden (heute)", value: "842", change: "+3%", color: "#c850c0" },
									{ label: "\u00dcberstunden", value: "48", change: "-8%", color: "#ff5088" },
									{ label: "GoBD-Status", value: "100%", change: "Konform", color: "#3cdcb4" },
								].map((s, i) => (
									<div
										key={i}
										className="rounded-xl p-4"
										style={{
											backgroundColor: `${s.color}06`,
											border: `1px solid ${s.color}12`,
										}}
									>
										<div className="text-[10px] text-[#8a8696]">{s.label}</div>
										<div className="mt-1 flex items-end gap-2">
											<span className="text-[22px] font-bold tracking-tight">{s.value}</span>
											<span className="mb-1 text-[10px] font-medium" style={{ color: s.color }}>{s.change}</span>
										</div>
									</div>
								))}
							</div>
							{/* Chart */}
							<div
								className="flex h-36 items-end gap-1 rounded-xl p-4"
								style={{
									backgroundColor: "#fbfafd",
									border: "1px solid #f0eef3",
								}}
							>
								{[30, 45, 38, 60, 52, 70, 48, 65, 55, 72, 60, 80, 55, 68, 75, 50, 78, 62, 85, 72, 90, 68, 82, 75].map((h, i) => {
									const colors = ["#6478ff", "#8860e0", "#c850c0", "#ff5088", "#ffb347", "#3cdcb4"];
									return (
										<div
											key={i}
											className="flex-1 rounded-t-sm transition-all"
											style={{
												height: `${h}%`,
												backgroundColor: i >= 20 ? colors[i % 6] : "#e8e6ed",
											}}
										/>
									);
								})}
							</div>
						</div>
					</div>
					{/* Rainbow reflection */}
					<div
						className="mx-auto mt-3 h-[1px] max-w-md"
						style={{
							background: "linear-gradient(90deg, transparent, #6478ff25, #c850c025, #ff508825, #3cdcb425, transparent)",
						}}
					/>
				</div>
			</section>

			{/* Features — spectral grid */}
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
								className="group relative overflow-hidden rounded-xl bg-white p-7 transition-all duration-500 hover:translate-y-[-2px]"
								style={{
									border: `1px solid ${f.color}15`,
									boxShadow: `0 2px 12px ${f.color}05`,
								}}
							>
								<div
									className="absolute inset-0 translate-x-[-100%] transition-transform duration-700 group-hover:translate-x-[100%]"
									style={{ background: `linear-gradient(90deg, transparent, ${f.color}08, transparent)` }}
								/>
								<div className="mb-4 flex items-center gap-3">
									<div
										className="h-2 w-2 rounded-full transition-all duration-500 group-hover:scale-150"
										style={{ backgroundColor: f.color }}
									/>
									<span className="text-[9px] tracking-[0.3em]" style={{ color: `${f.color}80` }}>
										0{i + 1}
									</span>
								</div>
								<h3 className="mb-3 text-[16px] font-bold tracking-tight">{f.title}</h3>
								<p className="text-[12px] leading-[1.85] text-[#8a8696]">{f.desc}</p>
								<div
									className="absolute bottom-0 left-0 h-[2px] w-full opacity-0 transition-opacity duration-500 group-hover:opacity-100"
									style={{ background: `linear-gradient(90deg, ${f.color}, transparent)` }}
								/>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image pair */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
					<div
						className="relative h-56 overflow-hidden rounded-xl"
						style={{ border: "1px solid rgba(100,120,255,0.1)" }}
					>
						<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=700&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.6) contrast(1.05)" }} />
					</div>
					<div
						className="relative h-56 overflow-hidden rounded-xl"
						style={{ border: "1px solid rgba(60,220,180,0.1)" }}
					>
						<Image src="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=700&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.6) contrast(1.05)" }} />
					</div>
				</div>
			</section>

			{/* Spectrum quote */}
			<section id="spectrum" className="relative z-10 px-8 py-32 lg:px-16">
				<div className="mx-auto max-w-2xl text-center">
					<div className="mb-8 flex items-center justify-center">
						<div
							className="h-px w-32"
							style={{ background: "linear-gradient(90deg, transparent, #6478ff25, #c850c025, #ff508825, #3cdcb425, transparent)" }}
						/>
					</div>
					<blockquote className="text-[clamp(1.4rem,3vw,2.2rem)] font-bold leading-[1.5] tracking-[-0.01em]">
						Komplexit&auml;t ist nur{" "}
						<span
							style={{
								background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088, #3cdcb4)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							wei&szlig;es Licht
						</span>
						, das darauf wartet, gebrochen zu werden.
					</blockquote>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
				<div
					className="mx-auto max-w-3xl overflow-hidden rounded-2xl p-12 lg:p-16"
					style={{
						background: "linear-gradient(135deg, rgba(100,120,255,0.06), rgba(200,80,192,0.04), rgba(60,220,180,0.05))",
						border: "1px solid rgba(100,120,255,0.1)",
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
						<p className="mb-8 text-[14px] leading-relaxed text-[#8a8696]">
							Erleben Sie jede Facette von Z8 in einer pers&ouml;nlichen Demo.
						</p>
						<div className="flex items-center justify-center gap-4">
							<a
								href="mailto:hello@z8.app"
								className="group relative overflow-hidden rounded-xl px-10 py-4 text-[12px] font-bold uppercase tracking-[0.1em] text-white"
								style={{ background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)" }}
							>
								<span className="relative z-10">Demo vereinbaren</span>
								<div
									className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
									style={{ background: "linear-gradient(135deg, #ff5088, #ffb347, #3cdcb4)" }}
								/>
							</a>
							<a href="mailto:hello@z8.app" className="px-6 py-4 text-[12px] tracking-[0.05em] text-[#8a8696] transition-colors hover:text-[#18161f]">
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
						background: "linear-gradient(90deg, #6478ff12, #c850c010, #ff508812, #3cdcb410, transparent)",
					}}
				/>
				<div className="flex items-center justify-between pt-6 text-[10px] tracking-[0.2em] text-[#c0bcc8]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#18161f]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
