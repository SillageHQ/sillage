# Plan d'exécution — Migration de DeepInfra vers OpenRouter

## Objectif

Supprimer toute dépendance utilisateur à DeepInfra et faire fonctionner les appels IA du produit avec une seule clé OpenRouter appartenant à chaque utilisateur.

Le backend continue d'héberger PostgreSQL, pgvector, Neo4j, Graphiti, les workers et les index. La clé OpenRouter de l'utilisateur paie et autorise les chat completions, embeddings et rerankings.

## Expérience utilisateur finale

1. L'utilisateur clique sur **Connecter OpenRouter**.
2. OpenRouter l'authentifie via OAuth PKCE et crée une clé contrôlée par l'utilisateur.
3. Le backend chiffre la clé avant persistance.
4. L'application vérifie le crédit et les modèles requis.
5. L'utilisateur choisit son modèle conversationnel parmi une liste compatible.
6. Les modèles d'embedding et de reranking restent fixes pour protéger la cohérence des index.
7. L'utilisateur peut déconnecter OpenRouter et supprimer la clé à tout moment.

L'utilisateur ne doit jamais fournir de clé DeepInfra, OpenAI, Cohere ou autre fournisseur IA.

## Architecture cible

```text
Desktop / Web
    │ OAuth PKCE
    ▼
API TypeScript
    ├─ utilisateurs et sessions
    ├─ coffre chiffré des clés OpenRouter
    ├─ AI Gateway interne
    └─ suivi usage et erreurs
              │
              ▼
       OpenRouter API
       ├─ /chat/completions
       ├─ /embeddings
       └─ /rerank

Service mémoire Python
    │ userId + jeton de service interne
    ▼
AI Gateway interne
    │ déchiffre la clé au dernier moment
    ▼
OpenRouter
```

Le service Python ne reçoit, ne stocke et ne journalise jamais la clé OpenRouter brute.

## Décisions techniques

- Utiliser OAuth PKCE S256 pour connecter OpenRouter.
- Autoriser temporairement le collage manuel d'une clé uniquement comme solution de secours administrateur.
- Stocker chaque clé avec chiffrement d'enveloppe AES-256-GCM et une clé maître KMS.
- Centraliser tous les appels OpenRouter dans un AI Gateway interne appartenant à l'API TypeScript.
- Authentifier le service Python auprès du gateway avec un jeton interne rotatif.
- Propager `userId` dans chaque requête, job, document, chunk, conversation et opération Neo4j.
- Utiliser `openai/text-embedding-3-small` avec `dimensions: 1024` pour l'index documentaire initial.
- Utiliser `cohere/rerank-v3.5` via `/rerank` pour le reranking initial.
- Utiliser `openai/gpt-5.2` comme modèle conversationnel et d'extraction initial, tout en permettant un modèle conversationnel différent par utilisateur.
- Garder embedding et reranking contrôlés par l'application, non modifiables depuis l'interface standard.
- Ajouter `HTTP-Referer` et `X-Title` à tous les appels OpenRouter.
- Ne jamais mélanger des embeddings produits par deux modèles ou versions différents.
- Recréer les index dérivés depuis les notes Obsidian lors du changement de modèle.
- Conserver le lexical et les données déjà synchronisées si OpenRouter est indisponible.

## Critères globaux d'acceptation

- Aucun chemin de production ne lit `DEEPINFRA_API_KEY`.
- Une seule connexion OpenRouter permet chat, extraction, embeddings et reranking.
- Aucune clé brute n'apparaît dans PostgreSQL, les logs, les traces, les erreurs ou les outils d'administration.
- Toutes les ressources sont isolées par `userId`.
- Une clé expirée ou sans crédit produit un état actionnable sans perte de données.
- Les jobs reprennent automatiquement après reconnexion.
- Les embeddings OpenRouter atteignent ou dépassent la baseline de retrieval actuelle.
- Le rollback vers l'ancien fournisseur reste possible pendant la migration, puis est retiré.

