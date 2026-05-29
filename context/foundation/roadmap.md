---
project: 10xTraining
version: 1
status: draft
created: 2026-05-27
updated: 2026-05-27
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: 10xTraining

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Amatorowi kolarzowi brakuje narzędzia, które zamieni wklejone dane z ostatniego miesiąca jazd (średnia prędkość, czas, przewyższenie) na spersonalizowany, czterotygodniowy plan treningowy. 10xTraining zamyka tę lukę: użytkownik wkleja statystyki, wybiera cel (szybkość lub dystans) i natychmiast dostaje gotowy plan sesji — a nie generyczny szablon ignorujący jego rzeczywisty poziom. Hipoteza produktowa (ang. *core hypothesis* — jedno zdanie opisujące, dlaczego produkt powinien działać, zanim jeszcze sprawdzisz to na użytkownikach) brzmi: „własne dane kolarza to najlepsza podstawa do planu treningowego" — i dopóki tego nie zweryfikujemy na realnych użytkownikach, reszta to spekulacja.

## North star

**S-01: użytkownik może się zarejestrować, zalogować, wygenerować plan treningowy i go zapisać** — najkrótszy przebieg end-to-end (przepływ przez wszystkie warstwy: UI, backend, baza danych), który pozwala zmierzyć główną metrykę sukcesu: odsetek zapisanych planów (cel: 75%). Wszystko inne w roadmapie tylko powiększa wartość już działającego produktu.

> Gwiazda przewodnia (*north star*) — to najmniejszy przebieg end-to-end, którego dostarczenie udowadnia, że rdzeń produktu działa. Umieszczona jak najwcześniej, bo wszystko inne ma sens tylko wtedy, gdy ten przebieg już żyje.

## At a glance

| ID   | Change ID           | Outcome (user can …)                                                                              | Prerequisites | PRD refs                                                              | Status   |
|------|---------------------|---------------------------------------------------------------------------------------------------|---------------|-----------------------------------------------------------------------|----------|
| F-01 | plans-db-schema     | (foundation) schemat tabeli `plans` + polityki RLS wdrożone; baza gotowa na zapis i odczyt planów  | —             | FR-007, FR-009, FR-011                                                | ready    |
| F-02 | llm-provider-wiring | (foundation) integracja z zewnętrznym LLM; scaffold promptu generującego plan treningowy gotowy    | —             | FR-006                                                                | blocked  |
| S-01 | auth-generate-save  | zarejestrować się, zalogować, wkleić statystyki, wybrać cel, wygenerować plan i zapisać go; plan pojawia się na liście | F-01, F-02    | US-01, FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-009 | proposed |
| S-02 | delete-plan         | usunąć zapisany plan ze swojej listy                                                              | S-01          | FR-011                                                                | proposed |
| S-03 | regenerate-plan     | wygenerować nowy plan treningowy z poziomu listy planów bez ponownego wypełniania wszystkiego od zera | S-01       | FR-006                                                                | done     |
| S-04 | delete-account      | usunąć swoje konto wraz ze wszystkimi planami; po usunięciu jest wylogowany                        | S-01          | FR-012                                                               | proposed |

## Streams

Tabela nawigacyjna — grupuje elementy według wspólnego łańcucha zależności. Kanoniczna kolejność żyje w grafie zależności poniżej; ta tabela pokazuje proponowany porządek czytania w równoległych torach.

| Stream | Temat           | Łańcuch                   | Uwaga                                                            |
|--------|-----------------|---------------------------|------------------------------------------------------------------|
| A      | Baza + flow     | `F-01` → `S-01` → `S-02` / `S-03` / `S-04` | Główny łańcuch; S-02, S-03, S-04 są równoległe po S-01; `F-02` (Stream B) dołącza przy `S-01`. |
| B      | Integracja AI   | `F-02`                                      | Równolegle z F-01; dołącza do Streamu A przy `S-01`.             |

## Baseline

Stan bazy kodu na dzień 2026-05-27 (zbadany automatycznie + potwierdzony przez użytkownika).
Foundations poniżej zakładają, że poniższe warstwy są obecne i NIE re-scaffoldują ich.

- **Frontend:** present — Astro 6.3.1 + React 19 + Tailwind CSS 4; strony w `src/pages/`, komponenty auth w `src/components/auth/`
- **Backend / API:** present — Astro SSR (@astrojs/cloudflare), endpointy auth w `src/pages/api/auth/`, middleware w `src/middleware.ts`
- **Data:** partial — klient Supabase obecny (`src/lib/supabase.ts`), brak schematu / migracji (`supabase/config.toml`: schema_paths=[])
- **Auth:** present — Supabase auth (@supabase/ssr), weryfikacja sesji w `src/lib/supabase.ts:9`, guard trasy w `src/middleware.ts:18-21` (chroni `/dashboard`)
- **Deploy / infra:** present — Cloudflare Pages + wrangler, CI/CD w `.github/workflows/ci.yml`
- **Observability:** absent — brak biblioteki logowania, śledzenia błędów ani metryk

