# Plan d'exécution — Ingestion locale via abonnement Codex ou Claude Code

## Objectif

Permettre à Sillage d'utiliser l'abonnement IA déjà payé par l'utilisateur pour l'extraction de connaissances lors de l'ingestion de son vault, sans demander, lire, copier, transmettre ni stocker de clé API OpenAI ou Anthropic.

L'utilisateur installe et authentifie Codex ou Claude Code sur son propre ordinateur. Le compagnon desktop Sillage invoque ensuite ce fournisseur localement en mode non interactif, récupère une sortie JSON strictement validée, puis envoie uniquement l'artefact d'ingestion normalisé à l'API Sillage.

La cible recommandée inclut également des embeddings et un reranking locaux. C'est la seule variante qui peut tenir la promesse suivante sans ambiguïté :

> L'ingestion du vault ne nécessite aucun secret API et n'entraîne aucune facturation API séparée par Sillage.

### État d'implémentation au 11 août 2026

Le parcours Claude Code est désormais câblé de bout en bout sans architecture applicative parallèle. Le watcher appelle toujours `/ingest/note`, l'API crée toujours le même `NoteIngestionJob`, et le service mémoire conserve la même orchestration de conversation, de tools, de recall, de citations, d'actions et de persistance. Une file tenant-scoped délègue seulement les calculs de modèle au desktop lorsque `claude-code` est sélectionné.

Le même choix est proposé pendant l'onboarding avant la première indexation. En mode Claude Code, la connexion locale couvre l'ingestion et les conversations ; OpenRouter n'est ni requis ni appelé. L'utilisateur choisit séparément le modèle conversationnel et le couple mémoire : modèle Claude d'extraction + modèle local de recherche.

Chaque artefact contient des chunks déterministes avec provenance par lignes et des vecteurs 1 024 dimensions. Le serveur valide strictement le contrat, applique épisodes, entités, mentions et relations dans FalkorDB, persiste documents et chunks dans PostgreSQL, puis seulement marque l'artefact `applied`. Les suppressions et déplacements sont propagés au graphe, au manifeste et à l'index vectoriel.

La recherche locale utilise désormais au choix `intfloat/multilingual-e5-small` ou `intfloat/multilingual-e5-base`, exécuté sur CPU via Candle. Les sorties natives de 384 ou 768 dimensions sont normalisées et complétées à 1 024 dimensions sans modifier leur similarité cosinus, afin de rester compatibles avec l'index pgvector existant. Le modèle est téléchargé une fois, mis en cache sur l'ordinateur et versionné dans chaque artefact ; aucun texte n'est envoyé à une API d'embedding.

## Résultat attendu

L'utilisateur peut choisir l'un des modes suivants :

1. **Sillage Cloud — OpenRouter** : pipeline actuel géré côté serveur.
2. **Codex local — abonnement ChatGPT** : extraction exécutée par Codex sur l'ordinateur de l'utilisateur.
3. **Claude Code local — abonnement Claude** : extraction exécutée par Claude Code sur l'ordinateur de l'utilisateur.
4. **Modèle entièrement local** : futur fournisseur optionnel utilisant un modèle local sans abonnement distant.

En mode abonnement local :

- Sillage ne demande aucune clé API OpenAI ou Anthropic ;
- l'authentification reste gérée par le CLI officiel du fournisseur ;
- Sillage ne lit jamais les fichiers ou entrées de trousseau contenant les credentials ;
- la note est traitée sur l'ordinateur de l'utilisateur avant l'envoi de l'artefact ;
- le serveur valide et persiste l'artefact sans refaire l'extraction ;
- l'ingestion se met en pause lorsque le fournisseur atteint sa limite ;
- aucun basculement vers une facturation API n'est effectué sans décision explicite de l'utilisateur.

## Non-objectifs

Ce projet ne doit pas :

- transformer l'abonnement Codex ou Claude en proxy API générique côté serveur ;
- copier un token OAuth ou un fichier d'authentification vers Sillage Cloud ;
- exposer le CLI local à des requêtes provenant directement d'Internet ;
- donner au modèle des droits d'écriture sur le vault ou le poste pour une simple ingestion ;
- garantir une ingestion lorsque l'application desktop ou l'ordinateur est arrêté ;
- basculer silencieusement de l'abonnement inclus vers des crédits API payants.

---

## Architecture actuelle

Le flux actuel est entièrement piloté par le serveur après la lecture locale de la note. Le fournisseur ne change que l'exécuteur des modèles :

```text
Vault Obsidian
      │
      ▼
Watcher Tauri
      │ POST /ingest/note avec le contenu brut
      ▼
API TypeScript
      │ crée et exécute NoteIngestionJob
      ▼
Service mémoire Python
      │ orchestration commune
      ├─ OpenRouter → modèles distants
      └─ Claude Code → LocalModelTask → worker desktop Claude/E5
      │
      └─ écritures FalkorDB et PostgreSQL communes
```

Points d'entrée actuels :

- `apps/desktop/src-tauri/src/watcher.rs` lit la note et appelle `/ingest/note` ;
- `services/api/src/index.ts` déduplique, met en file et exécute le job ;
- `services/memory/api.py` gère l'idempotence, le pipeline conversationnel commun et la délégation des calculs de modèle ;
- `services/memory/graph.py` conserve l'adaptateur Graphiti/OpenRouter ; l'adaptateur Claude produit le même contrat de connaissance par une tâche locale ;
- `apps/desktop/src/App.tsx` réclame les tâches locales du tenant et les exécute via Tauri ;
- la session Claude d'une conversation est persistée côté serveur puis reprise au message suivant.

