# CI/CD Deploy Implementation Plan

## Overview

Aktywacja automatycznego deployu na Cloudflare Workers po każdym push do `master`. Infrastruktura CI jest w większości gotowa (`.github/workflows/ci.yml` ma job `deploy`) — zadanie polega na skonfigurowaniu brakujących sekretów i optymalizacji workflow przez eliminację redundantnego buildu.

## Current State Analysis

Job `deploy` w `.github/workflows/ci.yml:26-47` istnieje i uruchamia się po `ci`. Problem: nie działa, bo brakuje kluczowych konfiguracji.

### Key Discoveries:

- **Worker istnieje i ma nazwę `10xtraining`** (`wrangler.jsonc:4`) — projekt w CF jest już założony
- **KV namespace `SESSION`** z hardcoded ID (`wrangler.jsonc:8`) musi istnieć w koncie CF; jeśli projekt jest już w CF, namespace jest aktywny
- **Deploy step przekazuje tylko 2 z 4 sekretów** przez `--var` (`ci.yml:43`): brakuje `OPENROUTER_API_KEY` i `SUPABASE_SERVICE_ROLE_KEY`
- **`--var` to plain-text bindings**, nie encrypted secrets — widoczne w CF dashboard; należy zastąpić CF secrets
- **GitHub Secrets `CLOUDFLARE_API_TOKEN` i `CLOUDFLARE_ACCOUNT_ID` nie są ustawione** — deploy job kompiluje się, ale wywołanie wranglera failuje
- **Deploy job duplikuje build z job ci** — drugi `npm run build` jest zbędny jeśli użyjemy GitHub Artifacts
- **4 wymagane zmienne runtime**: `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — wszystkie w `astro.config.mjs:21-25`

## Desired End State

Po każdym push do `master`:
1. Job `ci` (lint + build) uruchamia się i uploaduje zbudowany `dist/` jako GitHub Artifact
2. Job `deploy` pobiera artifact (bez ponownego buildu) i deployuje na Cloudflare Workers
3. Live URL `https://10xtraining.<account>.workers.dev` odzwierciedla najnowszy kod z `master` w ciągu ~2-3 minut od merge

Wszystkie sekrety aplikacji są skonfigurowane jako encrypted secrets w CF (nie przez `--var`). GitHub Secrets zawierają wyłącznie tokeny do autoryzacji CI wobec CF i Supabase (build-time).

### Weryfikacja:
- GitHub Actions: oba jody `ci` + `deploy` zielone po push do `master`
- Live URL odpowiada i wyświetla aplikację
- Generowanie planu treningowego działa (test runtime `OPENROUTER_API_KEY`)
- Usunięcie konta działa (test runtime `SUPABASE_SERVICE_ROLE_KEY`)

## What We're NOT Doing

- Nie tworzymy projektu CF od zera (projekt `10xtraining` już istnieje)
- Nie migrujemy z Workers na Pages — zostajemy na Workers (`wrangler deploy`)
- Nie dodajemy środowisk staging/preview — tylko production na `master`
- Nie konfigurujemy custom domain — workers.dev subdomain wystarczy na MVP
- Nie zmieniamy żadnego kodu aplikacji

## Implementation Approach

Trzy niezależne obszary wykonywane w porządku:
1. **Manual: GitHub Secrets** — tokeny CF potrzebne żeby CI mógł deployować
2. **Manual: CF runtime secrets** — sekrety aplikacji w CF (zastępują `--var`)
3. **Code: workflow optimization** — artifact upload w `ci` + artifact download w `deploy`, usunięcie `--var`

Fazy 1 i 2 to wyłącznie konfiguracja w zewnętrznych dashboardach (brak zmian w repo). Faza 3 to jedyna zmiana kodu (`ci.yml`).

---

## Phase 1: Cloudflare API Token + GitHub Secrets

### Overview

Wygenerowanie tokenu CF API z odpowiednimi uprawnieniami i ustawienie go jako GitHub Secret. Bez tego wrangler nie może autoryzować się do CF w CI.

### Changes Required:

#### 1. Generowanie Cloudflare API Token

**Gdzie**: Cloudflare dashboard → My Profile (ikona w prawym górnym rogu) → API Tokens → Create Token

**Intent**: Stworzyć token z uprawnieniami do deployowania Workers na koncie CF.

**Contract**: Użyj szablonu `Edit Cloudflare Workers`. Zakres uprawnienia to `Account > Cloudflare Workers Scripts: Edit`. Token musi mieć dostęp do odpowiedniego konta (Account Resources: All accounts lub specific account). Po stworzeniu skopiuj token — wyświetlany jest tylko raz.