---

## Phase 0 — Préparer le multi-utilisateur

Le dépôt est actuellement mono-utilisateur. Cette phase est obligatoire avant de stocker une clé par utilisateur.

### Modèles PostgreSQL à ajouter

```text
User
  id
  email
  createdAt
  updatedAt

AiCredential
  id
  userId
  provider
  encryptedKey
  nonce
  authTag
  wrappedDataKey
  keyFingerprint
  keyLastFour
  status
  connectedAt
  lastValidatedAt
  revokedAt

AiConfiguration
  userId
  chatModel
  extractionModel
  embeddingModel
  embeddingDimensions
  embeddingVersion
  rerankModel
  updatedAt

AiJob
  id
  userId
  kind
  status
  attempts
  availableAt
  errorCode
  createdAt
  updatedAt
```

### Étapes

1. Ajouter l'authentification produit et le modèle `User`.
2. Ajouter `userId` à toutes les tables appartenant à un utilisateur.
3. Remplacer les contraintes uniques globales par des contraintes composites par utilisateur.
4. Ajouter `userId` ou `groupId` aux nœuds et relations Neo4j.
5. Propager l'identité authentifiée jusqu'au service mémoire.
6. Migrer les données mono-utilisateur vers un utilisateur propriétaire initial.

### TODO

- [ ] Créer `User`, `AiCredential`, `AiConfiguration` et `AiJob` dans Prisma.
- [ ] Ajouter `userId` à Folder, Conversation, Message, Settings, VaultDocument, VaultChunk, CaptureJob, VaultDraft, NoteChange et consolidation.
- [ ] Remplacer `VaultDocument.path @unique` par `@@unique([userId, path])`.
- [ ] Inclure `userId` dans les identifiants stables de documents et chunks.
- [ ] Ajouter des index PostgreSQL commençant par `userId` pour les chemins de recherche fréquents.
- [ ] Remplacer la ligne Settings globale par une ligne Settings par utilisateur.
- [ ] Ajouter `userId` à chaque requête Cypher et chaque objet Graphiti.
- [ ] Créer une migration de backfill vers l'utilisateur propriétaire initial.
- [ ] Ajouter des tests d'isolation croisée PostgreSQL, RAG, conversations et Neo4j.
- [ ] Refuser toute requête interne dépourvue de `userId`.

### Terminé lorsque

Deux utilisateurs de test peuvent posséder le même chemin de note et poser la même question sans voir les données l'un de l'autre.

---

## Phase 1 — Construire le coffre de clés

### Flux de chiffrement

```text
Clé OpenRouter brute
    │
    ├─ générer une data key aléatoire
    ├─ chiffrer avec AES-256-GCM
    ├─ envelopper la data key avec KMS
    └─ effacer les buffers temporaires

PostgreSQL reçoit uniquement :
encryptedKey + nonce + authTag + wrappedDataKey + fingerprint
```

### TODO

- [ ] Créer le service `CredentialVault` dans l'API TypeScript.
- [ ] Configurer une clé KMS distincte par environnement.
- [ ] Implémenter chiffrement, déchiffrement, rotation et suppression.
- [ ] Calculer un fingerprint HMAC non réversible pour détecter les doublons.
- [ ] Ne conserver que les quatre derniers caractères pour l'affichage.
- [ ] Marquer la valeur brute comme donnée sensible dans le système de logs.
- [ ] Ajouter une rotation de clé KMS sans demander une nouvelle clé OpenRouter.
- [ ] Ajouter un audit `credential_connected`, `credential_rotated`, `credential_revoked` sans secret.
- [ ] Interdire l'accès aux colonnes chiffrées depuis les endpoints publics.
- [ ] Ajouter des tests prouvant que clés, headers Authorization et réponses OAuth sont expurgés.
- [ ] Documenter la procédure de compromission et révocation.

