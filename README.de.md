
<!-- banner -->
<div align="center">

# 🔐 dsh-coding-subscription-oauth

**v0.5.2 · früher `dsh-grok-build`

**OAuth-Plugin für Coding-Abonnements für [DeepSeek Harness](https://github.com/deepseek-ai/dsh).** Melden Sie sich einmal mit den Abonnements an, die Sie bereits bezahlen, und nutzen Sie die Modelle aus den Einstellungen oder der CLI von dsh. **Keine Tokens in den Chat einfügen.**

[![License](https://img.shields.io/badge/license-Apache--2.0-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

*[English](README.md) · [中文版](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Português (BR)](README.pt-BR.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Русский](README.ru.md)*

</div>

---

## Namensänderung

Zuerst **`dsh-grok-build`** (nur Grok Build). Jetzt SuperGrok / Codex / Kimi / Claude / Antigravity.

| | Das verwenden | Funktioniert weiter |
|---|---|---|
| GitHub / `dsh plugin add` | [`dsh-coding-subscription-oauth`](https://github.com/lninghaha/dsh-coding-subscription-oauth) | `github:lninghaha/dsh-grok-build` (derselbe `main`) |
| npm | `dsh-coding-subscription-oauth@0.5.2` (aktuelle Version) | Es gab kein altes npm-Paket |
| CLI | `dsh-coding-oauth` | `dsh-grok-build` |
| Cordis-Plugin-id | `llm-grok-build-oauth` | unverändert |
| Settings-HTTP-API | `/plugins/dsh-grok-build/*` | unverändert |
| Zugangsdateien | `$DSH_HOME/.grok-build-auth.json` und die anderen `*-oauth-auth.json` | unverändert |

## ✨ Funktionen

- 🧾 **Eigenes Abonnement mitbringen** — nutzen Sie die vorhandenen Coding-Pläne, die Sie bereits bezahlen, statt separater API-Keys.
- 🔑 **Lokales OAuth, ohne Key einzufügen** — in den Einstellungen oder der CLI autorisieren; Tokens gelangen nie in den Chat.
- 🧩 **Ein Plugin, fünf Anbieter** — Grok Build, Codex, Kimi, Claude und Google Antigravity.
- 🛡️ **Sicherheit by Design** — Zugangsdateien nur-eigentümer `0600`, atomares Schreiben, dateiübergreifende Prozesssperre.
- ⚙️ **Dynamischer Katalog** — der Modellwähler listet genau die Anbieter, die Sie authentifiziert haben.
- 🌐 **Proxy-bewusst** — nur geprüfte, vertrauenswürdige Abonnement-Domänen werden über den Proxy geleitet.
- 🔌 **Opt-in lokales API-Gateway** — standardmäßig ausgeschalteter Loopback-Server, OpenAI-/Anthropic-kompatibel; für Ihre eigenen Werkzeuge, niemals ein öffentliches Relay.

## Integrationsprobleme, die dieses Plugin löst

Diese Suchbegriffe und DSH-Fehler führen meist hierher.

| Gesucht / gesehen | Was kaputt war | Was das Plugin tut |
|---|---|---|
| SuperGrok / X Premium in DSH, Grok Build vs `api.x.ai` | Die eingebaute Route `xai` ist die Pay-as-you-go-API. Das Coding-Abo geht über `cli-chat-proxy.grok.com` | Route `grok-build` + CLI-Fingerabdruck-Header (`X-XAI-Token-Auth` usw.), damit kein stilles 403 entsteht |
| `API key is invalid` / `AUTH` | Die GUI mappt **jedes** AUTH auf diesen Text. Oft ist nur das kurze OAuth-Access-Token abgelaufen | Refresh **5 Min.** vor Ablauf; bei 401 Token invalidieren und den Step **wiederholen** |
| `INVALID_REPLAY_STATE` im 2. Codex/Kimi-Turn | Replay trug noch die native pi-ai-Provider-ID | Harness-Route-ID behalten und altes Replay heilen |
| grok-4.6 ohne **xhigh** | `/v1/models-v2` liefert bereits `reasoning_efforts`; das 4.5-Template versteckt xhigh | Live-Efforts einlesen. 4.6 hat xhigh; 4.5 bleibt low/medium/high |
| Kimi Code als Anthropic-`x-api-key` | OAuth-Token als Anthropic-Key gesendet | Nur `Authorization: Bearer` |
| Nicht angemeldete Modelle bleiben im Wähler | Alle registrierten Routen wurden gelistet | Nicht authentifizierte Routen sind leer; angemeldete Namen tragen `(OAuth)` |
| PKCE auf remote / headless DSH | Kein Weg zurück zu `localhost` | Device-Code für Grok/Codex/Kimi; Claude akzeptiert die eingefügte Redirect-URL |
| Proxy lässt Grok durch und legt Kimi in China lahm | Ein globales `HTTPS_PROXY` | Nur Allowlist; Kimi bleibt **direkt**, außer `proxyKimi: true` |

## Unterstützte Anbieter

| Anbieter | Route | Authentifizierung | Koexistiert mit |
|---|---|---|---|
| **xAI Grok Build** | `grok-build` | SuperGrok / X Premium OAuth | `xai` |
| **OpenAI Codex** | `codex-oauth` | ChatGPT Plus/Pro OAuth | `openai` |
| **Kimi Code** | `kimi-code-oauth` | Kimi Code OAuth | `kimi-coding` |
| **Claude Code** | `claude-code-oauth` | Claude Pro/Max OAuth | — |
| **Google Antigravity** | `agy` | `dsh-agy` Google OAuth | — |

> Der Geräte-Login von Grok Build, der dynamische `/v1/models-v2`-Katalog und das Responses-Streaming sind auf echten Deployments verifiziert. Codex/Kimi/Claude nutzen das native OAuth/Refresh von `@earendil-works/pi-ai`, anstatt die Anbieter-Flows neu zu implementieren.

## 🚀 Schnellstart

```bash
# 1. Plugin in das Web-Profil installieren (aktuelle npm-Version)
dsh plugin --profile web add dsh-coding-subscription-oauth@0.5.2

# 2. optional — Google Antigravity (gepinnte, geprüfte Version)
dsh plugin --profile web add dsh-agy@0.1.2

# 3. den residenten dsh-web-Dienst neu starten
systemctl --user restart dsh-web.service
```

Danach **Settings → Coding OAuth** öffnen und bei einem beliebigen Anbieter anmelden. Fertig — wählen Sie Ihr authentifiziertes Modell im Wähler.

## 📚 Inhaltsverzeichnis

- [Namensänderung](#namensänderung)
- [Integrationsprobleme, die dieses Plugin löst](#integrationsprobleme-die-dieses-plugin-löst)
- [Installation](#installation)
- [Einstellungsseite](#einstellungsseite)
- [Lokales API-Gateway](#lokales-api-gateway)
- [CLI](#cli)
- [Kimi in China](#kimi-in-china)
- [Netzwerk-Proxy](#netzwerk-proxy)
- [Ausfallsicherheit](#ausfallsicherheit)
- [Zugangsdaten](#zugangsdaten)
- [Architektur](#architektur)
- [Technische Hinweise](#technische-hinweise)
- [Compliance](#compliance)
- [Dokumentation](#dokumentation)
- [Mitwirken](#mitwirken)
- [Lizenz](#lizenz)

## Installation

Erfordert DeepSeek Harness `0.1.0-rc.6+` und Node.js 22.19+. Vollständige Details in den [Installationshinweisen](INSTALL.md).

```bash
# aktuelle npm-Version (empfohlen)
dsh plugin --profile web add dsh-coding-subscription-oauth@0.5.2

# Entwicklung/Alternativ: von GitHub
dsh plugin --profile web add github:lninghaha/dsh-coding-subscription-oauth

# Entwicklung/Alternativ: ein lokales Entwicklungs-Checkout
dsh plugin --profile web add ./dsh-coding-subscription-oauth
```

Nach der Installation `dsh web` neu starten. Verifikation gegen ein Live-Deployment:

```bash
pnpm run verify:deployed            # prüft echtes /api/llm.models + OAuth-Status
DSH_EXPECT_AGY_AUTH=signed-in pnpm run verify:deployed   # falls Google angemeldet ist

DSH_RESTORE_PROVIDER=openai \
DSH_RESTORE_MODEL=gpt-5.6-sol \
DSH_RESTORE_REASONING=max \
pnpm run smoke:deployed             # echte Codex/Kimi-Tool-Calls + Replay des zweiten Turns
```

> `smoke:deployed` erstellt eine temporäre Sitzung, validiert Codex- und Kimi-Tool-Calls sowie einen zweiten Benutzer-Turn (Regression für `INVALID_REPLAY_STATE`), stellt das deklarierte Standardmodell wieder her und archiviert die Sitzung.

## Einstellungsseite

**Settings → Coding OAuth** öffnen:

| Anbieter | Methoden |
|---|---|
| Grok | Autorisierungscode · Gerätecode · Grok-CLI-Import · Modellauswahl |
| Codex | Gerätecode (empfohlen auf Remote-DSH) · Browser-PKCE |
| Kimi | Gerätecode |
| Claude | Browser-PKCE (ein Remote-Browser kann die vollständige localhost-Redirect-URL einfügen) |
| Antigravity | `dsh-agy`-Installationsstatus + profil-lokale CLI-Befehle |

Die Einstellungsseite ist in vier obere Tabs aufgeteilt: **Accounts**, **Gateway**, **Capabilities** und **About**. Karten angemeldeter Anbieter klappen zu einer kompakten Zusammenfassung zusammen und werden für die Modellbearbeitung aufgeklappt. Die CLI-Pull-Vorschau ist volle Breite, und der Imagine-Status erscheint im Tab Capabilities.

Der Wähler listet nur Routen, die die Authentifizierung abgeschlossen haben; nicht authentifizierte Anbieter liefern eine leere Liste. Anbieternamen tragen `(OAuth)`, und der Katalog wird nach An-/Abmeldung über `llm/adapters-updated` aktualisiert.

## Optionale Funktionen

Die sieben Schalter `codexSearch`, `codexImages`, `codexImageEdits`, `codexUsage`, `codexFast`, `grokImagineImage` und `grokImagineVideo` sind standardmäßig aus und werden ohne Neustart live angewendet. Die Grenzwerte sind `searchResults` (1–20, Standard 5), `imageCount` (1–4, Standard 1) und `videoArtifactTtlMs` (1 Stunde–7 Tage, Standard 7 Tage; die Oberfläche zeigt 1–168 Stunden). Eine kürzere Aufbewahrung verkürzt und bereinigt vorhandene Artefakte sofort; eine Erhöhung gilt nur für neue Artefakte.

## Lokales API-Gateway

Standardmäßig **aus**. Wenn aktiviert, startet es einen isolierten `node:http`-Server (nicht der DSH-Web-Port) auf `127.0.0.1:18080` und nutzt dieselben angemeldeten OAuth-Sitzungen:

```yaml
gateway:
  enabled: false
  bind: 127.0.0.1
  port: 18080
```

Endpoints: `GET /healthz`, `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/messages`. Ein Bearer-Schlüssel wird in `$DSH_HOME/.coding-oauth-gateway.json` (`0600`) gespeichert. In den Einstellungen lassen sich die OpenAI-Basis-URL (Basis + `/v1`), die Anthropic-Basis-URL und der aktuelle Bearer-Schlüssel kopieren, ohne ihn zu rotieren; die Schlüsselanzeige ist nur über Loopback möglich und wird nicht im Browser-Speicher persistiert. Die Rotation ist eine bestätigte destruktive Aktion. Der Listen-Port kann direkt bearbeitet und mit Apply gespeichert oder per Random (18100–18999) gefüllt werden; der gewählte Port wird im Nur-Eigentümer-Gateway-Dokument persistiert, und ein laufender Listener bindet sich neu. Das Bind bleibt YAML-only; ein Nicht-Loopback-Bind erfordert einen Schlüssel. Dies ist kein Remote-Relay.

## CLI

```bash
# `dsh-grok-build` bleibt ein Befehlsalias
dsh-coding-oauth login [--pkce] | import | status | logout

# neuere Anbieter
dsh-coding-oauth login codex --device-auth | codex --browser | kimi | claude
dsh-coding-oauth status all
dsh-coding-oauth logout codex

# Antigravity (zuerst ins Web-Profil installieren)
dsh plugin --profile web exec dsh-agy login --headless
```

> Die `dsh-agy`-CLI ändert den Kontopool außerhalb des DSH-Prozesses und kann daher kein Katalogereignis im Prozess auslösen — nach An-/Abmeldung den Modellwähler schließen und wieder öffnen.

## Kimi in China

Das Kimi-Code-Abonnement-OAuth nutzt `https://auth.kimi.com`; das Inferencing nutzt `https://api.kimi.com/coding`. `https://api.moonshot.cn/v1` ist der Pay-as-you-go-API-Key-Kanal des **Moonshot Open Platform** — es gibt keinen umschaltbaren „China-OAuth-Endpunkt“. Dieses Plugin nutzt eine separate Route `kimi-code-oauth` und hat keinen Einfluss auf eine bestehende `kimi-coding`-API-Key-Konfiguration.

## Netzwerk-Proxy

Priorität: `config.proxy` → `CODING_OAUTH_PROXY` → `GROK_BUILD_PROXY` → `HTTPS_PROXY`/`HTTP_PROXY`.

```yaml
- id: llm-grok-build-oauth
  config:
    proxy: http://127.0.0.1:7890
    proxyKimi: false
```

Nur geprüfte Abonnement-Domänen werden proxied (xAI/Grok, OpenAI Codex, Claude/Anthropic, Google Antigravity); aller übriger DSH-Traffic behält seinen ursprünglichen Dispatcher. Kimi bleibt standardmäßig direkt und nutzt den Proxy nur bei `proxyKimi: true`.

## Ausfallsicherheit

OAuth-Zugriffstoken werden **fünf Minuten** vor dem gespeicherten Ablauf erneuert (pi-ai 0.84+). Lehnt der Upstream ein lokal noch gültiges Token mit 401/403 ab, setzt das Plugin das gespeicherte `expires` in die Vergangenheit; der wiederholte Step refresht zuerst und sendet dann erneut.

Wiederholungen folgen der Harness-Retry-Policy: transiente Fehler (`RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`/`EMPTY_RESPONSE`) **und `AUTH`** werden mit exponentiellem Backoff wiederholt (2 Versuche, 500 ms → 10 s, 10 % Jitter). Quota-Erschöpfung und ein totes Refresh-Token werden **nicht** wiederholt. Überschreiben pro Deployment:

```yaml
- id: llm-grok-build-oauth
  config:
    retryPolicy:
      mode: normal
      maxRetries: 2
      retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, AUTH]
      backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }
```

## Zugangsdaten

Nur-Eigentümer `0600`, atomares Schreiben, dateiübergreifende Prozesssperre:

- `$DSH_HOME/.grok-build-auth.json`
- `$DSH_HOME/.codex-oauth-auth.json`
- `$DSH_HOME/.kimi-code-oauth-auth.json`
- `$DSH_HOME/.claude-code-oauth-auth.json`

Auswahl-Caches liegen in den entsprechenden `*-models.json`-Dateien. **Kein HTTP-Status, kein Log und keine Oberfläche darf ein Token zurückgeben.**

## Architektur

```mermaid
flowchart LR
    subgraph DSH["DSH Harness"]
        UI[Einstellungen / Web · Coding OAuth] --> LLM[llm route]
        LLM --> ALIA[Routen-Alias-Adapter]
    end
    ALIA --> PI[nativer pi-ai-Anbieter<br/>OAuth · Refresh · Stream]
    PI --> GROK[Grok Build]
    PI --> COD[Codex]
    PI --> KIMI[Kimi]
    PI --> CLAU[Claude]
    AGY[dsh-agy-Plugin] --> GAL[Google Antigravity]
```

## Technische Hinweise

- **Grok Build**: eigener Responses-Anbieter auf `cli-chat-proxy.grok.com/v1`, CLI-Fingerprint-Header, dynamischer Modellkatalog.
- **Codex/Kimi/Claude**: native pi-ai-Anbieter übernehmen OAuth und Refresh; der Routen-Alias-Adapter mappt sie auf native ids, während die Modellidentität unverändert bleibt.
- Der Kimi-Zugangstoken wird explizit in `Authorization: Bearer` umgewandelt — niemals versehentlich als Anthropic-`x-api-key` gesendet.
- Google Antigravity wird hier **nicht** reverse-engineered; es nutzt ein versions-gepinntes dediziertes DSH-Plugin.

## Compliance

Coding-Abonnements über einen Drittanbieter-Harness zu nutzen, kann in einer Grauzone der Bedingungen jedes Anbieters liegen und Quoten-, Regional- oder Kontoriskokontrollen auslösen. **Nutzen Sie nur eigene Konten**; dieses Projekt unterstützt keine Massenkonten, Quotenverkauf, Remote-Relay, Paywall-Umgehung oder Client-Identitätsvortäuschung. Für kommerzielle Nutzung bevorzugen Sie die offiziellen API-Key-Kanäle der Anbieter.

## Dokumentation

| Dokument | Zweck |
|---|---|
| [`INSTALL.md`](INSTALL.md) | Installations- und Nutzungsdetails |
| [`CHANGELOG.md`](CHANGELOG.md) | Release-Historie |
| [`docs/00-project-rules.md`](docs/00-project-rules.md) | Versionierung, Release-Loop, Trennung öffentlich/privat |
| [`docs/02-architecture.md`](docs/02-architecture.md) | Interne Architektur (Routen, Datenfluss, Module, API) · [中文](docs/02-architecture.zh-CN.md) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Beitragsleitfaden |

## Verwandt

- [`dsh-agy`](https://www.npmjs.com/package/dsh-agy) — separates, versions-gepinntes Plugin für Google Antigravity.

## Mitwirken

Alle Arten von Beiträgen sind willkommen — Funktionen, Dokumentation, Übersetzungen, Bug-Reports. Siehe **[CONTRIBUTING](CONTRIBUTING.md)** für den Ablauf, Commit-Konventionen und den Release-Loop. Wenn Ihre Sprache nicht aufgeführt ist, senden Sie einen PR mit einer README-Übersetzung, und wir fügen sie der Tabelle oben hinzu.

## Lizenz

[Apache-2.0](LICENSE) · siehe [NOTICE](NOTICE). Teile stammen vom Projekt [dsh-xai](https://github.com/MirDie/dsh-xai) (Apache-2.0).