#### 2. Znalezienie Cloudflare Account ID

**Gdzie**: Cloudflare dashboard → dowolna strona → prawy sidebar (sekcja "Account ID") LUB Workers & Pages → Overview → Account ID w prawym sidebarze

**Intent**: Pobranie Account ID wymaganego przez wrangler do identyfikacji konta.

**Contract**: Wartość to 32-znakowy hex string, np. `abc123def456...`

#### 3. Ustawienie GitHub Secrets

**Gdzie**: GitHub repo → Settings → Secrets and variables → Actions → New repository secret

**Intent**: Udostępnić token CF i Account ID dla job `deploy` w GitHub Actions.

**Contract**: Dodaj dwa sekrety:
- `CLOUDFLARE_API_TOKEN` — wartość z kroku 1
- `CLOUDFLARE_ACCOUNT_ID` — wartość z kroku 2

Zweryfikuj też, że `SUPABASE_URL` i `SUPABASE_KEY` już są ustawione (są referencowane przez istniejący job `ci` — jeśli CI kiedykolwiek przeszło, są tam).

### Success Criteria:

#### Manual Verification:

- GitHub repo Settings → Secrets and variables → Actions pokazuje co najmniej 4 sekrety: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_KEY`

**Implementation Note**: Po wykonaniu tej fazy zatrzymaj się i potwierdź, że sekrety są widoczne w GitHub UI przed przejściem do fazy 2.

---

## Phase 2: Cloudflare Runtime Secrets

### Overview

Ustawienie sekretów aplikacji bezpośrednio w CF dla workera `10xtraining`. Zastępuje obecne `--var` (plain-text bindings) właściwymi encrypted secrets.

### Changes Required:

#### 1. Ustawienie sekretów w CF Dashboard

**Gdzie**: Cloudflare dashboard → Workers & Pages → `10xtraining` → Settings → Variables and Secrets

**Intent**: Dostarczyć wszystkie 4 sekrety runtime jako encrypted secrets w CF, tak żeby worker miał do nich dostęp bez przekazywania przez GitHub Actions `--var`.

**Contract**: Dla każdego z 4 sekretów:
- Kliknij `Add` / `Add variable`
- Wpisz nazwę klucza (patrz lista poniżej)
- Wpisz wartość z lokalnego `.env`
- Wybierz typ **Secret** (nie Variable — Variable jest plain-text)
- Zapisz

Cztery sekrety do ustawienia:
- `SUPABASE_URL` — adres projektu Supabase
- `SUPABASE_KEY` — klucz anon/publishable Supabase
- `OPENROUTER_API_KEY` — klucz API OpenRouter
- `SUPABASE_SERVICE_ROLE_KEY` — service role key Supabase (używany przez delete-account)

### Success Criteria:

#### Manual Verification:

- CF dashboard Workers & Pages → `10xtraining` → Settings → Variables and Secrets pokazuje wszystkie 4 pozycje z ikoną kłódki (typ: Secret)

**Implementation Note**: Wartości sekretów nie powinny być wklejane nigdzie poza CF dashboard. Po tej fazie przejdź do fazy 3 (zmiana kodu).

---

## Phase 3: Optimize GitHub Actions Workflow

### Overview

Eliminacja redundantnego buildu w job `deploy` przez GitHub Artifacts. Job `ci` uploaduje `dist/` po udanym buildzie; job `deploy` pobiera go i deployuje — bez ponownego kompilowania. Jednocześnie usunięcie `--var` (sekrety teraz są w CF z fazy 2).

### Changes Required:

#### 1. Aktualizacja `.github/workflows/ci.yml`

**File**: `.github/workflows/ci.yml`

**Intent**: Dodać upload artifact na końcu job `ci` (tylko dla pushów na master) i przepisać job `deploy` — zastąpić rebuild pobraniem artifact, usunąć `--var`.

**Contract**: Pełna zawartość pliku po zmianie:

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx astro sync
      - run: npm run lint
      - run: npm run build
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
      - uses: actions/upload-artifact@v4
        if: github.ref == 'refs/heads/master' && github.event_name == 'push'
        with:
          name: dist
          path: dist/
          retention-days: 1

  deploy:
    needs: ci
    if: github.ref == 'refs/heads/master' && github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Kluczowe różnice względem obecnego pliku:
- `ci` job: dodany `upload-artifact` (krok warunkowy — tylko `master` push)
- `deploy` job: usunięte `setup-node` + `npm ci` + `astro sync` + `build` + ich env vars; dodany `download-artifact`; usunięte `--var` flagi z `npm run deploy`
- `deploy` job zachowuje własne `checkout` + `npm ci` bo wrangler jest devDependency i musi być dostępny lokalnie

### Success Criteria:

#### Automated Verification:

- `npm run lint` przechodzi (plik YAML nie jest objęty ESLint, ale żadne inne pliki nie zostały zmodyfikowane)

#### Manual Verification:

- Diff `ci.yml` zawiera wyłącznie oczekiwane zmiany: dodany `upload-artifact`, przepisany `deploy` job
- Brak resztek `--var` w pliku

**Implementation Note**: Po commicie tej zmiany przejdź bezpośrednio do fazy 4 (push triggeruje deploy pipeline).

---

## Phase 4: End-to-End Verification

### Overview

Weryfikacja, że cały pipeline działa end-to-end: push → CI → deploy → live URL → app funkcjonalna.

### Changes Required:

Brak zmian kodu — faza czysto weryfikacyjna.

### Success Criteria:

#### Automated Verification:

- GitHub Actions → ostatni run na `master` pokazuje dwa zielone jody: `ci` i `deploy`
- Job `deploy` w logach pokazuje `wrangler deploy` zakończony sukcesem z linkiem do live URL

#### Manual Verification:

- Live URL (z logów deploy job lub CF dashboard) odpowiada i wyświetla landing page
- Rejestracja / logowanie działa (test `SUPABASE_URL` + `SUPABASE_KEY` w runtime)
- Generowanie planu treningowego zwraca wynik AI (test `OPENROUTER_API_KEY` w runtime)
- Usunięcie konta przechodzi bez błędu (test `SUPABASE_SERVICE_ROLE_KEY` w runtime)

**Implementation Note**: Jeśli deploy job failuje, sprawdź logi wranglera — najczęstsze przyczyny to: zły scope tokenu CF (brak `Workers Scripts: Edit`) lub niedopasowana nazwa projektu. Jeśli app deployuje się ale OPENROUTER nie działa, sprawdź sekrety w CF dashboard (faza 2).

---

## Testing Strategy

### Manual Testing Steps:

1. Push dowolnej zmiany na `master` (np. whitespace w pliku) i obserwuj GitHub Actions
2. Potwierdź, że job `ci` uploaduje artifact (widoczny w summary joba)
3. Potwierdź, że job `deploy` pobiera artifact i uruchamia wrangler
4. Odwiedź live URL z logów deploy
5. Przetestuj pełny flow: landing → rejestracja → generowanie planu → zapis → usunięcie konta

## Migration Notes

Po fazie 3: `SUPABASE_URL` i `SUPABASE_KEY` są teraz skonfigurowane w **dwóch miejscach** — GitHub Secrets (dla build-time) i CF Secrets (dla runtime). To jest celowe i prawidłowe: Astro build potrzebuje ich żeby typ-checkować `import.meta.env`, Worker potrzebuje ich w runtime do wywołań Supabase.

## References

- Roadmap S-06: `context/foundation/roadmap.md`
- Obecny workflow: `.github/workflows/ci.yml`
- Konfiguracja wranglera: `wrangler.jsonc`
- Schemat env vars: `astro.config.mjs:20-27`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Cloudflare API Token + GitHub Secrets

#### Manual

- [x] 1.1 GitHub Secrets pokazuje CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, SUPABASE_URL, SUPABASE_KEY

### Phase 2: Cloudflare Runtime Secrets

#### Manual

- [x] 2.1 CF dashboard 10xtraining → Settings → Variables and Secrets pokazuje wszystkie 4 sekrety z ikoną kłódki

### Phase 3: Optimize GitHub Actions Workflow

#### Automated

- [x] 3.1 npm run lint przechodzi po zmianie ci.yml

#### Manual

- [x] 3.2 Diff ci.yml zawiera tylko oczekiwane zmiany, brak resztek --var

### Phase 4: End-to-End Verification

#### Automated

- [ ] 4.1 GitHub Actions pokazuje dwa zielone jody ci + deploy po push do master
- [ ] 4.2 Logi deploy job zawierają link do live URL i zakończenie wranglera sukcesem

#### Manual

- [ ] 4.3 Live URL odpowiada i wyświetla landing page
- [ ] 4.4 Logowanie działa na live URL
- [ ] 4.5 Generowanie planu treningowego zwraca wynik AI
- [ ] 4.6 Usunięcie konta przechodzi bez błędu
