{{- define "repsheet.fullname" -}}
{{- if .Values.global.fullnameOverride -}}
{{- .Values.global.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "repsheet.componentName" -}}
{{- printf "%s-%s" (include "repsheet.fullname" .root | trunc 56 | trimSuffix "-") .component -}}
{{- end -}}

{{/*
A component's values: `global` deep-merged with the component's own block, which
wins. Takes (dict "root" $ "component" "api"); use with `fromYaml`.
*/}}
{{- define "repsheet.values" -}}
{{- $component := index .root.Values .component -}}
{{- toYaml (mergeOverwrite (deepCopy .root.Values.global) (deepCopy $component)) -}}
{{- end -}}

{{- define "repsheet.selectorLabels" -}}
app.kubernetes.io/name: {{ .root.Chart.Name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "repsheet.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ .root.Chart.Name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- with .component }}
app.kubernetes.io/component: {{ . }}
{{- end }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
app.kubernetes.io/part-of: repsheet
{{- end -}}

{{- define "repsheet.serviceAccountName" -}}
{{- if .values.serviceAccount.create -}}
{{- default (include "repsheet.componentName" .) .values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "repsheet.image" -}}
{{- printf "%s:%s" .values.image.repository (.values.image.tag | default .root.Chart.AppVersion | toString) -}}
{{- end -}}

{{- define "repsheet.api.databaseSecretName" -}}
{{- with .Values.api.database.existingSecret.name -}}
{{- . -}}
{{- else -}}
{{- printf "%s-database" (include "repsheet.componentName" (dict "root" . "component" "api")) -}}
{{- end -}}
{{- end -}}

{{- define "repsheet.api.databaseSecretKey" -}}
{{- if .Values.api.database.existingSecret.name -}}
{{- .Values.api.database.existingSecret.key -}}
{{- else -}}
DATABASE_URL
{{- end -}}
{{- end -}}

{{- define "repsheet.api.superAdminSecretName" -}}
{{- with .Values.api.superAdmin.existingSecret.name -}}
{{- . -}}
{{- else -}}
{{- printf "%s-super-admin" (include "repsheet.componentName" (dict "root" . "component" "api")) -}}
{{- end -}}
{{- end -}}

{{- define "repsheet.api.superAdminSecretKey" -}}
{{- if .Values.api.superAdmin.existingSecret.name -}}
{{- .Values.api.superAdmin.existingSecret.key -}}
{{- else -}}
SUPER_ADMIN_PASSWORD
{{- end -}}
{{- end -}}

{{- define "repsheet.api.caCertsEnabled" -}}
{{- if or .Values.api.caCerts.inline .Values.api.caCerts.existing.name -}}true{{- end -}}
{{- end -}}

{{- define "repsheet.api.caCertsValidate" -}}
{{- if and .Values.api.caCerts.existing.name (not (has .Values.api.caCerts.existing.kind (list "ConfigMap" "Secret"))) -}}
{{- fail (printf "api.caCerts.existing.kind must be ConfigMap or Secret, got %q" .Values.api.caCerts.existing.kind) -}}
{{- end -}}
{{- end -}}

{{- define "repsheet.api.caCertsFromConfigMap" -}}
{{- if and .Values.api.caCerts.existing.name (eq .Values.api.caCerts.existing.kind "ConfigMap") -}}true{{- end -}}
{{- end -}}

{{- define "repsheet.api.caCertsGenerateSecret" -}}
{{- if and .Values.api.caCerts.inline (not .Values.api.caCerts.existing.name) -}}true{{- end -}}
{{- end -}}

{{- define "repsheet.api.caCertsSecretName" -}}
{{- with .Values.api.caCerts.existing.name -}}
{{- . -}}
{{- else -}}
{{- printf "%s-ca-certs" (include "repsheet.componentName" (dict "root" . "component" "api")) -}}
{{- end -}}
{{- end -}}

{{- define "repsheet.api.caCertsKey" -}}
{{- if .Values.api.caCerts.existing.name -}}
{{- .Values.api.caCerts.existing.key -}}
{{- else -}}
ca-certificates.crt
{{- end -}}
{{- end -}}

{{- define "repsheet.api.caCertsPath" -}}
{{- printf "/etc/repsheet/ca-certs/%s" (include "repsheet.api.caCertsKey" .) -}}
{{- end -}}
