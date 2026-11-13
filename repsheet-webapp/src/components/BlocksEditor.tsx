import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExercisePicker } from "@/components/ExercisePicker";
import {
	DragHandle,
	type HandleProps,
	type ItemProps,
	MoveButtons,
	useDragReorder,
} from "@/components/Reorder";
import { ChoiceSwitches, KindTag, Sheet } from "@/components/ui";
import type { ExerciseSummary } from "@/lib/api/schemas";
import { kindOf, letter } from "@/lib/blocks";
import { startingChoices } from "@/lib/choices";
import { parseTyped } from "@/lib/grid";
import { moveItem } from "@/lib/reorder";
import {
	type DraftBlock,
	type DraftExercise,
	newKey,
	replaceDraftExercise,
} from "@/lib/templates";

type PickTarget =
	| { kind: "newBlock" }
	| { kind: "addTo"; key: string }
	| { kind: "replace"; key: string; entry: DraftExercise };

function toInt(text: string): number | null {
	const value = parseTyped(text);
	return value === null ? null : Math.max(0, Math.round(value));
}

function BlockEditor({
	block,
	index,
	count,
	item,
	handle,
	onChange,
	onMove,
	onRemove,
	onAddExercise,
	onReplaceExercise,
}: {
	block: DraftBlock;
	index: number;
	count: number;
	item: ItemProps;
	handle: HandleProps;
	onChange: (block: DraftBlock) => void;
	onMove: (to: number) => void;
	onRemove: () => void;
	onAddExercise: () => void;
	onReplaceExercise: (entry: DraftExercise) => void;
}) {
	const { t } = useTranslation();
	const prefix = `block-${block.key}`;
	return (
		<section
			className="block editable"
			aria-label={t("block.title", { position: index + 1 })}
			{...item}
		>
			<div className="block-head">
				<DragHandle handle={handle} />
				<b>{index + 1}</b>
				<KindTag kind={kindOf(block.exercises.length)} />
				<span className="grow" />
				<MoveButtons index={index} count={count} onMove={onMove} />
				<button
					type="button"
					className="mini-button"
					aria-label={t("block.delete")}
					onClick={onRemove}
				>
					✕
				</button>
			</div>
			{block.exercises.map((entry, i) => (
				<div key={entry.key} className="block-exercise">
					<div className="ex">
						<span className="ex-letter">{letter(i)}</span>
						<span className="ex-name">{entry.exercise.name}</span>
						<ChoiceSwitches
							exercise={entry.exercise}
							chosen={entry}
							onChange={(change) =>
								onChange({
									...block,
									exercises: block.exercises.map((x, j) =>
										j === i ? { ...x, ...change } : x,
									),
								})
							}
						/>
						<input
							className="input input-small"
							aria-label={t("templateEditor.targetFor", {
								name: entry.exercise.name,
							})}
							placeholder={t("templateEditor.target")}
							value={entry.target}
							onChange={(e) =>
								onChange({
									...block,
									exercises: block.exercises.map((x, j) =>
										j === i ? { ...x, target: e.target.value } : x,
									),
								})
							}
						/>
						<button
							type="button"
							className="mini-button"
							aria-label={t("block.replaceExercise", {
								name: entry.exercise.name,
							})}
							onClick={() => onReplaceExercise(entry)}
						>
							⇄
						</button>
						<button
							type="button"
							className="mini-button"
							aria-label={t("block.removeExercise", {
								name: entry.exercise.name,
							})}
							onClick={() =>
								onChange({
									...block,
									exercises: block.exercises.filter((_, j) => j !== i),
								})
							}
						>
							✕
						</button>
					</div>
					<label className="instruction-field">
						<span className="small muted">
							{t("templateEditor.instruction")}
						</span>
						<input
							className="input"
							aria-label={t("templateEditor.instructionFor", {
								name: entry.exercise.name,
							})}
							placeholder={t("templateEditor.instructionPlaceholder")}
							maxLength={2000}
							value={entry.note}
							onChange={(e) =>
								onChange({
									...block,
									exercises: block.exercises.map((x, j) =>
										j === i ? { ...x, note: e.target.value } : x,
									),
								})
							}
						/>
					</label>
				</div>
			))}
			<div className="row">
				<label className="small muted" htmlFor={`${prefix}-rounds`}>
					{t("templateEditor.rounds")}
				</label>
				<input
					id={`${prefix}-rounds`}
					className="input input-small"
					inputMode="numeric"
					value={block.rounds ?? ""}
					onChange={(e) =>
						onChange({ ...block, rounds: toInt(e.target.value) })
					}
				/>
				<label className="small muted" htmlFor={`${prefix}-rest`}>
					{t("templateEditor.rest")}
				</label>
				<input
					id={`${prefix}-rest`}
					className="input input-small"
					inputMode="numeric"
					value={block.restSeconds ?? ""}
					onChange={(e) =>
						onChange({ ...block, restSeconds: toInt(e.target.value) })
					}
				/>
			</div>
			{block.exercises.length < 10 ? (
				<button type="button" className="link-button" onClick={onAddExercise}>
					{t("templateEditor.addExercise")}
				</button>
			) : null}
		</section>
	);
}