### Terminé lorsque

Une clé peut être enregistrée, utilisée, tournée et supprimée sans apparaître en clair hors de la mémoire du processus autorisé.

---

## Phase 2 — Ajouter la connexion OAuth PKCE

### Flux

```text
GET /auth/openrouter/start
  → génération code_verifier + state
  → code_challenge S256
  → redirection https://openrouter.ai/auth

GET /auth/openrouter/callback
  → validation state
  → échange code + verifier contre une clé
  → validation de la clé
  → chiffrement et persistance
  → suppression code et verifier
```

### TODO

- [ ] Ajouter `/auth/openrouter/start`.
- [ ] Générer `state` et `code_verifier` cryptographiquement aléatoires.
- [ ] Stocker l'état PKCE avec expiration courte et usage unique.
- [ ] Utiliser exclusivement `code_challenge_method=S256`.
- [ ] Ajouter `/auth/openrouter/callback` et vérifier strictement `state`.
- [ ] Échanger le code via `https://openrouter.ai/api/v1/auth/keys`.
- [ ] Valider la clé via `GET /api/v1/key` avant persistance.
- [ ] Ajouter le bouton **Connecter OpenRouter** dans les réglages.
- [ ] Afficher connexion, suffixe de clé, crédit disponible et dernière validation.
- [ ] Ajouter **Reconnecter** et **Déconnecter**.
- [ ] Supprimer la clé locale et serveur lors de la déconnexion.
- [ ] Ajouter un fallback de saisie manuelle réservé aux environnements de développement.
- [ ] Tester callback web, callback Tauri et tentative de rejeu OAuth.

### Terminé lorsque

Un utilisateur connecte OpenRouter en un clic sans copier-coller de secret et peut révoquer la connexion depuis l'application.

---

## Phase 3 — Créer l'AI Gateway interne

### Responsabilités

- Authentifier le service appelant.
- Vérifier `userId` et l'autorisation d'agir pour cet utilisateur.
- Charger et déchiffrer la clé au dernier moment.
- Appliquer modèle autorisé, limites, timeout et routing fournisseur.
- Ajouter les headers OpenRouter de l'application.
- Expurger les logs et normaliser les erreurs.
- Mesurer tokens, coût, latence et modèle réellement servi.

### Endpoints internes

```text
POST /internal/ai/chat/completions
POST /internal/ai/embeddings
POST /internal/ai/rerank
GET  /internal/ai/status/:userId
```

### TODO

- [ ] Protéger les endpoints avec mTLS ou un jeton de service rotatif et une restriction réseau.
- [ ] Exiger `userId`, `purpose` et `requestId`.
- [ ] Ajouter les purposes autorisés : chat, extraction, consolidation, capture, resurface, query expansion, embedding et rerank.
- [ ] Construire une allowlist de modèles par purpose.
- [ ] Implémenter le proxy OpenRouter chat compatible OpenAI, y compris le streaming SSE.
- [ ] Implémenter le proxy `/embeddings` avec batch et `dimensions: 1024`.
- [ ] Implémenter le proxy `/rerank` avec `top_n` borné.
- [ ] Ajouter `HTTP-Referer` et `X-Title`.
- [ ] Ajouter timeout, retry avec jitter et respect de `Retry-After`.
- [ ] Ne pas retry les erreurs 400, 401, 402 et 403.
- [ ] Ajouter circuit breaker par utilisateur et endpoint.
- [ ] Normaliser `invalid_key`, `insufficient_credits`, `rate_limited`, `model_unavailable` et `provider_error`.
- [ ] Stocker l'usage agrégé sans prompt ni document brut.
- [ ] Ajouter des tests contractuels contre l'API OpenRouter simulée.

### Terminé lorsque

Le service mémoire peut utiliser chat, embeddings et reranking pour un utilisateur sans recevoir sa clé brute.

---

