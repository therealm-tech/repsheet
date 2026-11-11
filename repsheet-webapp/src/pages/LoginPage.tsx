import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Logo } from "@/components/Logo";
import { ErrorText, Segmented } from "@/components/ui";
import i18n, { currentLocale, rememberLocale } from "@/i18n";
import { api } from "@/lib/api/endpoints";
import { errorMessage, validationMessage } from "@/lib/api/errors";
import {
	type Invitation,
	type Locale,
	type WeightUnit,
	WeightUnitSchema,
} from "@/lib/api/schemas";
import { tokenStore } from "@/lib/auth";

type Mode = "login" | "register";

const LoginSchema = z.object({
	email: z.email("invalidEmail"),
	password: z.string().min(1, "passwordRequired"),
});

const RegisterSchema = z.object({
	name: z.string().trim().min(1, "firstNameRequired").max(100, "nameTooLong"),
	email: z.email("invalidEmail"),
	password: z.string().min(8, "passwordLength").max(128, "passwordTooLong"),
	weightUnit: WeightUnitSchema,
});

/** A coach's invitation the page signs up or logs in with. */
export interface InvitationTarget {
	token: string;
	invitation: Invitation;
}

/** What the coach says when inviting: who invites, and what is already waiting. */
function InvitationHello({ invitation }: { invitation: Invitation }) {
	const { t } = useTranslation();
	return (
		<p className="invite-hello">
			<span className="avatar avatar-coach" aria-hidden="true">
				{invitation.coachName.charAt(0).toUpperCase()}
			</span>
			<span>
				{t("invite.hello", { coach: invitation.coachName })}{" "}
				{invitation.workoutCount === 0
					? t("invite.waitingNone")
					: t("invite.waiting", { count: invitation.workoutCount })}
			</span>
		</p>
	);
}

/**
 * Logs in or signs up. With an invitation, it opens on sign-up with the
 * profile's name, and logging in attaches the profile to the account.
 */
export function LoginPage({ invite }: { invite?: InvitationTarget } = {}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [mode, setMode] = useState<Mode>(invite ? "register" : "login");
	const [name, setName] = useState(invite?.invitation.athleteName ?? "");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [weightUnit, setWeightUnit] = useState<WeightUnit>("kg");
	const [error, setError] = useState<string | null>(null);
	const locale = currentLocale();

	const submit = useMutation({
		mutationFn: async () => {
			if (mode === "register") {
				const parsed = RegisterSchema.parse({
					name,
					email,
					password,
					weightUnit,
				});
				await api.register({
					...parsed,
					locale: currentLocale(),
					...(invite ? { invitation: invite.token } : {}),
				});
				return api.login({ email: parsed.email, password: parsed.password });
			}
			const token = await api.login(LoginSchema.parse({ email, password }));
			if (invite) {
				tokenStore.set(token);
				await api.acceptInvitation(invite.token);
			}
			return token;
		},
		onSuccess: (token) => {
			queryClient.clear();
			tokenStore.set(token);
			void navigate({ to: "/" });
		},
		onError: (err) => {
			setError(
				err instanceof z.ZodError
					? validationMessage(err)
					: errorMessage(err, {
							fallback: mode === "login" ? "loginFailed" : "registerFailed",
							unauthorized: "invalidCredentials",
						}),
			);
		},
	});

	function switchLanguage(next: Locale) {
		rememberLocale(next);
		void i18n.changeLanguage(next);
		setError(null);
	}

	function onSubmit(event: FormEvent) {
		event.preventDefault();
		setError(null);
		submit.mutate();
	}

	return (
		<main className="auth">
			<div className="auth-language">
				<Segmented
					label={t("account.languageBoth")}
					value={locale}
					onChange={switchLanguage}
					options={[
						{ value: "fr", label: "FR" },
						{ value: "en", label: "EN" },
					]}
				/>
			</div>
			<div className="auth-brand">
				<Logo width={150} />
				<h1 className="display auth-title">RepSheet</h1>
				<p className="muted small">{t("login.tagline")}</p>
			</div>
			{invite ? <InvitationHello invitation={invite.invitation} /> : null}
			<form className="stack" onSubmit={onSubmit} noValidate>
				<Segmented
					label={t("login.mode")}
					value={mode}
					onChange={(next) => {
						setMode(next);
						setError(null);
					}}
					options={[
						{ value: "login", label: t("login.login") },
						{ value: "register", label: t("login.register") },
					]}
				/>
				{mode === "register" ? (
					<div>
						<label className="label" htmlFor="name">
							{t("login.firstName")}
						</label>
						<input
							id="name"
							className="input"
							autoComplete="given-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					</div>
				) : null}
				<div>
					<label className="label" htmlFor="email">
						{t("login.email")}
					</label>
					<input
						id="email"
						className="input"
						type="email"
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
				</div>
				<div>
					<label className="label" htmlFor="password">
						{t("login.password")}
					</label>
					<input
						id="password"
						className="input"
						type="password"
						autoComplete={
							mode === "login" ? "current-password" : "new-password"
						}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
				</div>
				{mode === "register" ? (
					<div>
						<span className="label">{t("account.unit")}</span>
						<Segmented
							label={t("login.weightUnit")}
							value={weightUnit}
							onChange={setWeightUnit}
							options={[
								{ value: "kg", label: "kg" },
								{ value: "lb", label: "lb" },
							]}
						/>
					</div>
				) : null}
				{invite && mode === "login" ? (
					<p className="muted small">{t("invite.loginHint")}</p>
				) : null}
				{error ? <ErrorText>{error}</ErrorText> : null}
				<button
					type="submit"
					className="btn btn-primary"
					disabled={submit.isPending}
				>
					{mode === "login"
						? t("login.submitLogin")
						: t("login.submitRegister")}
				</button>
			</form>
		</main>
	);
}