### Contrainte Graphiti

`Graphiti.add_episode()` ne correspond pas à un appel LLM unique. Graphiti orchestre plusieurs opérations structurées, consulte le graphe entre certaines opérations, calcule des embeddings et écrit le résultat.

Il n'est donc pas suffisant de remplacer `AsyncOpenAI` par une commande `codex` ou `claude` dans le service Python cloud : le serveur ne peut pas joindre un processus local situé sur l'ordinateur de l'utilisateur.

La séparation retenue doit être explicite :

- le poste local produit un artefact d'ingestion complet et versionné ;
- le serveur vérifie puis applique cet artefact de façon déterministe ;
- le chemin Graphiti historique reste disponible pour le mode OpenRouter pendant la migration.

---

## Architecture cible

```text
Vault Obsidian
      │ événement fichier
      ▼
Watcher Tauri
      │ hash + déduplication locale
      ▼
LocalIngestionWorker
      ├─ ProviderAdapter
      │    ├─ CodexAdapter
      │    └─ ClaudeCodeAdapter
      ├─ extraction JSON Schema
      ├─ chunking déterministe
      ├─ embeddings locaux
      └─ reranking local optionnel
      │
      ▼
POST /ingest/artifacts
      │ authentification Sillage normale
      ▼
API TypeScript
      ├─ validation de schéma
      ├─ validation tenant et limites
      ├─ idempotence et version de pipeline
      ├─ stockage des chunks PostgreSQL/pgvector
      └─ transmission de l'artefact graphe
      ▼
Service mémoire Python
      └─ application déterministe dans FalkorDB
```

### Principe de sécurité

Le worker local peut appeler Internet uniquement parce que le CLI officiel communique avec son fournisseur. Sillage ne reçoit jamais le credential utilisé par ce CLI.

Le serveur Sillage ne peut pas déclencher arbitrairement une commande locale. Il peut accepter un artefact envoyé par le compagnon authentifié, mais le compagnon reste seul responsable du déclenchement et des limites d'exécution.

---

## Expérience utilisateur

### Réglage principal

```text
Moteur d'ingestion

( ) Sillage Cloud
    Utilise OpenRouter. Fonctionne même lorsque cet ordinateur est éteint.

(•) Mon abonnement IA — local (bêta)
    L'ingestion s'exécute sur cet ordinateur lorsqu'il est disponible.

Fournisseur
[ Codex ▼ ]

Codex détecté · connecté avec ChatGPT
[ Tester la connexion ] [ Ouvrir Codex ]
```

### États possibles

```text
not_installed       CLI non détecté
login_required      CLI présent mais session absente ou expirée
ready               fournisseur prêt
processing          ingestion locale active
rate_limited        quota de l'abonnement atteint
provider_unavailable fournisseur indisponible ou en maintenance
invalid_output      réponse non conforme après les retries autorisés
paused_by_user      ingestion suspendue manuellement
unsupported_version version du CLI trop ancienne
```

### Messages attendus

- **CLI absent** : « Installez Codex pour utiliser votre abonnement ChatGPT. »
- **Connexion requise** : « Connectez-vous directement dans Codex. Sillage n'accède pas à vos identifiants. »
- **Quota atteint** : « L'ingestion est en pause jusqu'au renouvellement de votre quota Codex. »
- **Ordinateur hors ligne** : « Les modifications restent en attente sur cet ordinateur. »
- **Sortie invalide** : « La note n'a pas été indexée. Elle sera réessayée sans modifier votre vault. »
- **Changement de fournisseur** : « Une réindexation est nécessaire pour conserver un index cohérent. »

### Garde-fous de facturation

- Ne jamais activer automatiquement des crédits supplémentaires.
- Ne jamais injecter `OPENAI_API_KEY`, `CODEX_API_KEY` ou `ANTHROPIC_API_KEY` dans le processus.
- Avertir si une variable d'environnement API existante ferait utiliser une facturation API au lieu de l'abonnement.
- Demander à l'utilisateur de corriger lui-même l'authentification dans le CLI officiel.
- Afficher clairement que les quotas sont partagés avec son utilisation personnelle du fournisseur.

---

## Contrat de l'artefact d'ingestion

Le contrat doit être indépendant de Codex, Claude Code, Graphiti et du modèle précis. Il constitue la frontière stable entre le poste local et le cloud.

### Exemple

```json
{
  "schemaVersion": 1,
  "artifactId": "01J...",
  "tenantId": "fourni-par-la-session-et-reverifie-par-le-serveur",
  "document": {
    "path": "Projects/Sillage.md",
    "title": "Sillage",
    "folder": "Projects",
    "contentHash": "sha256:...",
    "modifiedAt": "2026-08-07T10:00:00Z"
  },
  "pipeline": {
    "provider": "codex-local",
    "providerVersion": "cli-version",
    "promptVersion": "memory-extraction-v1",
    "embeddingModel": "local/model-id",
    "embeddingDimensions": 1024
  },
  "entities": [
    {
      "localId": "entity-1",
      "name": "Sillage",
      "type": "project",
      "summary": "Application de second cerveau",
      "sourceRanges": [{ "startLine": 1, "endLine": 12 }]
    }
  ],
  "facts": [
    {
      "localId": "fact-1",
      "subjectEntityId": "entity-1",
      "predicate": "uses",
      "objectText": "Obsidian",
      "validFrom": null,
      "validUntil": null,
      "sourceRanges": [{ "startLine": 8, "endLine": 8 }],
      "confidence": 0.91
    }
  ],
  "relations": [],
  "chunks": [
    {
      "chunkId": "stable-id",
      "headingPath": ["Architecture"],
      "startLine": 20,
      "endLine": 38,
      "text": "...",
      "contentHash": "sha256:...",
      "embedding": [0.0]
    }
  ]
}
```