## Phase 4 — Refactorer le service mémoire et Graphiti

### Problème actuel

`services/memory/graph.py` construit un singleton global depuis `DEEPINFRA_API_KEY`. Cette approche ne peut pas isoler les utilisateurs.

### Architecture cible

```text
RequestContext
  user_id
  conversation_id
  request_id

GraphService
  driver partagé
  clients IA request-scoped vers AI Gateway
  namespace graphe par user_id
```

### TODO

- [ ] Remplacer `build_graphiti()` sans arguments par `build_graphiti(context, ai_client)`.
- [ ] Remplacer `app.state.graphiti` global par un service créant des clients légers par requête.
- [ ] Garder les pools Neo4j et HTTP partagés, sans partager l'identité utilisateur.
- [ ] Créer un client OpenAI-compatible pointant vers l'AI Gateway interne.
- [ ] Remplacer `OpenAIRerankerClient` par un client dédié utilisant `/internal/ai/rerank`.
- [ ] Propager `userId` dans `_facts_for`, `_chunks_for`, `_hybrid_recall`, ingestion, suppression et resurfacing.
- [ ] Ajouter le namespace utilisateur à toutes les recherches Graphiti.
- [ ] Ajouter `userId` à toutes les routes internes appelées par l'API TypeScript.
- [ ] Supprimer `DEFAULT_USER_ID = local` des chemins de production.
- [ ] Ajouter des pools et caches bornés pour éviter un client permanent par utilisateur.
- [ ] Ajouter des tests concurrents avec deux clés OpenRouter simulées.

### Terminé lorsque

Deux requêtes simultanées utilisent les bonnes clés, les bons graphes et les bons index sans état global partagé.

---

## Phase 5 — Migrer chaque usage DeepInfra

### Chat et réponses

- [ ] Migrer `/ask/stream` vers `/internal/ai/chat/completions`.
- [ ] Conserver tool calling, JSON strict, streaming et gestion des pièces jointes.
- [ ] Ajouter modèle réellement utilisé et coût aux métadonnées internes.

### Extraction Graphiti

- [ ] Migrer extraction d'entités et relations vers le modèle OpenRouter d'extraction.
- [ ] Vérifier la compatibilité JSON Schema stricte.
- [ ] Tester créations, corrections, suppressions et faits temporels.

### Embeddings

- [ ] Migrer batch documentaire et embedding des requêtes vers `/internal/ai/embeddings`.
- [ ] Fixer modèle `openai/text-embedding-3-small` et dimension 1024.
- [ ] Ajouter `input_type` lorsque le modèle le supporte.
- [ ] Stocker modèle, dimension et version avec chaque index.

### Reranking

- [ ] Migrer vers `/internal/ai/rerank` avec `cohere/rerank-v3.5`.
- [ ] Borner à 30 documents et appliquer un timeout court.
- [ ] Conserver Weighted RRF en fallback.

### Consolidation, capture et resurfacing

- [ ] Migrer génération de brouillons et consolidation.
- [ ] Migrer résumés de capture URL et transcript existant.
- [ ] Migrer rappels de resurfacing.
- [ ] Conserver AssemblyAI comme service interne de transcription tant qu'OpenRouter ne couvre pas ce besoin de manière validée ; aucune clé AssemblyAI n'est demandée à l'utilisateur.

### Scripts et outils de développement

- [ ] Migrer `ingest.py`, `recall.py`, `answer.py`, `chat.py`, `resurface.py` et l'évaluation.
- [ ] Exiger un `userId` et une session de développement au lieu de `DEEPINFRA_API_KEY`.
- [ ] Fournir une clé OpenRouter de test uniquement via le coffre local de développement.

### Terminé lorsque

Tous les usages auparavant servis par DeepInfra passent par le gateway OpenRouter avec la clé du bon utilisateur.

---

## Phase 6 — Versionner et reconstruire les index