## Foundations

### F-01: plans-db-schema

- **Outcome:** (foundation) migracja Supabase tworząca tabelę `plans` wdrożona; polityki RLS (Row Level Security — mechanizm bazy danych izolujący dane każdego użytkownika) zapewniają, że każdy użytkownik widzi wyłącznie własne plany; baza gotowa na operacje zapisu, odczytu i usuwania.
- **Change ID:** plans-db-schema
- **PRD refs:** FR-007, FR-009, FR-011
- **Unlocks:** S-01 (zapis i odczyt planu), S-02 (usunięcie planu)
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** brak migracji w obecnym kodzie; zdefiniowanie schematu i polityk RLS musi poprzedzać S-01 — pominięcie tego kroku powoduje, że nie ma gdzie zapisać planu ani jak wyegzekwować izolacji danych.
- **Status:** ready

### F-02: llm-provider-wiring

- **Outcome:** (foundation) wybrany i skonfigurowany dostawca LLM (klucz API w zmiennych środowiskowych), SDK lub klient HTTP zainstalowany, prototypowy prompt generujący czterotygodniowy plan treningowy przetestowany manualnie i zwracający poprawną strukturę danych.
- **Change ID:** llm-provider-wiring
- **PRD refs:** FR-006
- **Unlocks:** S-01 (generowanie planu treningowego)
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:**
  - Który dostawca LLM? (OpenAI, Anthropic, OpenRouter lub inny) — Owner: użytkownik. Block: yes.