### Règles du contrat

- `tenantId` provenant du payload n'est jamais considéré comme une autorité ; le serveur utilise le tenant de la session.
- `artifactId` protège contre les doubles soumissions.
- `contentHash` lie l'extraction au contenu exact de la note.
- Les IDs d'entités et faits sont locaux à l'artefact et ne deviennent jamais directement des IDs de base.
- Chaque fait doit posséder au moins une provenance dans la note.
- Les lignes doivent être bornées par le nombre réel de lignes du document.
- Les embeddings doivent avoir exactement la dimension déclarée et attendue.
- Les nombres non finis, vecteurs vides, chaînes démesurées et champs inconnus sont refusés.
- Le texte source complet n'est renvoyé que lorsque nécessaire à l'index documentaire.
- Les prompts, raisonnements et transcripts fournisseur ne sont jamais inclus.
- Le schéma et la version de prompt sont versionnés séparément.

### Limites initiales

```text
Taille maximale d'une note          2 Mo
Taille maximale d'un artefact       12 Mo
Entités maximales par note          500
Faits maximaux par note             1 500
Relations maximales par note        1 500
Chunks maximaux par note            2 000
Dimensions d'embedding              1 024
Concurrence fournisseur locale      1 par défaut
Retries de sortie structurée        2
Timeout par note                    configurable, 10 min maximum
```

---

## Interface locale commune

Créer une abstraction sans dépendance à Tauri dans le cœur métier :

```text
LocalIngestionProvider
  detect() -> ProviderInstallation
  auth_status() -> ProviderAuthStatus
  healthcheck() -> ProviderHealth
  extract(request, schema, cancellation) -> StructuredExtraction
  classify_error(process_result) -> LocalProviderError
```

### Erreurs normalisées

```text
provider_not_installed
provider_login_required
provider_rate_limited
provider_usage_exhausted
provider_timeout
provider_cancelled
provider_invalid_output
provider_process_failed
provider_unsupported_version
provider_billing_mode_unsafe
provider_unknown_error
```

Chaque erreur doit indiquer :

- si elle est retryable ;
- le délai conseillé avant retry ;
- l'action utilisateur éventuelle ;
- un message expurgé ;
- le fournisseur et sa version ;
- aucun contenu de note ni credential.

---

## Adaptateur Codex

### Invocation initiale

L'invocation exacte reste testée contre la version minimale supportée, mais doit suivre cette forme :

```bash
codex exec \
  --ephemeral \
  --ignore-user-config \
  --ignore-rules \
  --sandbox read-only \
  --skip-git-repo-check \
  --output-schema /path/to/extraction.schema.json \
  -
```

### Règles

- Utiliser une API de lancement de processus avec tableau d'arguments, jamais une commande shell concaténée.
- Envoyer instruction et note sur `stdin`.
- Utiliser un répertoire de travail vide appartenant au cache Sillage.
- Ne donner aucun accès en écriture au vault.
- Utiliser `--ephemeral` pour éviter un historique d'ingestion dans les sessions Codex.
- Utiliser `--ignore-user-config` et `--ignore-rules` pour isoler le pipeline des personnalisations utilisateur, tout en conservant l'authentification gérée par `CODEX_HOME`.
- Ne jamais passer `--dangerously-bypass-approvals-and-sandbox`.
- Capturer `stdout`, `stderr`, code de sortie, durée et taille de sortie avec des limites strictes.
- Lire uniquement la réponse finale structurée ; ne jamais envoyer les événements ou raisonnements au serveur.

### Intégration de production

Après validation du prototype CLI, évaluer le Codex SDK ou l'app-server JSON-RPC pour obtenir :

- un processus persistant ;
- l'annulation structurée ;
- des événements de progression ;
- une détection d'authentification plus fiable ;
- moins de coût de démarrage par note ;
- une compatibilité mieux versionnée que le parsing de messages CLI.

---

## Adaptateur Claude Code

### Invocation initiale

```bash
claude -p \
  --safe-mode \
  --tools "" \
  --no-session-persistence \
  --output-format json \
  --json-schema '<schema-json>'
```

### Règles

- Envoyer la note sur `stdin` et les paramètres via tableau d'arguments.
- Désactiver tous les outils pour une extraction pure.
- Utiliser `--safe-mode` afin d'ignorer skills, plugins, hooks, MCP et instructions locales.
- Ne pas utiliser `--bare` pour le mode abonnement : ce mode peut désactiver la lecture des credentials OAuth et du trousseau.
- Ne jamais utiliser `--dangerously-skip-permissions`.
- Désactiver la persistance de session.
- Refuser le démarrage si `ANTHROPIC_API_KEY` est présent et risque de provoquer une facturation API non souhaitée.
- Normaliser les erreurs de quota, login, sortie invalide et indisponibilité.

### Intégration de production

Évaluer l'Agent SDK uniquement après avoir vérifié son mode d'authentification pris en charge pour ce cas d'usage. La documentation programmatique recommande généralement une clé API ; l'utilisation de l'abonnement consommateur ne doit pas être supposée stable sans confirmation du fournisseur.

---

## Bridge Claude local et décision sur `openclaw-billing-proxy`

Le projet tiers `zacdcook/openclaw-billing-proxy` a été évalué comme référence d'architecture locale, mais ne doit pas être embarqué, forké ni reproduit dans Sillage.

### Éléments rejetés

