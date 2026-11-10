import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChoiceSwitch, ErrorText, Segmented } from "@/components/ui";
import { currentLocale } from "@/i18n";
import type { ErrorKey } from "@/lib/api/errors";
import {
	type Equipment,
	EquipmentSchema,
	type ExerciseNamesInput,
	type Grip,
	GripSchema,
	type Load,
	LoadSchema,
	type Locale,
	type Mode,
	ModeSchema,
} from "@/lib/api/schemas";
import { equipmentLabel, gripLabel } from "@/lib/blocks";
import { type Offer, toggleOffer } from "@/lib/choices";

export interface ExerciseFormValues {
	names: Record<Locale, string>;
	modes: Mode[];
	defaultMode: Mode;
	load: Load;
	equipment: Equipment[];
	defaultEquipment: Equipment;
	grips: Grip[];
	defaultGrip: Grip | null;
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
	grips: Grip[];
	defaultGrip: Grip | null;
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

/**
 * The values an exercise offers for one choice, as chips to toggle, and the
 * default one when there is more than one. A `required` offer keeps at least
 * one value.
 */
function OfferField<T extends string>({
	legend,
	defaultLabel,
	all,
	offer,
	required,
	optionLabel,
	shortLabel = optionLabel,
	onChange,
}: {
	legend: string;
	defaultLabel: string;
	all: readonly T[];
	offer: Offer<T>;
	required: boolean;
	optionLabel: (option: T) => string;
	/** The label in the compact default switch, when it differs. */
	shortLabel?: (option: T) => string;
	onChange: (offer: Offer<T>) => void;
}) {
	return (
		<>
			<fieldset className="field-group">
				<legend className="label">{legend}</legend>
				<div className="chips">
					{all.map((option) => {
						const on = offer.values.includes(option);
						return (
							<button
								key={option}
								type="button"
								className={on ? "chip on" : "chip"}
								aria-pressed={on}
								onClick={() =>
									onChange(toggleOffer(all, offer, option, required))
								}
							>
								{on ? <span aria-hidden="true">✓ </span> : null}
								{optionLabel(option)}
							</button>
						);
					})}
				</div>
			</fieldset>
			{offer.values.length > 1 ? (
				<div className="row small">
					<span className="muted">{defaultLabel}</span>
					<span className="grow" />
					<ChoiceSwitch
						options={offer.values}
						value={offer.defaultValue}
						label={defaultLabel}
						optionLabel={shortLabel}
						onChange={(defaultValue) => onChange({ ...offer, defaultValue })}
					/>
				</div>
			) : null}
		</>
	);
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
			<OfferField
				legend={t("exerciseForm.modes")}
				defaultLabel={t("exerciseForm.defaultMode")}
				all={ModeSchema.options}
				offer={{ values: values.modes, defaultValue: values.defaultMode }}
				required
				optionLabel={(mode) => t(`modes.${mode}`)}
				shortLabel={(mode) => t(`modesShort.${mode}`)}
				onChange={(offer) =>
					setValues({
						...values,
						modes: offer.values,
						defaultMode: offer.defaultValue ?? values.defaultMode,
					})
				}
			/>
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
			<OfferField
				legend={t("exerciseForm.equipment")}
				defaultLabel={t("exerciseForm.defaultEquipment")}
				all={EquipmentSchema.options}
				offer={{
					values: values.equipment,
					defaultValue: values.defaultEquipment,
				}}
				required
				optionLabel={equipmentLabel}
				onChange={(offer) =>
					setValues({
						...values,
						equipment: offer.values,
						defaultEquipment: offer.defaultValue ?? values.defaultEquipment,
					})
				}
			/>
			<OfferField
				legend={t("exerciseForm.grips")}
				defaultLabel={t("exerciseForm.defaultGrip")}
				all={GripSchema.options}
				offer={{ values: values.grips, defaultValue: values.defaultGrip }}
				required={false}
				optionLabel={gripLabel}
				onChange={(offer) =>
					setValues({
						...values,
						grips: offer.values,
						defaultGrip: offer.defaultValue,
					})
				}
			/>
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
