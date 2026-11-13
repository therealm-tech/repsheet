import {
	type CSSProperties,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { dropIndex } from "@/lib/reorder";
import { APP_SCROLLER } from "@/lib/scroll";

/** How close to the scroller's edge, in pixels, a dragged block scrolls it. */
const SCROLL_EDGE = 56;
const SCROLL_STEP = 10;

interface Drag {
	from: number;
	to: number;
	offset: number;
	/** How far the blocks the dragged one passes move to make room for it. */
	room: number;
}

export interface ItemProps {
	ref: (element: HTMLElement | null) => void;
	style: CSSProperties | undefined;
	"data-drag": "self" | "other" | undefined;
}

export interface HandleProps {
	onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface DragReorder {
	item: (index: number) => ItemProps;
	handle: (index: number) => HandleProps;
}

function itemStyle(
	drag: Drag | null,
	index: number,
): CSSProperties | undefined {
	if (!drag) {
		return undefined;
	}
	if (index === drag.from) {
		return { transform: `translateY(${drag.offset}px)` };
	}
	if (drag.from < index && index <= drag.to) {
		return { transform: `translateY(${-drag.room}px)` };
	}
	if (drag.to <= index && index < drag.from) {
		return { transform: `translateY(${drag.room}px)` };
	}
	return undefined;
}

/**
 * Drags the `count` items of a vertical list by their handle, with a mouse or
 * a finger (pointer events), scrolling the app near its edges. The order only
 * changes on release, through `onMove`.
 */
export function useDragReorder(
	count: number,
	onMove: (from: number, to: number) => void,
): DragReorder {
	const elements = useRef<(HTMLElement | null)[]>([]);
	const [drag, setDrag] = useState<Drag | null>(null);

	function start(from: number, event: ReactPointerEvent<HTMLElement>) {
		if (event.button !== 0) {
			return;
		}
		const rects = elements.current
			.slice(0, count)
			.map((el) => el?.getBoundingClientRect());
		const dragged = rects[from];
		if (!dragged || rects.some((r) => r === undefined)) {
			return;
		}
		event.preventDefault();
		const centers = rects.map((r) => (r ? r.top + r.height / 2 : 0));
		const [first, second] = rects;
		const gap = first && second ? second.top - first.bottom : 0;
		const room = dragged.height + gap;
		const scroller = event.currentTarget.closest<HTMLElement>(APP_SCROLLER);
		const scrollTop = scroller?.scrollTop ?? 0;
		const startY = event.clientY;
		let pointerY = startY;
		let to = from;
		let frame = 0;

		const update = () => {
			const offset = pointerY - startY + (scroller?.scrollTop ?? 0) - scrollTop;
			to = dropIndex(centers, from, (centers[from] ?? 0) + offset);
			setDrag({ from, to, offset, room });
		};
		const autoScroll = () => {
			if (scroller) {
				const bounds = scroller.getBoundingClientRect();
				if (pointerY < bounds.top + SCROLL_EDGE) {
					scroller.scrollTop -= SCROLL_STEP;
					update();
				} else if (pointerY > bounds.bottom - SCROLL_EDGE) {
					scroller.scrollTop += SCROLL_STEP;
					update();
				}
			}
			frame = requestAnimationFrame(autoScroll);
		};
		const move = (e: PointerEvent) => {
			pointerY = e.clientY;
			update();
		};
		const finish = (commit: boolean) => {
			cancelAnimationFrame(frame);
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", drop);
			window.removeEventListener("pointercancel", cancel);
			setDrag(null);
			if (commit && to !== from) {
				onMove(from, to);
			}
		};
		const drop = () => finish(true);
		const cancel = () => finish(false);

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", drop);
		window.addEventListener("pointercancel", cancel);
		frame = requestAnimationFrame(autoScroll);
		setDrag({ from, to, offset: 0, room });
	}

	return {
		item: (index) => ({
			ref: (element) => {
				elements.current[index] = element;
			},
			style: itemStyle(drag, index),
			"data-drag": drag ? (index === drag.from ? "self" : "other") : undefined,
		}),
		handle: (index) => ({
			onPointerDown: (event) => start(index, event),
		}),
	};
}

/** The grip a block is dragged by; the move buttons are the way for a keyboard or a screen reader. */
export function DragHandle({ handle }: { handle: HandleProps }) {
	return (
		<span className="drag-handle" aria-hidden="true" {...handle}>
			⠿
		</span>
	);
}

/** Moves the block at `index` one step up or down. */
export function MoveButtons({
	index,
	count,
	onMove,
}: {
	index: number;
	count: number;
	onMove: (to: number) => void;
}) {
	const { t } = useTranslation();
	const position = index + 1;
	return (
		<>
			<button
				type="button"
				className="mini-button"
				aria-label={t("block.moveUp", { position })}
				disabled={index === 0}
				onClick={() => onMove(index - 1)}
			>
				↑
			</button>
			<button
				type="button"
				className="mini-button"
				aria-label={t("block.moveDown", { position })}
				disabled={index === count - 1}
				onClick={() => onMove(index + 1)}
			>
				↓
			</button>
		</>
	);
}

/** A block card with, beside it, the grip and the buttons that move it. */
export function ReorderableBlock({
	index,
	count,
	reorder,
	onMove,
	children,
}: {
	index: number;
	count: number;
	reorder: DragReorder;
	onMove: (to: number) => void;
	children: ReactNode;
}) {
	return (
		<div className="reorderable" {...reorder.item(index)}>
			{children}
			<div className="reorder-rail">
				<DragHandle handle={reorder.handle(index)} />
				<MoveButtons index={index} count={count} onMove={onMove} />
			</div>
		</div>
	);
}
