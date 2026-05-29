# CI/CD Deploy — Plan Brief

> Full plan: `context/changes/ci-cd-deploy/plan.md`

## What & Why

Aktywacja automatycznego deployu aplikacji na Cloudflare Workers po każdym push do `master`. Job `deploy` w GitHub Actions istnieje, ale nigdy nie działał — brakuje tokenów CF w GitHub Secrets, a 2 z 4 sekretów runtime aplikacji nie są przekazywane do workera.

## Starting Point

`.github/workflows/ci.yml` ma skonfigurowany job `deploy` zależny od `ci`, uruchamiający `wrangler deploy --config dist/server/wrangler.json`. Worker `10xtraining` istnieje w Cloudflare. Brakuje: tokenów autoryzacyjnych CF w GitHub Secrets, sekretów `OPENROUTER_API_KEY` i `SUPABASE_SERVICE_ROLE_KEY` w runtime, i deploy job duplikuje full build zamiast reużyć artefakt z job `ci`.

## Desired End State

Push do `master` → GitHub Actions uruchamia `ci` (lint + build + upload artifact) → `deploy` pobiera artifact i deployuje na `https://10xtraining.<account>.workers.dev` w ~2-3 minuty. Wszystkie 4 sekrety aplikacji są encrypted secrets w CF; pipeline nie przechowuje wartości sekretów poza nimi.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Sekrety aplikacji w runtime | CF secrets (dashboard) | Plain-text `--var` jest widoczny w CF dashboard; encrypted secrets są bezpieczniejsze i niezależne od workflow | Plan |
| Duplicate build | Artifact reuse (upload/download) | Deploy job powinien deployować dokładnie ten build, który przeszedł testy w `ci` — drugi build jest zbędny i niespójny | Plan |
| Deploy target | Cloudflare Workers (`wrangler deploy`) | Projekt już istnieje jako Worker; nie migrujemy na Pages | Plan |
| GitHub Secrets zakres | CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID | Minimalne uprawnienia — CF token potrzebny tylko do deployu, sekrety app zostają w CF | Plan |

## Scope

**In scope:**
- Generowanie i konfiguracja CF API token + GitHub Secrets
- Ustawienie 4 sekretów runtime w CF dashboard dla workera `10xtraining`
- Optymalizacja `ci.yml`: artifact upload w `ci`, artifact download w `deploy`, usunięcie `--var`
- Weryfikacja end-to-end (live URL + krytyczne flows)

**Out of scope:**
- Tworzenie projektu CF (już istnieje)
- Custom domain
- Środowisko staging / preview deployments
- Zmiany w kodzie aplikacji

## Architecture / Approach

```
push → master
    → ci job: checkout → npm ci → lint → build (SUPABASE_URL/KEY) → upload dist/
    → deploy job: checkout → npm ci → download dist/ → wrangler deploy
                                                          ↓
                                              Cloudflare Workers (10xtraining)
                                              [reads SUPABASE_*, OPENROUTER_*, SERVICE_ROLE_KEY
                                               from CF encrypted secrets]
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. CF Token + GitHub Secrets | CLOUDFLARE_API_TOKEN i CLOUDFLARE_ACCOUNT_ID w GitHub Secrets | Token CF z za wąskim scope — wrangler zafailuje z 403 |
| 2. CF Runtime Secrets | Wszystkie 4 sekrety aplikacji jako encrypted secrets w CF | Pominięcie SUPABASE_SERVICE_ROLE_KEY — delete-account sypie się w runtime |
| 3. Workflow optimization | ci.yml bez duplicate build, bez --var | Artifact niedostępny dla deploy job jeśli conditional upload nie pasuje do warunków download |
| 4. End-to-end verification | Potwierdzony live URL i działające flows | Niezgodna nazwa projektu CF — wrangler nie wie gdzie deployować |

**Prerequisites:** Dostęp do Cloudflare dashboard, dostęp do GitHub repo Settings  
**Estimated effort:** ~1 sesja: 15-20 min manual config (fazy 1-2) + 10 min code change (faza 3) + weryfikacja

## Open Risks & Assumptions

- KV namespace `SESSION` z ID `a51fc8a99e704debba9a14962f8d7310` zakładamy, że istnieje w CF — jeśli projekt jest nowy lub KV namespace został usunięty, wrangler zafailuje; weryfikacja: CF dashboard → KV → szukaj namespace z tym ID
- `SUPABASE_URL` i `SUPABASE_KEY` zakładamy, że są już w GitHub Secrets (CI build je referencuje); jeśli nie — dodać w fazie 1
- CF API token potrzebuje dokładnie scope `Workers Scripts: Edit`; szerszy (API token ogólny) też zadziała, ale węższy nie

## Success Criteria (Summary)

- GitHub Actions pokazuje `ci` + `deploy` zielone po push do `master`
- Live URL serwuje aplikację i generowanie planu treningowego działa
- Żaden sekret aplikacji nie jest widoczny jako plain-text binding w CF dashboard
