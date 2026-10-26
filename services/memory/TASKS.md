# Second Brain — Tâches

## ✅ Fait

### Moteur
- Graphiti (graphe temporel épisode/sémantique) sur Neo4j
- Stack 100% cloud, 1 vendor DeepInfra : LLM `DeepSeek-V4-Pro` (extraction) + `DeepSeek-V4-Flash` (synthèse) + embeddings `Qwen3-Embedding-8B` (1024d)
- Ingestion vault Obsidian, parallèle (gather borné), property-folding (notes database à corps vide)
- Mémoire épisodique (conversations stockées comme épisodes datés)
- Resurfacing spaced-repetition (saillance = connectivité × retard, feedback SM-2)

### API (FastAPI)
- `/ask` + `/ask/stream` (SSE token par token)
- `/ingest/note` (dedup : remplace l'épisode existant)
- `DELETE /note` (supprime épisode + entités orphelines)
- `/resurface` + `/resurface/review`
- `/health`

### App (Tauri 2, React/TS)
- Chat streaming + rendu markdown
- Vue Révision (resurfacing + feedback)
- Composer multiligne, bouton Effacer
- Ton naturel (mêle savoir + notes, signale les notes)
- Agent menu-bar : tray + statut live (À l'écoute / Sync X/Y / À jour)
- Watcher vault : create/modify → sync, delete → oublie
- Sync initiale 1er lancement (barre de progression tray, parallèle)

## ⏳ À faire

### Court terme
- ✅ **Identité par hash de contenu + chemin** (fait). `content_hash` (SHA-256 du fichier brut) + `path` sur chaque épisode, indexés Neo4j :
  - re-save contenu identique → `skipped:unchanged`, zéro extraction
  - move (même contenu, autre dossier) → `moved`, relink du `path`, zéro extraction (vérifié 0.28s)
  - contenu changé → replace l'épisode au même `path` + ré-extrait (pas de doublon)
  - watcher : creates traités AVANT removes → le remove d'un move devient no-op
  - `content_hash`/`path` posés aussi dans ingest.py (bulk) et `delete` par path
  - identité = path → collisions de titres entre dossiers réglées ; legacy (sans path) migrés lazy au 1er edit
- ✅ **Settings UI : chemin vault configurable** (fait). Le chemin du vault est exposé dans l’UI, validé côté API et relu par le watcher.
- Aligner le ton des CLI (chat.py/answer.py) sur l'API

### Produit
- ✅ **Persistance conversations/users → PostgreSQL** (fait). Monorepo pnpm: API TS (Hono+Prisma, :3001) devant, moteur Python (Graphiti, :8000) derrière. Convos/messages en Postgres (:5433), plus de localStorage. Split: Neo4j=mémoire graphe, Postgres=users/conversations/sessions, DeepInfra=LLM.
- Déploiement cloud (Coolify + Neo4j + Postgres containers)
- Auth + multi-users
- Interface v2 (feedback #2)
- Outils agent / tool-calling (feedback #3) : ✅ `cite_note`, ✅ `search_notes`, ✅ `create_note`, ✅ `update_note`, ✅ deep-links `obsidian://`, layout type Codex (conversations à gauche), ✅ `open_conversation` (bouton de switch conversation)
- **Outils agent vault** :
  - ✅ `read_note` (fait) : le bot lit une note du vault si le user le demande
  - ✅ `create_note` (fait) : le bot crée une note du vault si le user le demande explicitement
  - ✅ `update_note` (fait) : le bot ajoute/remplace le contenu d'une note existante du vault si le user le demande explicitement (round-trip fichier, re-ingest auto via watcher)
  - ✅ `open_user_note` (fait) : résout la note pour ouvrir dans Obsidian (`obsidian://open?vault=…&file=…`)
  - ✅ `show_open_note_button` (fait) : affiche un bouton dans le chat pour ouvrir la note dans Obsidian
- ✅ **`@` mention de notes du vault** (fait). Autocomplétion `/notes` dans le composer (chips), notes pointées injectées en contexte forcé via `mentions[]` dans `/ask`.
- **Capture externe → note Obsidian** : ingérer du contenu externe, l'IA en extrait/résume les idées, puis enregistre dans le vault (→ pris en charge par le watcher → ingéré dans le graphe).
  - Sources : article de blog (URL), thread X/Twitter, vidéo YouTube (transcript), fichier podcast Patreon (audio).
  - Extraction : readability pour blog, API/scrape pour X, transcript YouTube, transcription audio (whisper) pour podcast.
  - Résumé : l'IA résume les idées, avec un **slider de degré de résumé** (de quasi-verbatim → très condensé).
  - **Mode de découpage** (choix user) :
    1. une seule note
    2. une note par notion (split par sujet)
    3. **fusion sémantique** : ajoute le contenu dans les notes existantes qui matchent, crée une note pour les notions sans correspondance.
       - ex : podcast socialisme vs capitalisme → 2 notes distinctes ; si « capitalisme » existe déjà mais pas « socialisme » → append dans capitalisme + crée socialisme.
       - routing : embed chaque notion (Qwen), match vs embeddings des notes existantes, seuil → append / create. Réutilise `update_note` + identité content-hash.

### Qualité / perf
- **Exploiter les liens Obsidian comme structure explicite** (actuellement ignorés, on s'appuie 100% sur l'inférence LLM). Parser à l'ingestion :
  - `[[Note]]` → arête explicite note↔note (relation certaine, pas inférée)
  - `#tag` → entité/catégorie structurée
  - mentions de pages → liens
  - objectif : fusionner la structure curée à la main (fiable) + l'inférence LLM (riche). Via entity types custom Graphiti + parsing pré-ingestion.
- Optim extraction : prompts orientés documents (vs conversationnels par défaut)
- Latence synthèse : host rapide (Groq/Cerebras) si besoin <2s
- Indexer fichiers `.base` (structure des databases Obsidian)
- **Ingestion des images du vault** : indexer les images stockées dans Obsidian (pièces jointes). Via modèle vision (caption/description + OCR) → injecter dans le graphe, lier à la note qui les référence. Permet de questionner le contenu visuel.
- Daemon resurfacing (notifs auto vs run manuel)

## 🔒 Sécu
- Régénérer la clé DeepInfra (exposée en dev), remplacer dans `.env`
