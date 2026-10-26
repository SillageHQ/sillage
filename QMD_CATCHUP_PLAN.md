# Plan d'exécution — Atteindre puis dépasser QMD

## Objectif

Construire un moteur de récupération documentaire au moins aussi fiable que QMD sur les notes Markdown, puis le dépasser grâce au graphe de connaissances, à la temporalité, aux citations stables, à la consolidation contrôlée et au feedback utilisateur.

Ce plan porte sur la récupération et son évaluation. La migration des appels IA vers OpenRouter est décrite dans `OPENROUTER_MIGRATION_PLAN.md`.

## Résultat attendu

Le pipeline final doit suivre ce flux :

```text
Question + historique court
          │
          ▼
Routeur de requête
  ├─ sans retrieval
  ├─ lexical exact
  ├─ hybride
  ├─ temporel
  └─ multi-hop
          │
          ▼
Réécriture contextuelle et expansion adaptative
  ├─ requête lexicale
  ├─ requête vectorielle
  └─ HyDE lorsque pertinent
          │
          ▼
Génération indépendante des candidats
  ├─ BM25
  ├─ pgvector/HNSW
  ├─ faits Graphiti
  ├─ wikilinks, tags et mentions explicites
  └─ contraintes temporelles
          │
          ▼
Weighted RRF → top 30 → reranking → diversification
          │
          ▼
Top 5 à 8 passages avec provenance stable
```

## Décisions techniques

- Obsidian reste la source de vérité canonique.
- PostgreSQL reste le registre des documents, chunks, citations et événements de feedback.
- `pgvector` reste le moteur vectoriel initial.
- Le lexical utilise un véritable index BM25 basé sur Tantivy via l'extension PostgreSQL `pg_search`.
- Les listes lexicales, vectorielles et graphe sont calculées séparément avant fusion.
- La fusion utilise Weighted Reciprocal Rank Fusion, sans addition directe de scores hétérogènes.
- Le reranker réordonne les candidats mais conserve une part du score de fusion.
- Les modèles et index sont versionnés. Un changement de modèle d'embedding déclenche une réindexation contrôlée.
- Une réponse de l'assistant ne devient jamais une connaissance canonique sans validation et écriture explicites.
- Chaque résultat final doit conserver `userId`, `notePath`, `chunkId`, heading, lignes et hash du contenu.

## Critères globaux d'acceptation

- Recall@5 supérieur ou égal à QMD sur le même corpus et les mêmes requêtes.
- MRR et nDCG@10 supérieurs ou égaux à QMD.
- Taux d'ouverture des citations égal à 100 %.
- Routage sans RAG égal à 100 % sur les salutations, accusés de réception et commandes simples.
- Aucune fuite de résultats entre utilisateurs.
- Aucun chunk obsolète après création, modification, déplacement ou suppression d'une note.
- Les questions temporelles et multi-hop dépassent QMD sur le jeu spécialisé du produit.
- Les résultats restent utilisables si l'expansion ou le reranker est indisponible.
- Chaque régression de qualité est détectée par la CI avant déploiement.

---

## Phase 0 — Établir la baseline QMD

### Étapes

1. Geler une version précise de QMD dans la configuration du benchmark.
2. Construire un corpus synthétique reproductible couvrant les fonctionnalités attendues.
3. Ajouter un corpus privé anonymisé représentatif d'un vrai vault.
4. Exécuter QMD et notre pipeline sur exactement les mêmes chunks et requêtes.
5. Enregistrer les résultats bruts, les rangs, les latences et les erreurs par requête.
6. Publier un rapport comparatif généré automatiquement par la CI.

### Jeu d'évaluation minimal

- 40 requêtes lexicales exactes : noms propres, acronymes, dates, codes et citations.
- 40 requêtes sémantiques : synonymes et formulations sans mots communs.
- 25 questions conversationnelles nécessitant une réécriture autonome.
- 20 questions temporelles : dernière décision, ancienne préférence, évolution d'une idée.
- 20 questions multi-hop réparties sur plusieurs notes.
- 15 requêtes avec mentions explicites de notes.
- 20 requêtes négatives ne devant déclencher aucun retrieval.
- 20 requêtes adversariales avec notes proches mais incorrectes.