Un embedding Qwen/DeepInfra et un embedding OpenRouter ne doivent jamais être comparés, même s'ils possèdent tous deux 1024 dimensions.

### Étapes

1. Créer une nouvelle version d'index par utilisateur.
2. Continuer à servir l'ancien index pendant la reconstruction.
3. Réembeder tous les chunks canoniques avec OpenRouter.
4. Reconstruire les embeddings et faits dérivés Graphiti depuis Obsidian.
5. Exécuter le benchmark et les vérifications de couverture.
6. Basculer atomiquement l'utilisateur vers la nouvelle version.
7. Conserver l'ancien index durant la fenêtre de rollback.

### TODO

- [ ] Ajouter `indexVersion`, `embeddingModel` et `embeddingDimensions` à VaultDocument/VaultChunk.
- [ ] Ajouter un état `pending`, `building`, `ready`, `active`, `failed`, `retired`.
- [ ] Créer un job de réindexation idempotent par utilisateur.
- [ ] Dédupliquer les embeddings par `userId + model + embeddingTextHash`.
- [ ] Limiter batch, concurrence et dépense OpenRouter.
- [ ] Afficher notes, chunks, progression, coût et erreurs dans l'interface.
- [ ] Permettre pause et reprise sans recommencer les chunks terminés.
- [ ] Vérifier le nombre de documents et chunks avant activation.
- [ ] Exécuter Recall@5, MRR et ouverture des citations sur la nouvelle version.
- [ ] Basculer `activeIndexVersion` dans une transaction.
- [ ] Supprimer l'ancienne version uniquement après expiration du rollback.

### Terminé lorsque

Aucun résultat de recherche ne mélange les deux espaces vectoriels et chaque utilisateur possède une version OpenRouter active complète.

---

## Phase 7 — Gérer crédit, erreurs et mode dégradé

### États utilisateur

```text
connected
invalid_key
insufficient_credits
rate_limited
model_unavailable
disconnected
```

### Comportement dégradé

```text
OpenRouter disponible
  → BM25 + vectoriel + graphe + expansion + reranking + génération

OpenRouter indisponible
  → synchronisation des notes + BM25 + index déjà calculés
  → jobs IA en attente
  → aucune perte de données
```

### TODO

- [ ] Mapper les erreurs OpenRouter vers les états produit.
- [ ] Remplacer les messages DeepInfra par des messages OpenRouter actionnables.
- [ ] Ajouter **Ajouter des crédits**, **Reconnecter** et **Réessayer**.
- [ ] Mettre les jobs en `waiting_for_credentials` ou `waiting_for_credits`.
- [ ] Reprendre automatiquement après validation réussie de la clé.
- [ ] Conserver le lexical disponible sans clé.
- [ ] Ne jamais supprimer un index actif après une erreur de réindexation.
- [ ] Ajouter une limite de concurrence et de dépense pour l'indexation initiale.
- [ ] Afficher une estimation avant l'indexation complète du vault.
- [ ] Ajouter des tests 401, 402, 429, timeout, modèle indisponible et réponse invalide.

### Terminé lorsque

Une panne ou absence de crédit ne bloque pas l'accès aux données et l'utilisateur comprend exactement l'action à effectuer.

---

## Phase 8 — Sécurité et conformité

### TODO

- [ ] Réaliser une threat model dédiée aux clés OpenRouter et données du vault.
- [ ] Vérifier SSRF, injection de prompt, confusion d'utilisateur et escalade interne.
- [ ] Interdire les clés OpenRouter dans URLs, query params, analytics et crash reports.
- [ ] Expurger les headers Authorization dans tous les proxies et outils APM.
- [ ] Chiffrer les sauvegardes contenant `AiCredential`.
- [ ] Journaliser uniquement fingerprint, userId, purpose et résultat.
- [ ] Ajouter rotation et révocation d'urgence.
- [ ] Ajouter suppression complète de clé, index, graphe, jobs et caches lors de la suppression du compte.
- [ ] Tester les accès administrateur et appliquer le moindre privilège.
- [ ] Ajouter une politique de rétention des prompts et contenus transmis à OpenRouter.
- [ ] Exposer clairement les modèles et fournisseurs susceptibles de traiter les données.
- [ ] Ajouter un test automatisé de secret scanning dans la CI.

