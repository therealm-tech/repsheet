import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ErrorText, RoleTag, Segmented } from "@/components/ui";
import i18n, { rememberLocale } from "@/i18n";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type { Locale, WeightUnit } from "@/lib/api/schemas";
import { tokenStore } from "@/lib/auth";
import { useMe } from "@/lib/hooks";
import { logger } from "@/lib/logger";

/** Queries whose content the server localizes: exercise names live inside all of them. */
const LOCALIZED = new Set([
	"exercises",
	"exercise",
	"performances",
	"workouts",
	"workout",
	"templates",
	"template",
	"plannedSessions",
	"plannedSession",
	"plannedSessionWorkouts",
]);

/** Who is signed in, language and unit preferences, the admin entry point and sign-out. */
export function AccountPanel() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const me = useMe();
	const logout = useMutation({
		mutationFn: api.logout,
		onSettled: () => {
			tokenStore.clear();
			queryClient.clear();
			void navigate({ to: "/login" });
		},
		onError: (error) =>
			logger.warn("auth.logout.failed", { error: String(error) }),
	});
	const preferences = useMutation({
		mutationFn: api.updatePreferences,
		onSuccess: async (user) => {
			queryClient.setQueryData(keys.me, user);
			rememberLocale(user.locale);
			await i18n.changeLanguage(user.locale);
			void queryClient.invalidateQueries({
				predicate: (q) => LOCALIZED.has(String(q.queryKey[0])),
			});
		},
	});
	const user = me.data;
	const superAdmin = user?.role === "superAdmin";

	function save(change: { locale?: Locale; weightUnit?: WeightUnit }) {
		if (!user) {
			return;
		}
		preferences.mutate({
			locale: change.locale ?? user.locale,
			weightUnit: change.weightUnit ?? user.weightUnit,
		});
	}

	return (
		<div className="account-panel">
			<span className="row-tight">
				<span className="strong truncate">{user?.name}</span>
				{superAdmin ? <RoleTag value="superAdmin" /> : null}
			</span>
			<span className="muted small truncate">{user?.email}</span>
			{user ? (
				<>
					<div>
						<span className="label">{t("account.language")}</span>
						<Segmented
							label={t("account.language")}
							value={user.locale}
							onChange={(locale) => save({ locale })}
							options={[
								{ value: "fr", label: "Français" },
								{ value: "en", label: "English" },
							]}
						/>
					</div>
					<div>
						<span className="label">{t("account.unit")}</span>
						<Segmented
							label={t("account.unit")}
							value={user.weightUnit}
							onChange={(weightUnit) => save({ weightUnit })}
							options={[
								{ value: "kg", label: "kg" },
								{ value: "lb", label: "lb" },
							]}
						/>
					</div>
				</>
			) : null}
			{preferences.isError ? (
				<ErrorText>
					{errorMessage(preferences.error, { fallback: "saveFailed" })}
				</ErrorText>
			) : null}
			<Link to="/coaching" className="btn btn-small">
				{t("account.coaching")}
			</Link>
			{superAdmin ? (
				<Link to="/admin/accounts" className="btn btn-small">
					{t("account.accounts")}
				</Link>
			) : null}
			<button
				type="button"
				className="btn btn-small"
				onClick={() => logout.mutate()}
			>
				{t("account.logout")}
			</button>
		</div>
	);
}