### TODO

- [x] Étendre `services/memory/evaluation/rag_cases.json` avec au moins 200 requêtes classées par catégorie.
- [x] Ajouter les champs `category`, `expectedChunkIds`, `forbiddenPaths` et `requiresRetrieval`.
- [x] Ajouter un adaptateur de benchmark QMD produisant un JSON normalisé.
- [x] Mesurer Recall@1, Recall@5, MRR, nDCG@10 et précision des citations.
- [x] Mesurer p50, p95, nombre d'appels IA et coût OpenRouter par requête.
- [x] Conserver les résultats de référence dans des artefacts CI, jamais dans le vault utilisateur.
- [x] Faire échouer la CI si Recall@5, MRR ou ouverture des citations régressent au-delà de 2 %.
- [x] Documenter la version de QMD, ses modèles et ses paramètres dans chaque rapport.

### Terminé lorsque

Une commande unique exécute les deux moteurs et génère un rapport comparable, déterministe et exploitable.

**Statut Phase 0 :** harness livré (`evaluation/compare_engines.py`). Lancer une première baseline live (Sillage + optionnel QMD) pour figer `baselines/sillage-reference.json`.

---

## Phase 1 — Instrumenter le pipeline actuel

### Étapes

1. Donner un identifiant de trace à chaque requête de récupération.
2. Journaliser uniquement les métadonnées nécessaires, sans contenu privé par défaut.
3. Capturer les candidats de chaque source et la raison de leur sélection.
4. Mesurer séparément embedding, lexical, vectoriel, graphe, fusion et reranking.
5. Ajouter un mode debug réservé au propriétaire de la donnée.

### TODO

- [ ] Ajouter `retrievalTraceId` aux appels `/rag/search` et `recall_memory`.
- [ ] Enregistrer le nombre de candidats BM25, vectoriels, graphe et mentions.
- [ ] Enregistrer rang initial, score normalisé, score RRF, score reranker et rang final.
- [ ] Enregistrer modèle, dimension et version d'index utilisés.
- [ ] Ajouter des métriques de cache hit, timeout, fallback et résultat vide.
- [ ] Masquer question, contenu des chunks, clé API et données personnelles dans les logs standards.
- [ ] Ajouter un écran ou endpoint interne permettant d'inspecter une trace autorisée.
- [ ] Ajouter des tests vérifiant qu'aucun secret ni contenu complet n'apparaît dans les logs.

### Terminé lorsque

Chaque mauvais résultat peut être expliqué par une trace complète sans exposer les données d'un autre utilisateur.

---

## Phase 2 — Ajouter un vrai BM25

### Étapes

1. Construire une image PostgreSQL de production contenant `pgvector` et `pg_search`, avec versions épinglées.
2. Ajouter un document de recherche dénormalisé par chunk.
3. Indexer séparément titre, chemin, headings, tags, aliases et texte.
4. Pondérer fortement les correspondances exactes dans le titre, le chemin et les aliases.
5. Exposer une recherche lexicale indépendante retournant les top K candidats.
6. Garder temporairement la recherche FTS actuelle comme fallback de migration.

### Champs BM25

```text
user_id
chunk_id
document_id
title
path
heading_path
tags
aliases
body
content_hash
```

### TODO

- [ ] Ajouter `pg_search` à l'image PostgreSQL sans retirer `pgvector`.
- [ ] Créer la migration SQL de l'index BM25.
- [ ] Ajouter `userId` à chaque document et chunk avant d'activer la recherche multi-tenant.
- [ ] Indexer titre, chemin, headings, tags et aliases avec boosts explicites.
- [ ] Implémenter `/rag/search/lexical` avec un `limit` maximal de 100.
- [ ] Ajouter les recherches par phrase exacte, préfixe et exclusion de termes.
- [ ] Vérifier les requêtes françaises, anglaises, accents et apostrophes.
- [ ] Ajouter un fallback vers PostgreSQL FTS si l'extension BM25 est indisponible.
- [ ] Comparer BM25 à l'ancien `ts_rank_cd` dans le benchmark.
- [ ] Retirer l'ancien score lexical du mélange `0.75/0.25` après validation.