### Terminé lorsque

La clé et les données d'un utilisateur ne sont accessibles qu'aux chemins nécessaires, auditables et révocables.

---

## Phase 9 — Validation et déploiement progressif

### Étapes

1. Ajouter un provider abstrait `deepinfra | openrouter` derrière feature flag.
2. Tester OpenRouter avec l'utilisateur propriétaire interne.
3. Comparer en shadow mode réponses structurées, retrieval, latence et coût.
4. Activer OpenRouter pour les nouveaux utilisateurs.
5. Migrer les utilisateurs existants après connexion OpenRouter et réindexation.
6. Passer successivement à 5 %, 25 %, 50 % et 100 %.
7. Retirer DeepInfra après deux versions stables.

### TODO

- [ ] Ajouter `AI_PROVIDER=openrouter` et un override par utilisateur pendant la migration.
- [ ] Ajouter des tests contractuels chat, embedding et rerank.
- [ ] Exécuter toute la suite RAG et consolidation avec OpenRouter.
- [ ] Tester tool calling et JSON Schema sur le modèle d'extraction.
- [ ] Vérifier qualité des embeddings avant activation.
- [ ] Comparer latence, erreurs et coût par purpose.
- [ ] Ajouter un dashboard du taux de connexion et de migration.
- [ ] Ajouter un rollback atomique vers l'ancien index et fournisseur.
- [ ] Arrêter les nouvelles indexations DeepInfra après 100 % de migration.
- [ ] Retirer le feature flag après deux versions stables.

### Terminé lorsque

Tous les utilisateurs actifs sont sur OpenRouter, les métriques sont stables et le rollback n'est plus nécessaire.

---

## Phase 10 — Nettoyage définitif de DeepInfra

### TODO

- [ ] Supprimer `DEEPINFRA_API_KEY` de tous les environnements et secrets CI/CD.
- [ ] Supprimer `DEEPINFRA_BASE` et les imports associés.
- [ ] Supprimer tous les messages d'erreur et liens de facturation DeepInfra.
- [ ] Supprimer les chemins provider DeepInfra du code.
- [ ] Mettre à jour `services/memory/TASKS.md`, README et documentation de déploiement.
- [ ] Régénérer ou révoquer les anciennes clés DeepInfra.
- [ ] Vérifier avec `rg -i "deepinfra|DEEPINFRA_API_KEY"` qu'aucune référence active ne subsiste.
- [ ] Conserver uniquement une note historique de migration dans le changelog.
- [ ] Supprimer les anciens index après la période de rollback.
- [ ] Vérifier les factures DeepInfra et fermer les ressources devenues inutiles.

## Checklist finale

- [ ] Modèle utilisateur et isolation multi-tenant terminés.
- [ ] Coffre de clés chiffré avec KMS.
- [ ] OAuth OpenRouter PKCE S256 opérationnel.
- [ ] AI Gateway interne opérationnel.
- [ ] Service mémoire sans clé brute.
- [ ] Chat, extraction, embedding et reranking migrés.
- [ ] Consolidation, capture et resurfacing migrés.
- [ ] Index OpenRouter reconstruits et versionnés.
- [ ] États de crédit et mode dégradé validés.
- [ ] Tests de sécurité et isolation validés.
- [ ] Déploiement progressif terminé.
- [ ] Toutes les clés DeepInfra révoquées.
- [ ] Toutes les références actives à DeepInfra supprimées.
- [ ] L'utilisateur n'a besoin que de sa connexion OpenRouter.