Son fonctionnement déclaré repose notamment sur :

- la lecture ou l'extraction du token OAuth stocké par Claude Code ;
- le remplacement du token d'une application tierce par ce token OAuth ;
- l'injection d'un identifiant de facturation Claude Code ;
- la réécriture de termes, noms d'outils, propriétés et prompts système ;
- l'imitation d'une session Claude Code afin de contourner la détection Anthropic ;
- l'adaptation continue aux changements de détection du fournisseur.

Ces mécanismes contredisent directement les exigences de Sillage : ne jamais lire un credential fournisseur, ne jamais usurper une surface native et ne jamais contourner une décision de facturation ou de contrôle d'accès.

### Pattern conservé

Le seul pattern réutilisable est l'existence d'un bridge local présentant une interface stable à l'application :

```text
Sillage Desktop
      │ stdio ou socket locale privée
      ▼
SillageClaudeBridge
      ├─ état d'installation
      ├─ état d'authentification
      ├─ lancement Agent SDK
      ├─ streaming et annulation
      ├─ validation JSON Schema
      └─ normalisation des erreurs
            │
            ▼
      Agent SDK / Claude Code officiel
            │
            ▼
          Anthropic
```

Le bridge ne modifie ni l'identité du client, ni les headers de facturation, ni les empreintes de requête. Si Anthropic refuse l'usage, applique une autre catégorie de facturation ou demande une réauthentification, le bridge transmet cet état à Sillage et arrête le job.

### Transport local

Préférer, dans cet ordre :

1. un processus enfant communiquant par `stdin`/`stdout` ;
2. une Unix domain socket avec permissions utilisateur strictes ;
3. un named pipe Windows limité à l'utilisateur courant ;
4. un port loopback uniquement si les transports précédents sont impossibles, avec secret de session éphémère et protection contre les requêtes cross-origin.

Ne jamais exposer un proxy Anthropic générique sur un port local. Le bridge accepte uniquement les opérations Sillage bornées telles que `auth_status`, `healthcheck`, `extract_note` et `cancel_job`.

### OAuth délégué

Sillage ne possède pas son propre client OAuth Anthropic public. Le bouton de connexion délègue le flux au CLI officiel :

```bash
claude auth login --claudeai
```

L'état est lu via l'interface officielle :

```bash
claude auth status --json
```

Sillage ne lit jamais les fichiers de credentials, le trousseau macOS ou le token OAuth. `claude setup-token` n'est pas utilisé, car il exposerait un token longue durée que Sillage devrait ensuite manipuler.

### TODO

- [x] Créer `SillageClaudeBridge` comme bridge local minimal.
- [ ] Définir un protocole JSON-RPC borné sur `stdio`.
- [ ] Ajouter `auth_status`, `healthcheck`, `extract_note` et `cancel_job`.
- [x] Déléguer le login à `claude auth login --claudeai`.
- [x] Lire uniquement `claude auth status --json`, jamais le credential sous-jacent.
- [x] Filtrer les variables pouvant forcer une clé API ou un fournisseur cloud inattendu.
- [ ] Utiliser l'Agent SDK avec aucun outil et une sortie structurée stricte.
- [x] Ajouter timeout et limites de sortie au processus Claude.
- [ ] Ajouter l'arrêt du groupe de processus.
- [ ] Propager sans contournement les erreurs de login, quota, facturation et interdiction fournisseur.
- [ ] Ajouter un feature flag et un kill switch distant pour l'adaptateur expérimental.
- [ ] Ajouter un test prouvant que le bridge ne lit aucun chemin de credential Claude.
- [ ] Ajouter un test prouvant qu'aucun header ou identifiant de facturation n'est injecté.

### Terminé lorsque

Sillage peut déclencher une extraction Claude locale par une interface stable sans lire de token, exposer de proxy générique, réécrire une empreinte de requête ou forcer l'imputation sur l'abonnement.

---

## Embeddings et reranking locaux

### Décision recommandée

Utiliser un modèle multilingue local produisant nativement 1 024 dimensions afin de conserver le schéma pgvector actuel pendant la première migration.

Le modèle doit :

- bien fonctionner en français et en anglais ;
- être distribuable commercialement avec l'application ;
- fonctionner sur macOS Apple Silicon, macOS Intel, Windows et Linux ;
- fournir une implémentation ONNX ou équivalente sans runtime Python obligatoire ;
- produire des résultats déterministes pour une version donnée ;
- accepter le batch ;
- être versionné par nom, révision et checksum.

### Sélection du modèle

La sélection finale doit être décidée par benchmark, pas uniquement par réputation publique. Les candidats initiaux peuvent inclure des familles multilingues 1 024 dimensions, sous réserve de licence et de compatibilité runtime.

### Reranking

Ordre de livraison recommandé :

1. recherche hybride sans reranker local pour le premier prototype ;
2. benchmark de la perte de qualité ;
3. ajout d'un cross-encoder local si nécessaire ;
4. fallback vers Weighted RRF sans reranker en cas d'erreur ou de machine insuffisante.

### Cohérence des index

La signature du pipeline doit inclure :

```text
provider
provider generation/model family when available
promptVersion
artifactSchemaVersion
chunkerVersion
embeddingModel
embeddingRevision
embeddingDimensions
```

Tout changement incompatible déclenche une réindexation contrôlée. Aucun document utilisant deux signatures d'embedding différentes ne doit participer à la même recherche vectorielle.

---

## État local et file d'attente

Ajouter une base SQLite locale ou étendre l'état persistant du compagnon avec :

