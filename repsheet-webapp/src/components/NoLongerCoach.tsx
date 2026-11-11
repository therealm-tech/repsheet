import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ErrorText } from "@/components/ui";
import { ApiError } from "@/lib/api/client";

/** Whether a coach-side call failed because the athlete no longer has the caller as a coach. */
export function lostAccess(error: unknown): boolean {
	return (
		error instanceof ApiError && (error.status === 403 || error.status === 404)
	);
}

/** What a coach sees once the athlete has removed them, or on any page they cannot reach. */
export function NoLongerCoach() {
	const { t } = useTranslation();
	return (
		<main className="screen narrow">
			<ErrorText>{t("athlete.noLongerCoach")}</ErrorText>
			<p className="muted small">{t("athlete.noLongerCoachDetail")}</p>
			<Link to="/athletes" className="btn">
				{t("athlete.backToAthletes")}
			</Link>
		</main>
	);
}
