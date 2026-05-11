---
name: forge-lessons
description: Lessons learned from previous Forge runs on this project. Use when working in this repository to avoid known pitfalls and follow established conventions.
---

# Forge lessons learned

<!-- Auto-managed by core/learnings_generator.py; do not edit manually -->

- **[archi]** Pour les pastilles de catégorie (SupportTag), utiliser un mapping `Record<Support, string>` de classes Tailwind incluant systématiquement les variants `dark:` (bg-*-950/40, text-*-300, border-*-900) — le mode sombre est attendu et un mapping sans variante dark ressort cassé. (chemins: src/features/portfolio/components/support-tag.tsx)
- **[convention]** Dans les server actions (addOrder), valider tout champ enum-like en testant `SUPPORTS.includes(raw as Support)` avant le cast et retourner `{ ok: false, error }` en français — le défaut implicite est 'CTO' pour rester compatible avec les anciens formulaires. (chemins: src/features/portfolio/actions.ts)
- **[piège]** Les positions sont agrégées par clé composite `${isin}\x01${support}` (séparateur \x01) — toute nouvelle dimension de regroupement (compte, devise...) doit étendre cette clé et le champ `key` de Position, sinon les PRU se mélangent entre supports. (chemins: src/features/portfolio/aggregate.ts)
- **[convention]** Les valeurs littérales partagées (ex: SUPPORTS) doivent être déclarées comme `as const` dans src/features/portfolio/types.ts et dérivées en type union — éviter de retaper la liste dans les composants UI ou les server actions, importer SUPPORTS + Support à la place. (chemins: src/features/portfolio/types.ts)
- **[convention]** Pour ajouter une dimension catégorielle aux transactions (ex: support fiscal CTO/PEA/PEA-PME/AV), utiliser une colonne text + CHECK plutôt qu'un vrai enum Postgres, avec NOT NULL DEFAULT 'CTO' pour rétro-compat, et créer un index dédié car la valeur est utilisée comme clé d'agrégation côté app. (chemins: supabase/migrations/*_add_support_to_transactions.sql)
