# Sillage

Sillage est une application desktop Tauri/React qui fournit une couche de mémoire contextuelle pour Obsidian, avec une API TypeScript et un service mémoire Python.

## Tech stack

- Monorepo pnpm.
- Desktop : React, TypeScript, Vite, Tauri et Lingui.
- API : TypeScript, Prisma et PostgreSQL.
- Mémoire : Python.

## Commands

- `pnpm dev` — démarre les services mémoire, API et desktop.
- `pnpm --filter @sb/desktop build` — typecheck et build desktop.
- `pnpm --filter @sb/desktop test` — tests Vitest desktop.
- `pnpm landing:build` — build de l’application landing.
- `pnpm docker:up` — démarre les dépendances Docker.

## Important files

- `apps/desktop/src/App.tsx` — orchestration de l’application desktop uniquement.
- `apps/desktop/src/components/` — composants UI réutilisables et domaines fonctionnels desktop.
- `apps/desktop/src/lib/api.ts` — client et configuration d’accès API.
- `services/api/prisma/schema.prisma` — modèle de données API.

## Rules

- **CRITICAL** : `App.tsx` reste un shell d’orchestration et doit être maintenu sous 800 lignes. Les vues, modales, panneaux et composants doivent vivre dans `components/` ou dans un module de domaine dédié.
- **CRITICAL** : aucun nouveau fichier `.ts`/`.tsx` ne doit dépasser 800 lignes.
- **IMPORTANT** : dès qu’un fichier `.ts`/`.tsx` dépasse 600 lignes, le découper avant d’ajouter une nouvelle responsabilité ou fonctionnalité.
- Une fonction React ne doit gérer qu’une responsabilité UI cohérente ; extraire les sous-composants avec des props typées et explicites.
- Les types et helpers partagés doivent être dans des modules dédiés, pas dupliqués dans plusieurs composants.
- Avant de terminer une modification desktop, lancer `pnpm --filter @sb/desktop exec tsc --noEmit`, puis les tests ou le build approprié.
- Ne jamais committer de secrets, fichiers `.env`, artefacts `dist/` ou données locales générées.
- **NEVER** utiliser `rm -rf`. Pour supprimer, utiliser `trash` afin de conserver une possibilité de récupération.

## Workflow

- Pour une fonctionnalité desktop, identifier d’abord le domaine concerné, créer/choisir son module, puis connecter ce module au shell `App.tsx`.
- Pour un refactor, préserver le comportement existant et vérifier typecheck, tests et build avant livraison.
