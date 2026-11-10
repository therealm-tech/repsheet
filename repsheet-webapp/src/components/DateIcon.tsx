import { formatMonthOfDay, parseDay, today } from "@/lib/dates";

/** A calendar-leaf badge for a planned day: the day of the month over the month. */
export function DateIcon({ day }: { day: string }) {
	return (
		<span
			className={day === today() ? "date-icon today" : "date-icon"}
			aria-hidden="true"
		>
			<b>{parseDay(day).getDate()}</b>
			<span>{formatMonthOfDay(day)}</span>
		</span>
	);
}
