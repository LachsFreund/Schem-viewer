# Deployment mit Konten auf Render (Web Service + PostgreSQL)

> Nur nötig, wenn du Benutzerkonten willst. Für die einfache Seite (nur Zugangsschlüssel) bleibt alles wie vorher:
> Static Site, Build Command `npm install && npm run build`, Publish Directory `dist`, `render.yaml` benutzen.
> Für Konten stattdessen `render.accounts.yaml` (als `render.yaml` umbenennen) bzw. die Schritte unten.

Mit Konten läuft die Seite als **Web Service** (Node) – nicht mehr als Static Site – und braucht eine **PostgreSQL-Datenbank**.

## Einrichtung

1. Projekt in ein **privates** Repository legen.
2. Render → **New → Blueprint** und das Repository wählen (nutzt `render.yaml`), **oder** von Hand:
   - **New → PostgreSQL** anlegen.
   - **New → Web Service**, Repository wählen, Runtime *Node*:
     - Build Command: `npm install && npm run build`
     - Start Command: `npm start`
     - Health Check Path: `/api/status`
   - Environment:
     | Variable | Wert |
     |---|---|
     | `ACCESS_KEY` | dein Zugangsschlüssel (Pflicht, nur im Dashboard eintragen) |
     | `DATABASE_URL` | die **Internal Database URL** der Datenbank |
     | `REQUIRE_ACCOUNT` | `true` (Standard) = Konto nötig · `false` = Schlüssel allein genügt weiterhin |
     | `NODE_ENV` | `production` |
     | `TRUST_PROXY` | optional, siehe unten |
3. Deploy starten. Beim ersten Start legt der Server die Tabellen selbst an.

## Ablauf für Nutzer

* **Registrieren**: Benutzername + Passwort (mind. 10 Zeichen) + Zugangsschlüssel (dient als Einladung).
* **Anmelden**: danach nur noch Benutzername + Passwort.
* **Abmelden**: Knopf in der oberen Leiste.

## Konten verwalten (lokal am eigenen Rechner)

```
DATABASE_URL="<External Database URL>?sslmode=require" npm run admin -- list
DATABASE_URL="…" npm run admin -- disable <name>     # sperrt, laufende Sitzungen enden sofort
DATABASE_URL="…" npm run admin -- enable  <name>
DATABASE_URL="…" npm run admin -- delete  <name>
DATABASE_URL="…" npm run admin -- passwd  <name>     # neues Passwort setzen (Passwort vergessen)
```

## Schlüssel ändern

`ACCESS_KEY` im Dashboard ändern und neu deployen (der Build verschlüsselt neu). Bestehende Konten bleiben bestehen,
ihre Sitzungen bleiben gültig, der Server liefert den neuen Block automatisch aus.

## Tests

* `npm run selftest` – prüft Konten, Schutz des App-Blocks, Sperren, Ratenbegrenzung (mit temporärer Datei als Speicher).

## TRUST_PROXY

Render schaltet einen oder mehrere Proxys vor den Server. Damit die Ratenbegrenzung die **echte** Besucher-IP sieht, muss
`TRUST_PROXY` zur Zahl der Proxy-Stufen passen (Standard `1`). Prüfen: In den Render-Logs stehen Zeilen wie
`[auth] Login: anna ip=…`. Zeigen **alle** Besucher dieselbe IP, erhöhe `TRUST_PROXY` (z. B. auf `2`). Zu hoch gewählt
könnten Besucher ihre IP fälschen, zu niedrig teilen sich alle ein Limit.
