import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ExerciseForm } from "@/components/ExerciseForm";
import { ErrorText } from "@/components/ui";
import i18n, { currentLocale } from "@/i18n";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import {
	type Equipment,
	EquipmentSchema,
	type Exercise,
	type ExerciseSummary,
} from "@/lib/api/schemas";
import { describeExercise, equipmentLabel } from "@/lib/blocks";
import { useDebounced, useIsSuperAdmin } from "@/lib/hooks";

function describe(exercise: Exercise): string {
	return [
		...describeExercise(exercise),
		...(exercise.custom ? [i18n.t("exercise.custom")] : []),
	].join(" · ");
}

function CreateExerciseForm({
	initialName,
	onCreated,
	onCancel,
}: {
	initialName: string;
	onCreated: (exercise: Exercise) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const superAdmin = useIsSuperAdmin();
	const mutation = useMutation({
		mutationFn: api.createExercise,
		onSuccess: (exercise) => {
			void queryClient.invalidateQueries({ queryKey: ["exercises"] });
			onCreated(exercise);
		},
	});
	const locale = currentLocale();

	return (
		<ExerciseForm
			title={t("exerciseForm.newTitle")}
			submitLabel={t("exerciseForm.create")}
			initial={{
				names: {
					fr: locale === "fr" ? initialName : "",
					en: locale === "en" ? initialName : "",
				},
				modes: ["reps"],
				defaultMode: "reps",
				load: "required",
				equipment: ["barbell"],
				defaultEquipment: "barbell",
				grips: [],
				defaultGrip: null,
				unilateral: false,
				builtIn: false,
			}}
			allowBuiltIn={superAdmin}
			pending={mutation.isPending}
			error={
				mutation.isError
					? errorMessage(mutation.error, {
							fallback: "createExerciseFailed",
						})
					: null
			}
			onCancel={onCancel}
			onSubmit={({ builtIn, ...values }) =>
				mutation.mutate(superAdmin && builtIn ? { ...values, builtIn } : values)
			}
		/>
	);
}

export function ExercisePicker({
	onSelect,
	excludeIds = [],
	actionLabel = "＋",
	wide = false,
}: {
	onSelect: (exercise: ExerciseSummary) => void;
	excludeIds?: string[];
	actionLabel?: string;
	/** Lays results out as a card grid on wide screens (full pages, not sheets). */
	wide?: boolean;
}) {
	const { t } = useTranslation();
	const [query, setQuery] = useState("");
	const [equipment, setEquipment] = useState<Equipment | null>(null);
	const [creating, setCreating] = useState(false);
	const q = useDebounced(query.trim(), 250);
	const exercises = useQuery({
		queryKey: keys.exercises(q),
		queryFn: () =>
			api.exercises(
				q ? { q, perPage: 50 } : { sort: "-lastUsedOn", perPage: 50 },
			),
		placeholderData: keepPreviousData,
	});
	const items = (exercises.data?.items ?? []).filter(
		(e) =>
			!excludeIds.includes(e.id) &&
			(equipment === null || e.equipment.includes(equipment)),
	);

	if (creating) {
		return (
			<CreateExerciseForm
				initialName={query.trim()}
				onCancel={() => setCreating(false)}
				onCreated={(exercise) => {
					setCreating(false);
					onSelect(exercise);
				}}
			/>
		);
	}

	return (
		<div className="stack">
			<input
				className="input"
				type="search"
				placeholder={t("picker.search")}
				aria-label={t("picker.search")}
				value={query}
				onChange={(e) => setQuery(e.target.value)}
			/>
			<div className="chips">
				<button
					type="button"
					className={equipment === null ? "chip on" : "chip"}
					aria-pressed={equipment === null}
					onClick={() => setEquipment(null)}
				>
					{t("picker.all")}
				</button>
				{EquipmentSchema.options.map((e) => (
					<button
						key={e}
						type="button"
						className={equipment === e ? "chip on" : "chip"}
						aria-pressed={equipment === e}
						onClick={() => setEquipment(equipment === e ? null : e)}
					>
						{equipmentLabel(e)}
					</button>
				))}
			</div>
			<span className="label">
				{q ? t("picker.results") : t("picker.recentAndCatalog")}
			</span>
			{exercises.isError ? (
				<ErrorText>{t("picker.loadFailed")}</ErrorText>
			) : null}
			<ul
				className={wide ? "card list list-grid" : "card list"}
				aria-label={t("picker.listLabel")}
			>
				{items.map((exercise) => (
					<li key={exercise.id}>
						<button
							type="button"
							className="list-item"
							onClick={() => onSelect(exercise)}
						>
							<span className="grow">
								<span className="strong">{exercise.name}</span>
								<span className="muted small line-block">
									{describe(exercise)}
								</span>
							</span>
							<span className="accent" aria-hidden="true">
								{actionLabel}
							</span>
						</button>
					</li>
				))}
				{exercises.isSuccess && items.length === 0 ? (
					<li className="empty">{t("picker.empty")}</li>
				) : null}
			</ul>
			<button
				type="button"
				className="btn btn-ghost"
				onClick={() => setCreating(true)}
			>
				{query.trim()
					? t("picker.createNamed", { name: query.trim() })
					: t("picker.create")}
			</button>
		</div>
	);
}
