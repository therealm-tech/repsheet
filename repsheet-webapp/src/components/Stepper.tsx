import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { parseTyped } from "@/lib/grid";
import { formatNumber } from "@/lib/units";

interface StepperProps {
	/** Accessible name; also the visible label unless `visibleLabel` is given. */
	label: string;
	visibleLabel?: string;
	value: number | null;
	unit: string;
	hint: string;
	emptyText?: string;
	/** Shows the value in the field; a plain number by default. */
	format?: (value: number) => string;
	/** Reads what was typed; a number with either decimal separator by default. */
	parse?: (text: string) => number | null;
	onStep: (direction: 1 | -1) => void;
	onChange: (value: number | null) => void;
}

function formatPlain(value: number): string {
	return formatNumber(value).replace(/\s/g, "");
}

export function Stepper({
	label,
	visibleLabel,
	value,
	unit,
	hint,
	emptyText = "—",
	format = formatPlain,
	parse = parseTyped,
	onStep,
	onChange,
}: StepperProps) {
	const { t } = useTranslation();
	const [draft, setDraft] = useState(value === null ? "" : format(value));
	const [focused, setFocused] = useState(false);
	const id = useId();

	// Follows the value changed from outside (± presses, another cell) unless
	// the user is typing in the field.
	useEffect(() => {
		if (!focused) {
			setDraft(value === null ? "" : format(value));
		}
	}, [value, focused, format]);

	function commit() {
		onChange(parse(draft));
	}

	return (
		<div className="stepper">
			<button
				type="button"
				className="stepper-key"
				aria-label={t("stepper.minus", { label })}
				onClick={() => onStep(-1)}
			>
				−
			</button>
			<div className="stepper-value">
				<label className="muted small" htmlFor={id}>
					{visibleLabel ?? label}
				</label>
				<div className="stepper-field">
					<input
						id={id}
						aria-label={label}
						className="stepper-input"
						inputMode="decimal"
						enterKeyHint="done"
						autoComplete="off"
						placeholder={emptyText}
						value={draft}
						onFocus={(e) => {
							setFocused(true);
							e.target.select();
						}}
						onChange={(e) => setDraft(e.target.value)}
						onBlur={() => {
							setFocused(false);
							commit();
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") {
								e.currentTarget.blur();
							}
						}}
					/>
					{unit ? <span className="stepper-unit">{unit}</span> : null}
				</div>
				<span className="muted small">{hint}</span>
			</div>
			<button
				type="button"
				className="stepper-key"
				aria-label={t("stepper.plus", { label })}
				onClick={() => onStep(1)}
			>
				＋
			</button>
		</div>
	);
}