/**
 * The blocks of a template: exercises with a free-text target, rounds and
 * rest. Exercises are added through the exercise picker sheet.
 */
export function BlocksEditor({
	blocks,
	onChange,
}: {
	blocks: DraftBlock[];
	onChange: (blocks: DraftBlock[]) => void;
}) {
	const { t } = useTranslation();
	const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);

	function moveBlock(from: number, to: number) {
		onChange(moveItem(blocks, from, to));
	}
	const reorder = useDragReorder(blocks.length, moveBlock);

	function pick(exercise: ExerciseSummary) {
		const entry = {
			key: newKey(),
			exercise,
			...startingChoices(exercise),
			target: "",
			note: "",
		};
		const target = pickTarget;
		setPickTarget(null);
		if (!target) {
			return;
		}
		if (target.kind === "replace") {
			onChange(
				blocks.map((b) =>
					b.key === target.key
						? {
								...b,
								exercises: b.exercises.map((e) =>
									e.key === target.entry.key
										? replaceDraftExercise(e, exercise)
										: e,
								),
							}
						: b,
				),
			);
			return;
		}
		if (target.kind === "newBlock") {
			onChange([
				...blocks,
				{ key: newKey(), rounds: null, restSeconds: null, exercises: [entry] },
			]);
			return;
		}
		onChange(
			blocks.map((b) =>
				b.key === target.key ? { ...b, exercises: [...b.exercises, entry] } : b,
			),
		);
	}

	const pickExclude =
		pickTarget && pickTarget.kind !== "newBlock"
			? (blocks
					.find((b) => b.key === pickTarget.key)
					?.exercises.map((e) => e.exercise.id) ?? [])
			: [];

	const pickTitle =
		pickTarget?.kind === "replace"
			? t("block.replaceExercise", { name: pickTarget.entry.exercise.name })
			: t("templateEditor.pickExercise");

	return (
		<>
			{blocks.map((block, i) => (
				<BlockEditor
					key={block.key}
					block={block}
					index={i}
					count={blocks.length}
					item={reorder.item(i)}
					handle={reorder.handle(i)}
					onChange={(next) =>
						onChange(blocks.map((b) => (b.key === block.key ? next : b)))
					}
					onMove={(to) => moveBlock(i, to)}
					onRemove={() => onChange(blocks.filter((b) => b.key !== block.key))}
					onAddExercise={() => setPickTarget({ kind: "addTo", key: block.key })}
					onReplaceExercise={(entry) =>
						setPickTarget({ kind: "replace", key: block.key, entry })
					}
				/>
			))}
			<button
				type="button"
				className="btn btn-ghost"
				onClick={() => setPickTarget({ kind: "newBlock" })}
			>
				{t("templateEditor.addBlock")}
			</button>
			{pickTarget ? (
				<Sheet title={pickTitle} onClose={() => setPickTarget(null)}>
					<h2 className="display sheet-title">{pickTitle}</h2>
					<div className="sheet-body">
						<ExercisePicker onSelect={pick} excludeIds={pickExclude} />
					</div>
				</Sheet>
			) : null}
		</>
	);
}
