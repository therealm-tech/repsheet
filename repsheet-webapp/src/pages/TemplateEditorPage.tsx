import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExercisePicker } from "@/components/ExercisePicker";
import {
	ConfirmButton,
	ErrorText,
	KindTag,
	ModeSwitch,
	Sheet,
} from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type { ExerciseSummary } from "@/lib/api/schemas";
import { kindOf, letter } from "@/lib/blocks";
import { parseTyped } from "@/lib/grid";
import {
	type Draft,
	type DraftBlock,
	draftFromTemplate,
	draftFromWorkout,
	draftToInput,
	emptyDraft,
	newKey,
} from "@/lib/templates";

type PickTarget = { kind: "newBlock" } | { kind: "addTo"; key: string };

function toInt(text: string): number | null {
	const value = parseTyped(text);
	return value === null ? null : Math.max(0, Math.round(value));
}

function BlockEditor({
	block,
	index,
	count,
	onChange,
	onMove,
	onRemove,
	onAddExercise,
}: {
	block: DraftBlock;
	index: number;
	count: number;
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
				<div key={entry.exercise.id} className="ex">
					<span className="ex-letter">{letter(i)}</span>
					<span className="ex-name">{entry.exercise.name}</span>
					{entry.exercise.modes.length > 1 ? (
						<ModeSwitch
							modes={entry.exercise.modes}
							value={entry.mode}
							label={t("block.modeOf", { name: entry.exercise.name })}
							onChange={(mode) =>
								onChange({
									...block,
									exercises: block.exercises.map((x, j) =>
										j === i ? { ...x, mode } : x,
									),
								})
							}
						/>
					) : null}
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

export function TemplateEditorPage({
	templateId,
	fromWorkout,
}: {
	templateId?: string;
	fromWorkout?: string;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<Draft | null>(() =>
		templateId || fromWorkout ? null : emptyDraft(),
	);
	const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);
	const [error, setError] = useState<string | null>(null);

	const template = useQuery({
		queryKey: keys.template(templateId ?? ""),
		queryFn: () => api.template(templateId ?? ""),
		enabled: Boolean(templateId),
	});
	const workout = useQuery({
		queryKey: keys.workout(fromWorkout ?? ""),
		queryFn: () => api.workout(fromWorkout ?? ""),
		enabled: Boolean(fromWorkout) && !templateId,
	});

	useEffect(() => {
		if (draft !== null) {
			return;
		}
		if (template.data) {
			setDraft(draftFromTemplate(template.data));
		} else if (workout.data) {
			setDraft(draftFromWorkout(workout.data));
		}
	}, [draft, template.data, workout.data]);

	const save = useMutation({
		mutationFn: (current: Draft) => {
			const body = draftToInput(current);
			return templateId
				? api.updateTemplate(templateId, body)
				: api.createTemplate(body);
		},
		onSuccess: (saved) => {
			queryClient.setQueryData(keys.template(saved.id), saved);
			void queryClient.invalidateQueries({ queryKey: keys.templates });
			void navigate({ to: "/templates" });
		},
		onError: (err) => setError(errorMessage(err, { fallback: "saveFailed" })),
	});

	const remove = useMutation({
		mutationFn: () => api.deleteTemplate(templateId ?? ""),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: keys.templates });
			void navigate({ to: "/templates" });
		},
	});

	if (template.isError || workout.isError) {
		return (
			<main className="screen narrow">
				<ErrorText>{t("templateEditor.loadFailed")}</ErrorText>
				<Link to="/templates">{t("templateEditor.back")}</Link>
			</main>
		);
	}
	if (draft === null) {
		return <main className="screen muted">{t("common.loading")}</main>;
	}

	function updateBlock(key: string, next: DraftBlock) {
		setDraft((d) =>
			d ? { ...d, blocks: d.blocks.map((b) => (b.key === key ? next : b)) } : d,
		);
	}

	function moveBlock(index: number, direction: -1 | 1) {
		setDraft((d) => {
			if (!d) {
				return d;
			}
			const blocks = [...d.blocks];
			const target = index + direction;
			const [moved] = blocks.splice(index, 1);
			if (!moved || target < 0 || target > blocks.length) {
				return d;
			}
			blocks.splice(target, 0, moved);
			return { ...d, blocks };
		});
	}

	function pick(exercise: ExerciseSummary) {
		const entry = { exercise, mode: exercise.defaultMode, target: "" };
		const target = pickTarget;
		setPickTarget(null);
		setDraft((d) => {
			if (!d || !target) {
				return d;
			}
			if (target.kind === "newBlock") {
				return {
					...d,
					blocks: [
						...d.blocks,
						{
							key: newKey(),
							rounds: null,
							restSeconds: null,
							exercises: [entry],
						},
					],
				};
			}
			return {
				...d,
				blocks: d.blocks.map((b) =>
					b.key === target.key
						? { ...b, exercises: [...b.exercises, entry] }
						: b,
				),
			};
		});
	}

	function submit() {
		if (!draft) {
			return;
		}
		if (!draft.name.trim()) {
			setError(t("errors.templateNameRequired"));
			return;
		}
		setError(null);
		save.mutate(draft);
	}

	const pickExclude =
		pickTarget?.kind === "addTo"
			? (draft.blocks
					.find((b) => b.key === pickTarget.key)
					?.exercises.map((e) => e.exercise.id) ?? [])
			: [];

	return (
		<main className="screen narrow">
			<header className="bar">
				<Link
					to="/templates"
					className="icon-button"
					aria-label={t("templateEditor.back")}
				>
					‹
				</Link>
				<h1 className="display page-title center grow">
					{templateId
						? t("templateEditor.editTitle")
						: t("templateEditor.newTitle")}
				</h1>
				<button
					type="button"
					className="tag tag-orange tag-button"
					onClick={submit}
					disabled={save.isPending}
				>
					{t("common.ok")}
				</button>
			</header>
			<div>
				<label className="label" htmlFor="template-name">
					{t("templateEditor.name")}
				</label>
				<input
					id="template-name"
					className="input"
					placeholder="Push A"
					value={draft.name}
					onChange={(e) => setDraft({ ...draft, name: e.target.value })}
				/>
			</div>
			<div>
				<label className="label" htmlFor="template-note">
					{t("templateEditor.note")}
				</label>
				<textarea
					id="template-note"
					className="input textarea"
					placeholder={t("templateEditor.notePlaceholder")}
					value={draft.note}
					onChange={(e) => setDraft({ ...draft, note: e.target.value })}
				/>
			</div>
			{draft.blocks.map((block, i) => (
				<BlockEditor
					key={block.key}
					block={block}
					index={i}
					count={draft.blocks.length}
					onChange={(next) => updateBlock(block.key, next)}
					onMove={(direction) => moveBlock(i, direction)}
					onRemove={() =>
						setDraft({
							...draft,
							blocks: draft.blocks.filter((b) => b.key !== block.key),
						})
					}
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
			{error ? <ErrorText>{error}</ErrorText> : null}
			<button
				type="button"
				className="btn btn-primary"
				onClick={submit}
				disabled={save.isPending}
			>
				{t("templateEditor.save")}
			</button>
			{templateId ? (
				<ConfirmButton
					label={t("templateEditor.delete")}
					confirmLabel={t("common.confirmDelete")}
					onConfirm={() => remove.mutate()}
					disabled={remove.isPending}
				/>
			) : null}

			{pickTarget ? (
				<Sheet
					title={t("templateEditor.pickExercise")}
					onClose={() => setPickTarget(null)}
				>
					<h2 className="display sheet-title">
						{t("templateEditor.pickExercise")}
					</h2>
					<div className="sheet-body">
						<ExercisePicker onSelect={pick} excludeIds={pickExclude} />
					</div>
				</Sheet>
			) : null}
		</main>
	);
}