- **Risk:** dostawca LLM nie jest nazwany w tech-stack.md (tylko „external LLM API"); wybór wpływa na model cenowy, limity szybkości i latencję. Opóźnienie tej decyzji blokuje cały tor AI i przesuwa S-01. NFR: plan musi być widoczny w 30 sekund — wymaga to sprawdzenia latencji wybranego modelu.
- **Status:** blocked

## Slices

### S-01: auth-generate-save

- **Outcome:** użytkownik może się zarejestrować, potwierdzić email, zalogować, wkleić statystyki jazd z ostatniego miesiąca (średnia prędkość, czas, przewyższenie), wybrać cel (szybkość lub dystans), wygenerować czterotygodniowy plan treningowy i go zapisać; po zapisaniu plan pojawia się na liście konta; zbyt skąpe dane wejściowe (puste pole lub pojedyncza jazda) pokazują komunikat błędu zamiast cichego śmieciowego wyniku; użytkownik może się wylogować.
- **Change ID:** auth-generate-save
- **PRD refs:** US-01, FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-009
- **Prerequisites:** F-01, F-02
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Czy scaffold auth (sign-up / sign-in / email confirmation) działa end-to-end w aktualnym środowisku Cloudflare Workers? — Owner: użytkownik. Block: no.
- **Risk:** największy slice w roadmapie — łączy weryfikację auth, wywołanie LLM i persystencję w bazie; jeśli budżet czasowy skończy się w połowie, slice jest niekompletny. Mitygacja: zaczynać od happy path (poprawne dane → generowanie → zapis), obsługę błędów i edge-case'y zostawić na koniec.
- **Status:** proposed

### S-02: delete-plan

- **Outcome:** użytkownik może usunąć wybrany plan ze swojej listy; plan znika natychmiast z widoku; usunięcie jest nieodwracalne (brak okna potwierdzenia w MVP).
- **Change ID:** delete-plan
- **PRD refs:** FR-011
- **Prerequisites:** S-01
- **Parallel with:** S-03, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** prosty CRUD; główne ryzyko to brak walidacji właściciela po stronie API — bez weryfikacji ID planu względem sesji użytkownika można by usunąć plan innego użytkownika przez manipulację parametrem. RLS z F-01 powinien to pokrywać na poziomie DB, ale endpoint musi to egzekwować też na poziomie aplikacji.
- **Status:** proposed

### S-03: regenerate-plan

- **Outcome:** użytkownik może z poziomu listy swoich planów rozpocząć generowanie nowego planu treningowego bez konieczności przechodzenia przez cały onboarding od nowa; formularz generowania jest dostępny bezpośrednio z dashboardu po zalogowaniu.
- **Change ID:** regenerate-plan
- **PRD refs:** FR-006
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** minimalny — to ponowne użycie przepływu z S-01 (FR-006); główne ryzyko to przeładowanie UI dashboardu, jeśli formularz generowania i lista planów będą na tej samej stronie bez dobrego podziału stanu.
- **Status:** done
- **Delivered:**
  - Dashboard: przycisk „+ Generate plan" otwiera modal z formularzem GeneratePlanForm bezpośrednio na stronie (bez nawigacji do `/generate`); modal używa `client:only="react"` by uniknąć konfliktu SSR.
  - Plan detail (`/plans/{id}`): przycisk „Regenerate plan" otwiera modal z wstępnie wypełnionymi danymi (`ride_stats`, `goal`) z bieżącego planu; po zatwierdzeniu plan jest zastępowany w miejscu (ten sam ID) przez nowy wynik AI — `POST /api/plans/{id}`.
  - Baza: dodana polityka RLS `plans_update_own` (migracja `20260529000000`), wymagana do operacji UPDATE; wcześniej brakująca bo FR-010 (edycja) była odłożona.
  - `DeletePlanButton`: po usunięciu ostatniego planu strona przeładowuje się do empty state.

### S-04: delete-account

- **Outcome:** użytkownik może trwale usunąć swoje konto i wszystkie powiązane plany treningowe; po usunięciu sesja jest zakończona, a próba logowania z tymi samymi danymi jest odrzucana.
- **Change ID:** delete-account
- **PRD refs:** FR-012
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** dane użytkownika są trwale kasowane i nie można ich odzyskać; operacja musi usuwać rekordy we wszystkich tabelach Supabase (plans + auth.users) i być chroniona przed przypadkowym wywołaniem (np. potwierdzenie hasłem lub dedykowany przycisk destrukcyjny).
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID           | Suggested issue title                                          | Ready for `/10x-plan` | Notes                                          |
|------------|---------------------|----------------------------------------------------------------|-----------------------|------------------------------------------------|
| F-01       | plans-db-schema     | Supabase: schemat tabeli `plans` + polityki RLS                | yes                   | Uruchom `/10x-plan plans-db-schema`            |
| F-02       | llm-provider-wiring | Integracja LLM: wybór dostawcy + scaffold promptu do planów    | no                    | Najpierw rozwiąż Q1 (wybór dostawcy LLM)       |
| S-01       | auth-generate-save  | Auth + generowanie planu + zapis do konta (US-01, pełny flow)  | no                    | Wymaga F-01 i F-02                             |
| S-02       | delete-plan         | Usuwanie planu z listy (FR-011)                                | no                    | Wymaga S-01; równolegle z S-03, S-04           |
| S-03       | regenerate-plan     | Ponowne generowanie planu z dashboardu (FR-006)                | no                    | Wymaga S-01; równolegle z S-02, S-04           |
| S-04       | delete-account      | Usunięcie konta użytkownika i wszystkich danych                | no                    | Wymaga FR w PRD (patrz Q2) + S-01              |

## Open Roadmap Questions

1. **Który dostawca LLM do generowania planów treningowych?** (OpenAI, Anthropic, OpenRouter lub inny) — Owner: użytkownik. Block: F-02 i S-01 (planowanie implementacji integracji AI nie może ruszyć bez tej decyzji).
2. ~~**Dodać do PRD wymaganie dot. usunięcia konta (S-04)?**~~ — Rozwiązane 2026-05-27: FR-012 dodane do PRD; S-04 odblokowany.

## Parked

- **Integracje z zewnętrznymi platformami (Strava, Garmin)** — Dlaczego odłożone: PRD §Non-Goals: „No third-party integrations".
- **Import pliku (PDF, DOCX, CSV, GPX)** — Dlaczego odłożone: PRD §Non-Goals: „No multiple import formats".
- **Udostępnianie planów między użytkownikami** — Dlaczego odłożone: PRD §Non-Goals: „No plan sharing between users".
- **Ręczne tworzenie planów** — Dlaczego odłożone: PRD §Non-Goals: „No manual plan creation".
- **Aplikacje mobilne** — Dlaczego odłożone: PRD §Non-Goals: „No mobile apps".
- **Trening pod konkretną trasę** — Dlaczego odłożone: PRD §Non-Goals: „No route-specific training".
- **Edycja planu (FR-010)** — Dlaczego odłożone: PRD demoted to nice-to-have; regenerowanie planu zastępuje edycję w MVP.
- **Niestandardowe nazwy planów (FR-008)** — Dlaczego odłożone: PRD demoted to nice-to-have; auto-generowana nazwa (cel + data) wystarczy w MVP.
- **Observability (logowanie, śledzenie błędów, metryki)** — Dlaczego odłożone: cel sekwencjonowania `speed` + brak NFR dotyczącego uptime'u; Cloudflare i CI/CD są gotowe, ale pełna infrastruktura observability wykracza poza must-have path MVP.

## Done

| ID   | Change ID           | Zamknięte  | Uwagi                                                                                      |
|------|---------------------|------------|--------------------------------------------------------------------------------------------|
| S-02 | delete-plan         | 2026-05-28 | Usuwanie planu z listy + strony szczegółów; RLS DELETE z F-01 pokrywa izolację danych.    |
| S-03 | regenerate-plan     | 2026-05-29 | Modal generate na dashboardzie + regeneracja w miejscu z widoku planu; RLS UPDATE dodana. |
