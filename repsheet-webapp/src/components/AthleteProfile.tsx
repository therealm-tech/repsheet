import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorText, Segmented, Sheet } from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type { AthleteInput, WeightUnit } from "@/lib/api/schemas";
import { useUnit } from "@/lib/hooks";

/** The name and unit of a profile a coach manages for an athlete with no account. */
export function AthleteProfileForm({
	initial,
	submitLabel,
	pending,
	error,
	onSubmit,
}: {
	initial: AthleteInput;
	submitLabel: string;
	pending: boolean;
	error: string | null;
	onSubmit: (values: AthleteInput) => void;
}) {
	const { t } = useTranslation();
	const nameId = useId();
	const [name, setName] = useState(initial.name);
	const [weightUnit, setWeightUnit] = useState<WeightUnit>(initial.weightUnit);

	function submit(event: FormEvent) {
		event.preventDefault();
		if (name.trim()) {
			onSubmit({ name: name.trim(), weightUnit });
		}
	}

	return (
		<form className="stack-tight" onSubmit={submit}>
			<div>
				<label className="label" htmlFor={nameId}>
					{t("athletes.name")}
				</label>
				<input
					id={nameId}
					className="input"
					autoComplete="off"
					maxLength={100}
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</div>
			<div>
				<span className="label">{t("athletes.unit")}</span>
				<Segmented
					label={t("athletes.unit")}
					value={weightUnit}
					onChange={setWeightUnit}
					options={[
						{ value: "kg", label: "kg" },
						{ value: "lb", label: "lb" },
					]}
				/>
			</div>
			{error ? <ErrorText>{error}</ErrorText> : null}
			<button
				type="submit"
				className="btn btn-primary"
				disabled={pending || !name.trim()}
			>
				{submitLabel}
			</button>
		</form>
	);
}

/** A sheet with its title and a close button. */
export function TitledSheet({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const { t } = useTranslation();
	return (
		<Sheet title={title} onClose={onClose}>
			<div className="row">
				<h2 className="display sheet-title">{title}</h2>
				<span className="grow" />
				<button
					type="button"
					className="icon-button"
					aria-label={t("common.close")}
					onClick={onClose}
				>
					✕
				</button>
			</div>
			<div className="sheet-body">{children}</div>
		</Sheet>
	);
}

/** Creates a profile for someone with no account, then opens it. */
export function AddAthleteSheet({ onClose }: { onClose: () => void }) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const unit = useUnit();
	const create = useMutation({
		mutationFn: api.createAthlete,
		onSuccess: (athlete) => {
			queryClient.setQueryData(keys.athlete(athlete.id), athlete);
			void queryClient.invalidateQueries({ queryKey: keys.athletes });
			void navigate({
				to: "/athletes/$athleteId",
				params: { athleteId: athlete.id },
			});
		},
	});
	return (
		<TitledSheet title={t("athletes.addTitle")} onClose={onClose}>
			<p className="muted small">{t("athletes.addIntro")}</p>
			<AthleteProfileForm
				initial={{ name: "", weightUnit: unit }}
				submitLabel={t("athletes.create")}
				pending={create.isPending}
				error={
					create.isError
						? errorMessage(create.error, { fallback: "saveFailed" })
						: null
				}
				onSubmit={(values) => create.mutate(values)}
			/>
			<span className="or-divider">{t("athletes.hasAccount")}</span>
			<p className="muted small">{t("athletes.hasAccountHint")}</p>
		</TitledSheet>
	);
}

/** The "＋ Add an athlete" button and the sheet it opens. */
export function AddAthleteButton() {
	const { t } = useTranslation();
	const [adding, setAdding] = useState(false);
	return (
		<>
			<button
				type="button"
				className="btn btn-ghost"
				onClick={() => setAdding(true)}
			>
				{t("athletes.add")}
			</button>
			{adding ? <AddAthleteSheet onClose={() => setAdding(false)} /> : null}
		</>
	);
}