### Terminé lorsque

La recherche lexicale égale ou dépasse QMD sur les requêtes exactes sans dégrader les requêtes françaises.

---

## Phase 3 — Séparer le vectoriel et corriger la fusion

### Étapes

1. Exécuter la recherche vectorielle indépendamment du lexical.
2. S'assurer que la requête SQL peut utiliser l'index HNSW.
3. Récupérer un top K suffisant par canal.
4. Fusionner les rangs avec Weighted RRF.
5. Appliquer des bonus bornés aux mentions explicites et correspondances exactes.
6. Diversifier les résultats par note après reranking.

### Paramètres initiaux

```text
BM25 top K             50, poids RRF 1.0
Vectoriel top K        50, poids RRF 1.0
Graphiti top K         30, poids RRF 0.8
Mention explicite      poids RRF 1.5
k RRF                  60
Candidats rerankés     30
Résultats finaux       5 à 8
Maximum par note       2
```

Ces paramètres sont versionnés et ajustés uniquement à partir du benchmark.

### TODO

- [ ] Créer `/rag/search/vector` avec un `ORDER BY embedding <=> query LIMIT K` directement exploitable par HNSW.
- [ ] Retirer le calcul vectoriel sur l'ensemble des chunks avant tri.
- [ ] Activer et mesurer `hnsw.ef_search` dans le benchmark.
- [ ] Implémenter Weighted RRF dans un module testé indépendamment.
- [ ] Ajouter les bonus exacts sans permettre à un bonus de dominer tous les canaux.
- [ ] Ajouter une limite de deux chunks par note dans les résultats finaux.
- [ ] Comparer recherche exacte et HNSW pour mesurer la perte de recall.
- [ ] Ajouter des tests de stabilité lorsque l'un des canaux retourne zéro résultat.
- [ ] Ajouter un fallback lexical seul si l'embedding échoue.

### Terminé lorsque

La fusion ne combine plus directement des scores incompatibles et le benchmark hybride égale ou dépasse QMD.

---

## Phase 4 — Contextualiser les chunks

### Étapes

1. Continuer à découper selon les headings et paragraphes.
2. Produire un texte d'embedding enrichi sans modifier le texte cité.
3. Ajouter un petit chevauchement logique entre chunks voisins.
4. Versionner l'algorithme de chunking.
5. Réindexer uniquement les chunks affectés par une modification.

### Format d'embedding

```text
Note: <titre>
Path: <chemin>
Section: <heading parent > heading courant>
Tags: <tags>
Aliases: <aliases>
Context: <résumé court optionnel de la note>

<texte du chunk>
```

### TODO

- [ ] Séparer `citationText` et `embeddingText` dans le modèle de chunk.
- [ ] Ajouter titre, chemin, headings, tags et aliases au texte d'embedding.
- [ ] Ajouter le paragraphe précédent ou suivant lorsque le chunk commence par une référence ambiguë.
- [ ] Conserver les numéros de lignes du texte source exact.
- [ ] Ajouter `chunkingVersion` et `embeddingTextHash`.
- [ ] Réutiliser l'embedding si `embeddingTextHash` est inchangé.
- [ ] Tester tableaux, listes, callouts Obsidian, code fences et très longues sections.
- [ ] Mesurer l'amélioration par catégorie avant activation globale.

### Terminé lorsque

Les chunks restent citables mot pour mot tout en récupérant correctement les passages dépendants de leur contexte.

---

## Phase 5 — Ajouter le routage et l'expansion adaptative

### Étapes

1. Classer chaque requête avant retrieval.
2. Transformer les questions de suivi en questions autonomes.
3. Générer au maximum une variante lexicale, une variante vectorielle et un HyDE.
4. Ne pas utiliser HyDE pour les requêtes exactes, numériques ou négatives.
5. Cacher les expansions par hash de la requête autonome et du modèle.

### Classes de routage

```text
no_retrieval
exact_lookup
hybrid_recall
temporal_recall
multi_hop_recall
explicit_note
```

### TODO

