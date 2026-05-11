# Gainvest

Application de suivi d'investissements personnels — bourse en premier, crypto et immobilier à terme.

## Stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** + **design tokens DTCG** + **Storybook**
- **Supabase** (Postgres + Auth, local via Docker + prod sur Cloud)
- **PWA** (installable desktop + mobile)

## Prérequis

- Node 22+, pnpm 10+
- Docker Desktop (utilisé par la CLI Supabase pour la stack locale)
- Supabase CLI : `brew install supabase/tap/supabase`

## Démarrage

```bash
pnpm install
pnpm db:start        # lance Postgres + Auth + Studio en local (Docker)
cp .env.local.example .env.local    # déjà rempli pour pointer local
pnpm dev             # http://localhost:3000
```

Le Studio Supabase est sur http://127.0.0.1:54323 (auth, tables, SQL editor).

## Scripts

```bash
# App
pnpm dev             # serveur de dev (régénère les tokens automatiquement)
pnpm build           # build de prod
pnpm typecheck       # tsc --noEmit
pnpm lint            # eslint
pnpm format          # prettier --write .
pnpm storybook       # Storybook sur :6006
pnpm build:tokens    # régénère src/styles/tokens.generated.css

# Base de données (Supabase CLI)
pnpm db:start        # supabase start (lance Docker)
pnpm db:stop         # supabase stop
pnpm db:status       # supabase status
pnpm db:studio       # ouvre Supabase Studio (local)
pnpm db:reset        # reset complet + ré-applique les migrations
pnpm db:diff -- <name>   # génère une migration depuis l'état actuel
pnpm db:push         # applique les migrations sur Cloud (prod)
pnpm db:types        # régénère src/lib/supabase/types.ts depuis le schéma local
```

## Workflow base de données

Les migrations vivent dans `supabase/migrations/<timestamp>_<name>.sql`. La DB locale les applique automatiquement à `supabase start` et à `supabase db reset`.

Pour ajouter une migration :

1. Modifier le schéma directement via le Studio local (`pnpm db:studio`)
2. `pnpm db:diff -- add_xxx` génère le fichier `supabase/migrations/...add_xxx.sql`
3. Tester en local : `pnpm db:reset` (re-applique tout depuis zéro)
4. `pnpm db:types` régénère `src/lib/supabase/types.ts`
5. Commit les deux fichiers (migration + types)
6. `pnpm db:push` déploie sur Cloud (Supabase Cloud → projet `gainvest`)

## Design tokens

Trois niveaux DTCG dans `tokens/` :

1. **Primitives** — `tokens/primitive.tokens.json` : palette + radii bruts.
2. **Sémantiques** — `tokens/semantic.{light,dark}.tokens.json` : alias métier.
3. **Composants** — à venir avec shadcn.

Le script `scripts/build-tokens.mjs` aplatit l'arbre, résout les références `{color.neutral.50}` et écrit `src/styles/tokens.generated.css` (`:root` light + `.dark` / `prefers-color-scheme: dark`). Ces variables sont exposées à Tailwind v4 via `@theme inline` dans `src/app/globals.css`.

Pour modifier un token : éditer le JSON, exécuter `pnpm build:tokens`, commit le `.json` ET le `.css` généré.

## Structure

```
src/
  app/                  Next.js App Router (pages, layouts, route handlers)
  components/ui/        Composants shadcn (générés)
  features/             Logique métier par domaine (portfolio, …)
  lib/
    supabase/           Clients SSR + types générés
    env.ts              Accès lazy aux env vars publiques
    utils.ts            cn() (shadcn)
  styles/               tokens.generated.css
  proxy.ts              Next.js proxy (refresh Supabase session, ex-middleware)
tokens/                 Source DTCG (JSON)
scripts/                Outillage de build
supabase/
  migrations/           SQL versionné, source de vérité du schéma
  config.toml           Config locale Supabase
```
