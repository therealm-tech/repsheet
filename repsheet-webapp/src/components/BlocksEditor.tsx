import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExercisePicker } from "@/components/ExercisePicker";
import { ChoiceSwitches, KindTag, Sheet } from "@/components/ui";
import type { ExerciseSummary } from "@/lib/api/schemas";
import { kindOf, letter } from "@/lib/blocks";
import { startingChoices } from "@/lib/choices";
import { parseTyped } from "@/lib/grid";
import { type DraftBlock, newKey } from "@/lib/templates";

type PickTarget = { kind: "newBlock" } | { kind: "addTo"; key: string };

function toInt(text: string): number | null {
	const value = parseTyped(text);
	return value === null ? null : Math.max(0, Math.round(value));
}

function BlockEditor({
	block,
	index,
	count,
	withRest,
	onChange,
	onMove,
	onRemove,
	onAddExercise,
}: {
	block: DraftBlock;
	index: number;
	count: number;
	withRest: boolean;
	onChange: (block: DraftBlock) => void;
	onMove: (direction: -1 | 1) => void;
	onRemove: () => void;
	onAddExercise: () => void;
}) {
	const { t } = useTranslation();
	const prefix = `block-${block.key}`;
	return (
		<section
			className="block editable"
			aria-label={t("block.title", { position: index + 1 })}
		>
			<div className="block-head">
				<b>{index + 1}</b>
				<KindTag kind={kindOf(block.exercises.length)} />
				<span className="grow" />
				<button
					type="button"
					className="mini-button"
					aria-label={t("templateEditor.moveUp")}
					disabled={index === 0}
					onClick={() => onMove(-1)}
				>
					↑
				</button>
				<button
					type="button"
					className="mini-button"
					aria-label={t("templateEditor.moveDown")}
					disabled={index === count - 1}
					onClick={() => onMove(1)}
				>
					↓
				</button>
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
				{withRest ? (
					<>
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
					</>
				) : null}
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
 * The blocks of a plan, a template or a planned session: exercises with a
 * free-text target, rounds and, for templates, rest. Exercises are added
 * through the exercise picker sheet.
 */
export function BlocksEditor({
	blocks,
	onChange,
	withRest,
	builtInOnly = false,
}: {
	blocks: DraftBlock[];
	onChange: (blocks: DraftBlock[]) => void;
	withRest: boolean;
	/** Offers only catalog exercises, for a plan whose owner cannot see the editor's own. */
	builtInOnly?: boolean;
}) {
	const { t } = useTranslation();
	const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);

	function moveBlock(index: number, direction: -1 | 1) {
		const next = [...blocks];
		const target = index + direction;
		const [moved] = next.splice(index, 1);
		if (!moved || target < 0 || target > next.length) {
			return;
		}
		next.splice(target, 0, moved);
		onChange(next);
	}

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
		pickTarget?.kind === "addTo"
			? (blocks
					.find((b) => b.key === pickTarget.key)
					?.exercises.map((e) => e.exercise.id) ?? [])
			: [];

	return (
		<>
			{blocks.map((block, i) => (
				<BlockEditor
					key={block.key}
					block={block}
					index={i}
					count={blocks.length}
					withRest={withRest}
					onChange={(next) =>
						onChange(blocks.map((b) => (b.key === block.key ? next : b)))
					}
					onMove={(direction) => moveBlock(i, direction)}
					onRemove={() => onChange(blocks.filter((b) => b.key !== block.key))}
					onAddExercise={() => setPickTarget({ kind: "addTo", key: block.key })}
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
				<Sheet
					title={t("templateEditor.pickExercise")}
					onClose={() => setPickTarget(null)}
				>
					<h2 className="display sheet-title">
						{t("templateEditor.pickExercise")}
					</h2>
					<div className="sheet-body">
						<ExercisePicker
							onSelect={pick}
							excludeIds={pickExclude}
							builtInOnly={builtInOnly}
						/>
					</div>
				</Sheet>
			) : null}
		</>
	);
}
