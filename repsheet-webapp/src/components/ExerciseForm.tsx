import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	EquipmentSwitch,
	ErrorText,
	ModeSwitch,
	Segmented,
} from "@/components/ui";
import { currentLocale } from "@/i18n";
import type { ErrorKey } from "@/lib/api/errors";
import {
	type Equipment,
	EquipmentSchema,
	type ExerciseNamesInput,
	type Load,
	LoadSchema,
	type Locale,
	type Mode,
	ModeSchema,
} from "@/lib/api/schemas";
import { equipmentLabel } from "@/lib/blocks";

export interface ExerciseFormValues {
	names: Record<Locale, string>;
	modes: Mode[];
	defaultMode: Mode;
	load: Load;
	equipment: Equipment[];
	defaultEquipment: Equipment;
	unilateral: boolean;
	builtIn: boolean;
}

export interface ExerciseFormOutput {
	names: ExerciseNamesInput;
	modes: Mode[];
	defaultMode: Mode;
	load: Load;
	equipment: Equipment[];
	defaultEquipment: Equipment;
	unilateral: boolean;
	builtIn: boolean;
}

const NAME_MAX = 100;

function other(locale: Locale): Locale {
	return locale === "fr" ? "en" : "fr";
}

/**
 * A custom exercise needs one name; catalog exercises are seen by everyone
 * and need both. Returns the problem to show, or the cleaned names.
 */
export function checkNames(
	names: Record<Locale, string>,
	bothRequired: boolean,
): { error: ErrorKey } | { names: ExerciseNamesInput } {
	const fr = names.fr.trim();
	const en = names.en.trim();
	if (fr.length > NAME_MAX || en.length > NAME_MAX) {
		return { error: "nameTooLong" };
	}
	if (bothRequired && !fr) {
		return { error: "nameFrRequired" };
	}
	if (bothRequired && !en) {
		return { error: "nameEnRequired" };
	}
	if (!fr && !en) {
		return { error: "nameRequired" };
	}
	const out: ExerciseNamesInput = {};
	if (fr) {
		out.fr = fr;
	}
	if (en) {
		out.en = en;
	}
	return { names: out };
}

