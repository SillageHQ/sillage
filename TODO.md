[ ] Gamifier l'expérience (xp ? level ?)
[ ] Obfuscated le code pour éviter au maximum le reverse engeneering
    [ ] vérifier que le minium de techno leak dans le bundle de l'app; pas la je veux dire éviter de parler de neo4j, de grafiti etc... dans les endpoints par example
[ ] Systeme de check de version sur un endpoint du backend, télécharger depuis R2 cloudflare
[x] connection au compte sur l'app
[x] onboarding intéractif: choix du dossier du vault, ajout clé openrouter, choix thème de l'app: dark/light, choix de la couleur d'accentuation, choix du modèle par défaut et la dernière étape -> indexation du vault.
[x] BLOQUANT AVANT BÊTA — rendre toute la stack serveur réellement multi-tenant
    [x] ajouter les modèles User, Workspace/Tenant et Membership
    [x] ajouter un tenantId obligatoire à toutes les données utilisateur PostgreSQL (les releases restent globales)
    [x] mettre en place l'authentification serveur et dériver le tenant depuis le token vérifié, jamais depuis le client
    [x] centraliser les accès Prisma pour qu'aucune requête utilisateur ne puisse être exécutée sans tenant
    [x] activer et forcer PostgreSQL Row-Level Security avec une politique default-deny
    [x] filtrer les recherches pgvector par tenant avant le calcul de similarité
    [x] passer un group_id tenant à chaque opération Graphiti (ingestion, recherche, modification et suppression)
    [x] ajouter tenant_id à tous les nœuds, relations et épisodes FalkorDB
    [x] router toute requête Cypher directe vers le graphe du tenant authentifié
    [x] propager le tenant dans les workers, tâches asynchrones et appels entre services
    [x] supprimer les credentials de graphe codés en dur, fermer les ports publics et restreindre CORS
    [x] ajouter la suppression et l'export complets des données d'un tenant
    [x] ajouter des tests anti-fuite A/B structurels et réels sur lecture, recherche, modification et suppression
    [x] décider avant montée en charge : une instance FalkorDB, un graphe logique par Workspace
    [x] réaliser un audit de sécurité multi-tenant avant d'ouvrir la bêta (`SECURITY_AUDIT.md`)
[ ] agents dans l'app avec leur propre personalité créable par le user
[ ] plus d'outils a disposition pour le LLM
    [] possibilité d'utiliser
        [] claude code
        [] codex subscription
        [] glm
        [] kimi k3
    [ ] possibilité de spawner des sous agent qui peuvent remonter leur progression
    [ ] mise en place d'un tool de search web (exa.ai, brave search) par exemple
    [ ] tool pour rechercher dans des notes
    
[X] choix du modèle dans la conversation
[ ] mcp pour laisser d'autres apps accéder au données (hermes par exemple)
[X] connecter a lemon-squeezy pour payment de la spouscription
    [X] définir un pricing: monthly, reduction yearly ? one-time payment "chère" ? les 2 ? période d'essaie ?
[ ] ajouter google analytics sur le site.
[ ] sur X ajouter un lien ref pour savoir que les users viennent de X
[X] deployer sur coolify plutot que infomaniak

## Mémoire
[X] pouvoir ingérer des images -> extraire texte de/des l'image(s) et en faire une ou des notes
[ ] Retrieval mémoire : ajouter HyDE de manière optionnelle pour les recherches sémantiques
    [ ] générer au maximum une réponse hypothétique avec le modèle du tenant
    [ ] rechercher l'original, les variantes et l'hypothèse HyDE en parallèle
    [ ] ne jamais laisser HyDE remplacer une correspondance lexicale exacte
    [ ] activer/désactiver HyDE par feature flag et mesurer l'impact sur le vault
