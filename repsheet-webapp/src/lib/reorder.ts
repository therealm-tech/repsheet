/** `items` with the one at `from` moved to `to`; unchanged when either is out of range. */
export function moveItem<T>(
	items: readonly T[],
	from: number,
	to: number,
): T[] {
	const next = [...items];
	const [moved] = next.splice(from, 1);
	if (moved === undefined || to < 0 || to > next.length) {
		return [...items];
	}
	next.splice(to, 0, moved);
	return next;
}

/** Blocks with the one at `from` moved to `to`, renumbered from 1 as the API does. */
export function moveBlock<T extends { position: number }>(
	blocks: readonly T[],
	from: number,
	to: number,
): T[] {
	return moveItem(blocks, from, to).map((b, i) => ({ ...b, position: i + 1 }));
}

/**
 * Where the item at `from` lands when its centre is dragged to `center`,
 * among items whose centres were at `centers` when the drag began.
 */
export function dropIndex(
	centers: readonly number[],
	from: number,
	center: number,
): number {
	return centers.filter((c, i) => i !== from && c < center).length;
}