- [ ] Implémenter le routeur avec une sortie JSON stricte et une règle déterministe de secours.
- [ ] Passer les derniers messages nécessaires à la réécriture, avec une limite de tokens.
- [ ] Ajouter la requête originale avec un poids supérieur aux variantes.
- [ ] Implémenter les variantes `lex`, `vec` et `hyde`.
- [ ] Désactiver l'expansion pour noms de fichiers, codes, citations, dates et mentions explicites.
- [ ] Limiter l'expansion à un seul appel IA par question.
- [ ] Ajouter timeout, cache et fallback vers la question originale.
- [ ] Évaluer séparément le routeur et la qualité des reformulations.
- [ ] Ajouter des tests contre la dérive de sens et l'invention de faits dans HyDE.

### Terminé lorsque

Les questions de suivi sont récupérées correctement et l'expansion améliore le recall sans dégrader les recherches exactes.

---

## Phase 6 — Renforcer le reranking

### Étapes

1. Utiliser un endpoint de reranking dédié.
2. Reranker uniquement les 30 meilleurs candidats fusionnés.
3. Mélanger le score du reranker avec le rang fusionné.
4. Appliquer ensuite diversité, autorité, fraîcheur et validité temporelle.
5. Retourner immédiatement le classement fusionné en cas de panne.

### Formule initiale

```text
Top 1 à 3   : 75 % fusion, 25 % reranker
Top 4 à 10  : 60 % fusion, 40 % reranker
Après 10    : 40 % fusion, 60 % reranker
```

### TODO

- [ ] Créer une interface `Reranker` indépendante du fournisseur.
- [ ] Ajouter l'implémentation OpenRouter `/rerank`.
- [ ] Envoyer des documents bornés contenant texte et provenance utile.
- [ ] Conserver le score RRF dans le score final.
- [ ] Ajouter timeout, circuit breaker et fallback sans reranking.
- [ ] Ajouter une limite de tokens et de documents par requête.
- [ ] Mesurer gain de MRR, latence et coût par catégorie.
- [ ] Tester les passages très similaires provenant de notes différentes.

### Terminé lorsque

Le reranking améliore MRR et nDCG sans réduire Recall@5 ni rendre le système indisponible lors d'une panne fournisseur.

---

## Phase 7 — Dépasser QMD avec le graphe et la temporalité

### Étapes

1. Partir des meilleurs chunks et faits pour identifier les entités pivots.
2. Étendre d'un saut les wikilinks explicites, tags et relations Graphiti.
3. Autoriser deux sauts uniquement pour les requêtes classées multi-hop.
4. Appliquer les contraintes `valid_at`, `invalid_at` et relations de remplacement.
5. Expliquer la chaîne de provenance utilisée dans la réponse.

### TODO

- [ ] Ajouter les relations `SUPERSEDES`, `CONTRADICTS` et `DERIVED_FROM` au modèle de connaissance.
- [ ] Conserver séparément relations Obsidian explicites et relations inférées.
- [ ] Ajouter un retrieval temporel avec date de référence explicite ou implicite.
- [ ] Ajouter l'expansion d'un saut pour les entités et notes fortement classées.
- [ ] Ajouter l'expansion de deux sauts uniquement en mode multi-hop.
- [ ] Limiter le budget de candidats graphe pour éviter l'explosion combinatoire.
- [ ] Ajouter des citations pour chaque étape d'une réponse multi-hop.
- [ ] Ajouter des cas de benchmark portant sur décisions remplacées et préférences historiques.
- [ ] Refuser d'affirmer qu'une ancienne information est actuelle lorsqu'elle a été remplacée.

### Terminé lorsque

Notre système dépasse QMD sur les questions temporelles et multi-hop tout en produisant une provenance vérifiable.

---

## Phase 8 — Apprendre du feedback sans contaminer la mémoire

### Événements autorisés

```text
citation_shown
citation_opened
result_dismissed
answer_regenerated
explicit_source_selected
knowledge_proposal_accepted
knowledge_proposal_rejected
```

### Étapes

1. Collecter les événements avec consentement et minimisation des données.
2. Relier chaque événement à une trace de retrieval.
3. Construire des rapports agrégés par catégorie de requête.
4. Ajuster les poids uniquement après validation hors ligne.
5. Ne jamais transformer un signal comportemental en fait personnel.

