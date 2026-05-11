# Gainvest

Application de suivi d'investissements personnels — bourse en premier, crypto et immobilier à terme.

## Stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** + **design tokens DTCG** + **Storybook**
- **Supabase** (Postgres + Auth)
- **PWA** (installable desktop + mobile)

## Scripts

```bash
pnpm dev            # serveur de dev (régénère les tokens automatiquement)
pnpm build          # build de prod (régénère les tokens automatiquement)
pnpm start          # serveur de prod
pnpm lint           # eslint
pnpm typecheck      # tsc --noEmit
pnpm format         # prettier --write .
pnpm build:tokens   # régénère src/styles/tokens.generated.css depuis tokens/*.tokens.json
```

## Design tokens

Trois niveaux DTCG dans `tokens/` :

1. **Primitives** — `tokens/primitive.tokens.json` : palette + radii bruts (`color.neutral.50`, `radius.md`).
2. **Sémantiques** — `tokens/semantic.{light,dark}.tokens.json` : alias métier (`color.semantic.primary`, `color.semantic.success`).
3. **Composants** — à venir avec shadcn (`button.primary.bg`, …).

Le script `scripts/build-tokens.mjs` aplatit l'arbre, résout les références `{color.neutral.50}` et écrit `src/styles/tokens.generated.css` (un bloc `:root` pour le light, un bloc `.dark` + `@media (prefers-color-scheme: dark)` pour le dark). Ces variables sont ensuite exposées à Tailwind v4 via `@theme inline` dans `src/app/globals.css`.

Pour ajouter / modifier un token : éditer le JSON, exécuter `pnpm build:tokens`, commit le `.json` ET le `.css` généré.

## Structure

```
src/
  app/                Next.js App Router (pages, layouts, route handlers)
  components/ui/      Composants shadcn (générés)
  features/           Logique métier par domaine (portfolio, …)
  lib/                Utilitaires partagés (clients API, helpers)
  styles/             tokens.generated.css
tokens/               Source DTCG (JSON)
scripts/              Outillage de build
```