```text
LocalIngestionJob
  id
  tenantId
  notePath
  contentHash
  provider
  pipelineSignature
  status
  attempts
  nextAttemptAt
  lastErrorCode
  createdAt
  updatedAt

LocalDocumentState
  tenantId
  notePath
  lastSeenHash
  lastUploadedHash
  lastArtifactId
  pipelineSignature
  updatedAt
```

### Machine d'état

```text
detected
   ▼
queued ────────────────┐
   ▼                   │ retry avec backoff
extracting             │
   ▼                   │
embedding              │
   ▼                   │
uploading ─────────────┘
   ▼
done
```

Sorties alternatives :

```text
paused_auth
paused_quota
paused_offline
failed_permanent
cancelled_obsolete
```

### Règles de queue

- Une nouvelle modification annule le job obsolète de la même note avant upload.
- Un déplacement avec le même hash doit éviter une nouvelle extraction.
- Une suppression annule tous les jobs de la note et envoie un tombstone.
- Les retries utilisent un backoff exponentiel avec jitter.
- Les erreurs de quota ne bouclent pas ; elles attendent une reprise manuelle ou une fenêtre de renouvellement connue.
- La concurrence par défaut est de 1 pour protéger quota, CPU, RAM et batterie.
- La première indexation est interruptible et reprend après redémarrage.
- Le contenu brut n'est pas conservé dans la queue si le fichier peut être relu de façon sûre au moment du traitement.

---

## API cible

### Endpoints publics authentifiés

```text
POST   /ingest/artifacts
GET    /ingest/artifacts/:artifactId
POST   /ingest/artifacts/preflight
DELETE /note?path=...
GET    /vault/manifest
```

### Preflight

Le preflight permet d'éviter une extraction locale inutile :

```json
{
  "path": "Projects/Sillage.md",
  "contentHash": "sha256:...",
  "pipelineSignature": "..."
}
```

Réponses :

```text
unchanged   aucune extraction nécessaire
moved       envoyer uniquement la nouvelle identité de chemin
extract     produire un nouvel artefact
conflict    manifeste serveur incohérent, resynchronisation requise
```

### Validation serveur

Le serveur doit :

- prendre le tenant depuis la session authentifiée ;
- vérifier le schéma avec une implémentation stricte ;
- recalculer ou vérifier les IDs déterministes autorisés ;
- vérifier bornes, tailles, dimensions et nombres finis ;
- refuser tout chemin absolu, traversal ou chemin hors vault logique ;
- vérifier que les source ranges sont plausibles ;
- imposer une allowlist de versions de schéma ;
- appliquer des quotas de taille et de fréquence ;
- rendre l'upload idempotent par `(tenantId, artifactId)` ;
- rendre le document idempotent par `(tenantId, path, contentHash, pipelineSignature)` ;
- écrire document, chunks et état de job dans une transaction ;
- appliquer le graphe avec compensation ou retry si FalkorDB échoue ;
- ne jamais journaliser le texte complet, les embeddings ou l'artefact complet par défaut.

---

## Application déterministe du graphe

Créer dans le service mémoire une voie distincte de `Graphiti.add_episode()` :

```text
apply_ingestion_artifact(artifact)
  1. vérifier tenant et versions
  2. charger l'épisode courant par path
  3. comparer contentHash et pipelineSignature
  4. supprimer ou détacher les faits devenus obsolètes
  5. résoudre les entités candidates dans le tenant
  6. créer ou mettre à jour entités, faits et relations
  7. attacher toutes les provenances
  8. enregistrer l'épisode et la signature
  9. finaliser l'état atomique ou marquer un retry
```

### Résolution d'entités

Le modèle local propose des entités, mais le serveur reste responsable de leur identité globale.

Ordre de résolution :

1. identifiant externe explicitement présent et autorisé ;
2. correspondance exacte normalisée dans le tenant ;
3. alias déjà validé dans le tenant ;
4. candidat sémantique au-dessus d'un seuil strict ;
5. création d'une nouvelle entité.

Les fusions ambiguës ne sont jamais automatiques. Elles créent des entités distinctes ou une tâche de consolidation réversible.

### Suppressions et corrections

- Les faits appartenant uniquement à l'ancienne version d'une note sont retirés.
- Les faits également soutenus par d'autres notes conservent ces provenances.
- Les entités orphelines sont supprimées uniquement selon la politique actuelle validée.
- Les changements sont liés à `artifactId` pour audit et rollback.

---

## Sécurité et confidentialité

### Credentials

- Ne jamais lire `~/.codex/auth.json`, `~/.claude`, les cookies navigateur ou le trousseau du fournisseur.
- Ne jamais copier un credential dans les logs, crash reports ou diagnostics Sillage.
- Ne jamais synchroniser les répertoires de configuration du fournisseur.
- Vérifier le statut par une commande officielle ou un appel minimal, sans introspection du secret.
- Lancer le CLI avec un environnement filtré.

### Processus local

- Utiliser `spawn`/`Command` avec arguments séparés.
- Ne jamais passer le contenu de note dans la ligne de commande.
- Borner mémoire, taille de sortie et durée.
- Tuer le groupe de processus lors d'une annulation ou fermeture de l'application.
- Utiliser un répertoire temporaire Sillage dédié et récupérable.
- Ne monter le vault qu'en lecture lorsque cela est indispensable ; privilégier `stdin`.
- Désactiver outils, hooks, plugins, MCP, instructions projet et historique fournisseur.
- Ne charger aucun `AGENTS.md`, `CLAUDE.md` ou configuration provenant du vault.

### Artefacts distants