### TODO

- [ ] Ajouter le modèle PostgreSQL `RetrievalFeedback` avec `userId` et `retrievalTraceId`.
- [ ] Instrumenter ouverture de citation, rejet et sélection explicite.
- [ ] Ajouter une politique de rétention et suppression des événements.
- [ ] Construire un export anonymisé destiné au benchmark.
- [ ] Ajouter un entraînement ou réglage hors ligne des poids RRF.
- [ ] Interdire toute modification automatique du vault depuis ces événements.
- [ ] Ajouter des tests prouvant qu'un feedback ne crée pas une mémoire Graphiti.

### Terminé lorsque

Les signaux améliorent les paramètres du retrieval sans modifier silencieusement les connaissances de l'utilisateur.

---

## Phase 9 — Performance, résilience et montée en charge

### TODO

- [ ] Mettre embeddings, expansions et rerankings en cache par utilisateur, modèle et hash de contenu.
- [ ] Déplacer indexation, réindexation et extraction Graphiti dans des workers idempotents.
- [ ] Ajouter une file avec retry exponentiel, dead-letter queue et reprise manuelle.
- [ ] Définir des timeouts séparés pour embedding, graphe, expansion et reranking.
- [ ] Ajouter des circuit breakers par service externe.
- [ ] Utiliser `halfvec(1024)` dans un benchmark de stockage avant migration éventuelle.
- [ ] Mesurer taille HNSW, mémoire, p95 et recall à 100 k, 1 M et 10 M chunks.
- [ ] Ajouter sauvegarde et reconstruction complète des index dérivés.
- [ ] Vérifier l'isolation `userId` dans toutes les requêtes SQL et Neo4j.
- [ ] Ajouter des tests de charge concurrents et de suppression complète d'un utilisateur.

### Terminé lorsque

La recherche reste disponible sous charge, les index sont reconstruisibles et chaque panne possède un fallback explicite.

---

## Phase 10 — Déploiement progressif

### Étapes

1. Déployer les nouveaux index sans modifier le chemin de lecture.
2. Exécuter l'ancien et le nouveau retrieval en shadow mode.
3. Comparer automatiquement les résultats sans doubler les réponses envoyées au modèle.
4. Activer le nouveau pipeline pour l'équipe interne.
5. Passer à 5 %, 25 %, 50 % puis 100 % des utilisateurs.
6. Conserver un feature flag de retour immédiat vers l'ancien retrieval.
7. Supprimer l'ancien chemin uniquement après deux versions stables.

### TODO

- [ ] Ajouter les feature flags `retrieval_v2`, `bm25_v2`, `query_expansion`, `graph_expansion` et `rerank_v2`.
- [ ] Ajouter un shadow mode sans impact sur la réponse utilisateur.
- [ ] Comparer qualité, erreurs, p95 et coût avant chaque palier.
- [ ] Documenter le rollback de chaque index et service.
- [ ] Vérifier la reconstruction depuis Obsidian après un rollback.
- [ ] Retirer le mélange SQL `semanticScore * 0.75 + lexicalScore * 0.25` après stabilisation.
- [ ] Archiver le rapport final QMD versus Second Brain.

## Checklist finale

- [ ] Baseline QMD reproductible et versionnée.
- [ ] Vrai BM25 opérationnel.
- [ ] Recherche vectorielle indépendante utilisant HNSW.
- [ ] Weighted RRF testé et instrumenté.
- [ ] Chunks contextualisés et citations exactes.
- [ ] Réécriture conversationnelle et expansion adaptative.
- [ ] Reranking dédié avec fallback.
- [ ] Retrieval graphe et temporel.
- [ ] Feedback utilisateur sans contamination de la mémoire.
- [ ] Isolation multi-tenant prouvée.
- [ ] Recall@5, MRR et nDCG@10 au moins égaux à QMD.
- [ ] Supériorité mesurée sur temporalité et multi-hop.
- [ ] Déploiement progressif terminé.
- [ ] Ancien pipeline retiré après deux versions stables.
