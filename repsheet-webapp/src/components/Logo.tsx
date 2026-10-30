const COLUMNS: { x: number; rows: number[] }[] = [
	{ x: 175, rows: [767, 867, 967, 1067] },
	{ x: 272, rows: [665, 767, 867, 967, 1067, 1167] },
	{ x: 370, rows: [565, 665, 767, 867, 967, 1067, 1167, 1267] },
];

function Half({ mirrored }: { mirrored?: boolean }) {
	return (
		<g transform={mirrored ? "matrix(-1 0 0 1 1932 0)" : undefined}>
			<rect
				x="77"
				y="895"
				width="68"
				height="145"
				rx="10"
				fill="currentColor"
			/>
			<g fill="var(--orange)">
				{COLUMNS.flatMap((col) =>
					col.rows.map((y) => (
						<rect
							key={`${col.x}-${y}`}
							x={col.x}
							y={y}
							width="75"
							height="75"
						/>
					)),
				)}
			</g>
			<rect
				x="475"
				y="783"
				width="90"
				height="367"
				rx="14"
				fill="currentColor"
			/>
		</g>
	);
}

export function Logo({
	width = 48,
	title = "RepSheet",
}: {
	width?: number;
	title?: string;
}) {
	return (
		<svg viewBox="60 550 1812 810" width={width} role="img" aria-label={title}>
			<Half />
			<Half mirrored />
			<rect x="585" y="937" width="762" height="63" fill="currentColor" />
		</svg>
	);
}