- Chiffrer le transport avec TLS.
- Authentifier chaque upload avec la session Sillage.
- Limiter et valider tous les champs avant désérialisation profonde.
- Vérifier l'isolation tenant dans PostgreSQL et FalkorDB.
- Stocker uniquement les données nécessaires au produit.
- Ajouter une suppression complète par document, vault et compte.

### Prompt injection

Le contenu d'une note est une donnée non fiable. Le prompt doit indiquer explicitement que :

- les instructions trouvées dans la note ne doivent jamais être suivies ;
- la note doit uniquement être analysée comme contenu ;
- aucun outil n'est disponible ;
- la sortie doit respecter le schéma sans action externe ;
- les URLs, commandes et blocs de code ne sont jamais exécutés.

Ajouter un corpus adversarial couvrant instructions cachées, faux JSON, Markdown imbriqué, contenu multilingue et tentatives d'exfiltration.

---

## Compatibilité commerciale et fournisseurs

Avant une disponibilité générale :

- obtenir une confirmation écrite ou une base contractuelle suffisamment claire pour l'utilisation automatisée locale via un abonnement utilisateur ;
- vérifier que le cas d'usage d'ingestion de connaissances non lié au code est accepté ;
- vérifier les conditions de redistribution ou d'installation assistée des CLI ;
- vérifier les restrictions applicables aux comptes personnels, Team, Business et Enterprise ;
- documenter les limites, fair-use policies et éventuels crédits supplémentaires ;
- prévoir la désactivation distante d'un adaptateur si un fournisseur modifie ses conditions ou son protocole ;
- maintenir le mode OpenRouter ou entièrement local comme solution supportée.

Le fait qu'un CLI puisse techniquement réutiliser une session locale ne constitue pas à lui seul une garantie contractuelle pour un produit tiers.

---

## Observabilité

Enregistrer uniquement :

```text
jobId
tenantId pseudonymisé si nécessaire
provider
providerVersion
pipelineSignature
noteHash tronqué ou HMAC
durée par étape
nombre d'entités/faits/chunks
taille d'entrée et sortie
code d'erreur normalisé
nombre de retries
```

Ne jamais enregistrer par défaut :

- contenu complet de la note ;
- prompt complet ;
- réponse brute du fournisseur ;
- raisonnements ou événements internes ;
- embeddings ;
- credentials ou chemins personnels absolus.

Ajouter une vue locale de diagnostic exportable, expurgée avant partage avec le support.

---

## Plan de livraison

## Phase 0 — Valider la faisabilité et le cadre fournisseur

### TODO

- [ ] Confirmer les plans et surfaces d'authentification supportés pour Codex local.
- [ ] Confirmer les plans et surfaces d'authentification supportés pour Claude Code local.
- [ ] Demander une validation du cas d'usage commercial et non strictement lié au code.
- [ ] Vérifier les conditions de redistribution ou d'installation assistée.
- [ ] Écrire deux prototypes isolés exécutant une extraction JSON sur une note synthétique.
- [ ] Vérifier qu'aucune clé API n'est nécessaire ou injectée.
- [ ] Vérifier le comportement avec session expirée, quota atteint et réseau absent.
- [ ] Mesurer temps de démarrage, latence, consommation et stabilité du JSON.
- [ ] Documenter les versions minimales de CLI fonctionnelles.
- [ ] Décider `go/no-go` séparément pour Codex et Claude Code.

### Terminé lorsque

Chaque adaptateur retenu possède une preuve technique reproductible et un niveau de support fournisseur acceptable pour une bêta utilisateur.

---

## Phase 1 — Définir le contrat et les benchmarks

### TODO

- [ ] Créer le JSON Schema `IngestionArtifactV1`.
- [ ] Définir les schémas stricts entité, fait, relation, provenance et chunk.
- [ ] Définir les limites de taille et cardinalité.
- [ ] Versionner le prompt d'extraction.
- [ ] Constituer un corpus français/anglais représentatif.
- [ ] Ajouter des notes courtes, longues, temporelles, contradictoires et multi-entités.
- [ ] Ajouter des notes adversariales contenant des prompt injections.
- [ ] Générer une baseline avec le pipeline Graphiti/OpenRouter actuel.
- [ ] Définir précision, rappel, taux de JSON valide, latence et coût quota comme métriques.
- [ ] Fixer les seuils minimaux avant mise en production.

### Terminé lorsque

Une extraction produite par n'importe quel fournisseur peut être validée par le même schéma et comparée objectivement à la baseline actuelle.

---

## Phase 2 — Construire le worker local

### TODO

- [ ] Créer le module `LocalIngestionWorker` dans le compagnon desktop.
- [ ] Ajouter la détection portable des exécutables sans shell.
- [ ] Ajouter la lecture de version et la matrice de compatibilité.
- [ ] Implémenter la file persistante locale.
- [ ] Implémenter déduplication, annulation des jobs obsolètes et reprise.
- [ ] Ajouter timeout, backoff, cancellation et arrêt propre des processus enfants.
- [ ] Filtrer l'environnement transmis au fournisseur.
- [ ] Créer un répertoire de travail isolé dans le cache Sillage.
- [ ] Ajouter une progression locale par étape.
- [ ] Ajouter des tests de crash et reprise après redémarrage.
- [ ] Ajouter un mode simulateur sans appel fournisseur pour les tests UI.

### Terminé lorsque

Une modification de note crée un job local durable, interruptible et reprenable sans appeler l'ancien endpoint d'ingestion cloud.

---

## Phase 3 — Implémenter l'adaptateur Codex

### TODO