export function ExerciseForm({
	title,
	initial,
	submitLabel,
	allowBuiltIn,
	catalog = false,
	pending,
	error,
	onSubmit,
	onCancel,
}: {
	title: string;
	initial: ExerciseFormValues;
	submitLabel: string;
	/** Offers the "add to the catalog" toggle (super admins creating an exercise). */
	allowBuiltIn: boolean;
	/** Editing a catalog exercise: both names are required. */
	catalog?: boolean;
	pending: boolean;
	error: string | null;
	onSubmit: (values: ExerciseFormOutput) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	const id = useId();
	const [values, setValues] = useState(initial);
	const [invalid, setInvalid] = useState<ErrorKey | null>(null);
	const primary = currentLocale();
	const secondary = other(primary);
	const bothRequired = catalog || (allowBuiltIn && values.builtIn);

	function nameLabel(locale: Locale): string {
		if (bothRequired) {
			return t(locale === "fr" ? "exerciseForm.nameFr" : "exerciseForm.nameEn");
		}
		if (locale === primary) {
			return t("exerciseForm.name");
		}
		return t("exerciseForm.optional", {
			label: t(locale === "fr" ? "exerciseForm.nameFr" : "exerciseForm.nameEn"),
		});
	}

	/** Adds or removes a mode, keeping at least one and a default among them. */
	function toggleMode(mode: Mode) {
		const selected = values.modes.includes(mode);
		if (selected && values.modes.length === 1) {
			return;
		}
		const modes = ModeSchema.options.filter((m) =>
			m === mode ? !selected : values.modes.includes(m),
		);
		const defaultMode = modes.includes(values.defaultMode)
			? values.defaultMode
			: (modes[0] ?? mode);
		setValues({ ...values, modes, defaultMode });
	}

	/** Adds or removes an equipment, keeping at least one and a default among them. */
	function toggleEquipment(kind: Equipment) {
		const selected = values.equipment.includes(kind);
		if (selected && values.equipment.length === 1) {
			return;
		}
		const equipment = EquipmentSchema.options.filter((e) =>
			e === kind ? !selected : values.equipment.includes(e),
		);
		const defaultEquipment = equipment.includes(values.defaultEquipment)
			? values.defaultEquipment
			: (equipment[0] ?? kind);
		setValues({ ...values, equipment, defaultEquipment });
	}

	function submit(event: FormEvent) {
		event.preventDefault();
		const checked = checkNames(values.names, bothRequired);
		if ("error" in checked) {
			setInvalid(checked.error);
			return;
		}
		setInvalid(null);
		onSubmit({ ...values, names: checked.names });
	}

	const message = invalid ? t(`errors.${invalid}`) : error;
	return (
		<form className="card stack" onSubmit={submit} aria-label={title}>
			{[primary, secondary].map((locale) => (
				<div key={locale}>
					<label className="label" htmlFor={`${id}-name-${locale}`}>
						{nameLabel(locale)}
					</label>
					<input
						id={`${id}-name-${locale}`}
						className="input"
						lang={locale}
						value={values.names[locale]}
						onChange={(e) =>
							setValues({
								...values,
								names: { ...values.names, [locale]: e.target.value },
							})
						}
					/>
				</div>
			))}
			<fieldset className="field-group">
				<legend className="label">{t("exerciseForm.modes")}</legend>
				<div className="chips">
					{ModeSchema.options.map((mode) => {
						const on = values.modes.includes(mode);
						return (
							<button
								key={mode}
								type="button"
								className={on ? "chip on" : "chip"}
								aria-pressed={on}
								onClick={() => toggleMode(mode)}
							>
								{on ? <span aria-hidden="true">✓ </span> : null}
								{t(`modes.${mode}`)}
							</button>
						);
					})}
				</div>
			</fieldset>
			{values.modes.length > 1 ? (
				<div className="row small">
					<span className="muted">{t("exerciseForm.defaultMode")}</span>
					<span className="grow" />
					<ModeSwitch
						modes={values.modes}
						value={values.defaultMode}
						label={t("exerciseForm.defaultMode")}
						onChange={(defaultMode) => setValues({ ...values, defaultMode })}
					/>
				</div>
			) : null}
			<div>
				<span className="label">{t("exerciseForm.load")}</span>
				<Segmented
					label={t("exerciseForm.load")}
					value={values.load}
					onChange={(load) => setValues({ ...values, load })}
					options={LoadSchema.options.map((l) => ({
						value: l,
						label: t(`loads.${l}`),
					}))}
				/>
			</div>
			<fieldset className="field-group">
				<legend className="label">{t("exerciseForm.equipment")}</legend>
				<div className="chips">
					{EquipmentSchema.options.map((e) => {
						const on = values.equipment.includes(e);
						return (
							<button
								key={e}
								type="button"
								className={on ? "chip on" : "chip"}
								aria-pressed={on}
								onClick={() => toggleEquipment(e)}
							>
								{on ? <span aria-hidden="true">✓ </span> : null}
								{equipmentLabel(e)}
							</button>
						);
					})}
				</div>
			</fieldset>
			{values.equipment.length > 1 ? (
				<div className="row small">
					<span className="muted">{t("exerciseForm.defaultEquipment")}</span>
					<span className="grow" />
					<EquipmentSwitch
						equipment={values.equipment}
						value={values.defaultEquipment}
						label={t("exerciseForm.defaultEquipment")}
						onChange={(defaultEquipment) =>
							setValues({ ...values, defaultEquipment })
						}
					/>
				</div>
			) : null}
			<label className="row small">
				<input
					type="checkbox"
					checked={values.unilateral}
					onChange={(e) =>
						setValues({ ...values, unilateral: e.target.checked })
					}
				/>
				<span>{t("exerciseForm.unilateral")}</span>
			</label>
			{allowBuiltIn ? (
				<label className="row small">
					<input
						type="checkbox"
						checked={values.builtIn}
						onChange={(e) =>
							setValues({ ...values, builtIn: e.target.checked })
						}
					/>
					<span>{t("exerciseForm.builtIn")}</span>
				</label>
			) : null}
			{message ? <ErrorText>{message}</ErrorText> : null}
			<div className="row">
				<button type="button" className="btn" onClick={onCancel}>
					{t("common.cancel")}
				</button>
				<button
					type="submit"
					className="btn btn-primary grow"
					disabled={pending}
				>
					{submitLabel}
				</button>
			</div>
		</form>
	);
}