- [ ] Implémenter `CodexAdapter.detect()`.
- [ ] Implémenter la vérification de version minimale.
- [ ] Implémenter un healthcheck n'exposant aucun credential.
- [ ] Implémenter `codex exec` avec sandbox lecture seule et session éphémère.
- [ ] Passer contenu et instruction sur `stdin`.
- [ ] Appliquer `--output-schema`.
- [ ] Désactiver configurations et règles utilisateur non nécessaires.
- [ ] Parser les sorties et codes d'erreur sans dépendre de texte localisé lorsque possible.
- [ ] Normaliser login requis, quota, timeout, annulation et sortie invalide.
- [ ] Refuser les variables forçant une authentification API facturée séparément.
- [ ] Tester macOS Apple Silicon, macOS Intel, Windows et Linux.
- [ ] Évaluer le passage ultérieur au SDK ou à l'app-server.

### Terminé lorsque

Codex produit un artefact conforme sur le corpus de test sans que Sillage lise ou stocke un secret OpenAI.

---

## Phase 4 — Implémenter l'adaptateur Claude Code

### TODO

- [x] Implémenter `ClaudeCodeAdapter.detect()`.
- [ ] Implémenter la vérification de version minimale.
- [x] Implémenter un healthcheck n'exposant aucun credential.
- [x] Utiliser le mode print, le JSON Schema et aucune persistance.
- [ ] Désactiver outils, hooks, MCP, plugins et instructions projet.
- [x] Utiliser `--safe-mode` et interdire `--bare` pour le mode abonnement.
- [x] Refuser `ANTHROPIC_API_KEY` dans le mode abonnement strict.
- [ ] Normaliser login requis, quota, timeout, annulation et sortie invalide.
- [ ] Tester macOS Apple Silicon, macOS Intel, Windows et Linux.
- [ ] Évaluer l'Agent SDK uniquement avec une authentification supportée.

### Terminé lorsque

Claude Code produit le même contrat d'artefact sans que Sillage lise ou stocke un secret Anthropic.

---

## Phase 5 — Ajouter embeddings et reranking locaux

### TODO

- [x] Intégrer deux modèles multilingues locaux compatibles avec l'index 1 024 dimensions.
- [ ] Créer un benchmark retrieval contre l'embedding OpenRouter actuel.
- [ ] Choisir et épingler modèle, révision et checksum.
- [x] Intégrer le runtime Candle portable dans le compagnon.
- [x] Ajouter batch, cache et limite CPU adaptative.
- [x] Versionner le chunker et le modèle dans chaque artefact.
- [ ] Vérifier les performances sur machines modestes.
- [ ] Ajouter un mode économie de batterie.
- [x] Ajouter Weighted RRF comme fallback sans reranker.
- [ ] Évaluer puis intégrer un reranker local si le benchmark l'exige.
- [x] Ajouter les tests empêchant le mélange de signatures vectorielles.

### Terminé lorsque

Le pipeline complet d'ingestion et de retrieval initial fonctionne sans clé API avec une qualité dans les seuils définis par la baseline.

---

## Phase 6 — Créer les endpoints d'artefacts

### TODO

- [x] Ajouter `/ingest/artifacts/preflight`.
- [x] Ajouter `POST /ingest/artifacts`.
- [x] Ajouter le suivi d'état idempotent par `artifactId`.
- [x] Valider strictement schéma, tailles, paths, ranges et vecteurs.
- [x] Ajouter les modèles Prisma nécessaires.
- [x] Écrire documents et chunks dans une transaction.
- [x] Ajouter des limites d'upload et une protection contre les payloads pathologiques.
- [x] Ne jamais accepter le tenant déclaré par le client comme autorité.
- [x] Gérer suppressions et déplacements dans le parcours local sans réextraction inutile.
- [ ] Ajouter les tests d'isolation entre tenants.
- [x] Conserver `/ingest/note` pour le mode OpenRouter pendant la migration.

### Terminé lorsque

Le serveur accepte un artefact local conforme, refuse les artefacts hostiles et persiste le document de manière idempotente dans le bon tenant.

---

## Phase 7 — Appliquer les artefacts au graphe

### TODO

- [x] Ajouter `apply_ingestion_artifact()` au service mémoire.
- [x] Mapper l'artefact vers épisodes, entités, faits, relations et provenances.
- [x] Résoudre les entités dans le périmètre du tenant.
- [x] Gérer modification, déplacement et suppression sans perdre les provenances partagées.
- [ ] Lier chaque écriture à `artifactId` et `contentHash`.
- [x] Lier l'épisode aux deux identifiants et les relations à `artifactId`.
- [ ] Ajouter une stratégie de compensation si PostgreSQL réussit mais FalkorDB échoue.
- [x] Ajouter des retries idempotents via le préflight sans rappeler le fournisseur local.
- [ ] Ajouter un outil de réconciliation PostgreSQL/FalkorDB.
- [ ] Comparer le graphe produit avec la baseline Graphiti.
- [ ] Documenter les différences acceptées.

### Terminé lorsque

Un même artefact peut être rejoué sans doublon, et une modification de note remplace uniquement les connaissances qui ne sont plus soutenues.

---

## Phase 8 — Construire l'onboarding et les réglages

### TODO

- [x] Ajouter le sélecteur de moteur d'ingestion.
- [x] Afficher installation, version, login et état de quota.
- [ ] Ajouter **Tester la connexion**.
- [ ] Ajouter des instructions d'installation spécifiques au système.
- [ ] Ouvrir le terminal ou la documentation officielle pour le login.
- [x] Ne jamais afficher ni demander un token fournisseur.
- [ ] Afficher l'avertissement sur les quotas partagés.
- [ ] Ajouter pause, reprise et annulation de la première indexation.
- [ ] Ajouter progression globale et par note.
- [x] Expliquer le besoin de réindexation lors d'un changement de pipeline.
- [ ] Ajouter une confirmation avant de quitter le mode local avec des jobs en attente.

### Terminé lorsque

Un utilisateur non technique peut installer, connecter, tester et utiliser le fournisseur local sans manipuler de secret API.

---

## Phase 9 — Migration, bêta et rollout

### Étapes

1. Feature flag interne.
2. Vaults synthétiques et comptes de test.
3. Dogfood avec double exécution sans double écriture.
4. Comparaison automatique des artefacts local et OpenRouter.
5. Bêta opt-in avec Codex uniquement si validé.
6. Ajout de Claude Code après validation indépendante.
7. Activation progressive par plateforme.
8. Disponibilité générale uniquement après validation fournisseur et qualité.

### TODO

- [ ] Ajouter les feature flags par fournisseur et plateforme.
- [ ] Ajouter un mode shadow produisant un artefact sans l'appliquer.
- [ ] Comparer précision, rappel, latence et erreurs avec la production actuelle.
- [ ] Ajouter un bouton de rollback vers OpenRouter.
- [ ] Préserver la queue locale lors d'un rollback temporaire.
- [ ] Ajouter une réindexation explicite lors du changement de signature.
- [ ] Définir des seuils d'arrêt automatique par taux d'échec.
- [ ] Documenter le support et les diagnostics.
- [ ] Mesurer le taux de quota atteint et le temps moyen de première indexation.
- [ ] Retirer les chemins temporaires uniquement après stabilisation.

### Terminé lorsque

Le mode local peut être activé ou désactivé sans perte de notes, fuite de secrets, mélange d'index ou blocage irréversible de l'utilisateur.

---

## Stratégie de test

### Tests unitaires

- détection et version des CLI ;
- construction sûre des arguments ;
- filtrage de l'environnement ;
- parsing des sorties structurées ;
- classification des erreurs ;
- validation JSON Schema ;
- IDs et hashes déterministes ;
- queue, annulation, déduplication et backoff ;
- validation des embeddings et des source ranges.

### Tests d'intégration

- faux exécutables Codex et Claude contrôlés par fixtures ;
- login absent, quota, timeout, crash et sortie trop grande ;
- redémarrage du desktop pendant chaque état ;
- upload répété du même artefact ;
- modification pendant extraction ;
- déplacement et suppression pendant upload ;
- panne PostgreSQL ou FalkorDB ;
- reprise après indisponibilité réseau ;
- isolation de deux tenants avec chemins identiques.

### Tests de sécurité

- injection shell dans titre, path et contenu ;
- note contenant instructions d'exfiltration ;
- note contenant faux événements JSON ;
- symlinks et paths traversals ;
- payload compressé ou profondément imbriqué ;
- NaN et infinis dans les vecteurs ;
- credential présent dans environnement parent ;
- hooks, plugins ou MCP malveillants configurés par l'utilisateur ;
- vérification qu'aucun contenu ou secret n'apparaît dans les logs.

### Tests de qualité

- extraction d'entités et de faits en français et anglais ;
- dates et temporalité ;
- négations et incertitude ;
- contradictions entre notes ;
- homonymes et alias ;
- provenance exacte ;
- notes sans fait exploitable ;
- stabilité entre exécutions ;
- comparaison avec Graphiti/OpenRouter ;
- retrieval de bout en bout après indexation locale.

### Matrice plateforme minimale

```text
macOS Apple Silicon
macOS Intel
Windows 11 natif
Windows 11 avec particularités CLI documentées
Ubuntu LTS x86_64
```

---

## Critères globaux d'acceptation

- Aucune clé API OpenAI ou Anthropic n'est demandée, lue, copiée ou stockée en mode abonnement local.
- Une note malveillante ne peut déclencher aucune commande, écriture ou accès outil.
- Une sortie fournisseur invalide n'est jamais appliquée partiellement.
- Tous les artefacts sont validés et isolés par tenant.
- Une ingestion interrompue reprend après redémarrage.
- Une note modifiée pendant traitement ne peut pas écraser sa version plus récente.
- Un déplacement avec hash identique ne relance pas inutilement le fournisseur.
- Les suppressions retirent les connaissances propres à la note sans supprimer les provenances partagées.
- Les embeddings de signatures incompatibles ne sont jamais mélangés.
- Le mode local atteint les seuils de qualité définis face à la baseline OpenRouter.
- L'utilisateur voit clairement installation, login, quota, progression et erreurs actionnables.
- Aucun passage vers des crédits API payants n'a lieu sans action explicite hors de Sillage.
- Le mode OpenRouter reste disponible comme rollback pendant toute la bêta.
- La disponibilité générale est bloquée tant que le cadre fournisseur n'est pas suffisamment validé.

---

## Ordre recommandé

L'ordre de réalisation recommandé est :

1. validation fournisseur et prototypes CLI ;
2. contrat d'artefact et benchmark ;
3. worker local et file persistante ;
4. adaptateur Codex ;
5. embeddings locaux ;
6. endpoint d'artefacts et application déterministe du graphe ;
7. interface utilisateur ;
8. shadow mode et bêta Codex ;
9. adaptateur Claude Code ;
10. rollout progressif.

Codex doit être livré en premier uniquement si la validation contractuelle et les tests confirment son adéquation. L'architecture ne doit jamais dépendre d'un seul fournisseur : le contrat `IngestionArtifactV1` et les embeddings locaux constituent la base durable du produit.
