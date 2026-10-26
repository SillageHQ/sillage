# Sillage — Stratégie marketing pour la bêta

Sillage peut commencer à être marketé, mais les 30 prochains jours doivent être traités comme une bêta de validation, pas comme un grand lancement.

L’objectif n’est pas encore d’obtenir beaucoup d’inscriptions. Il faut trouver 10 à 20 utilisateurs Obsidian très qualifiés, observer leur premier moment de valeur et comprendre pourquoi ils reviennent — ou non.

## 1. Positionnement à tester

Le marché « AI for Obsidian » est déjà concurrentiel. Smart Connections et Copilot proposent déjà recherche sémantique, suggestions de notes et chat avec le vault.

Sillage ne doit donc pas être vendu comme :

> Un assistant IA pour Obsidian.

Le positionnement à tester est plutôt :

> Sillage brings forgotten notes back when they become relevant — with their original source and context intact.

Ou, plus incisif :

> Your Obsidian vault remembers everything. Sillage helps it remember at the right moment.

### Territoire marketing

- Ennemi : le vault qui devient un cimetière de notes.
- Promesse : retrouver une pensée utile au moment où elle compte.
- Différence : resurfacing contextuel, sources visibles, Markdown préservé.
- Identité : pour les personnes qui ont déjà construit une vraie mémoire dans Obsidian, pas pour celles qui cherchent une nouvelle application de notes.

### Audience bêta idéale

- Utilise Obsidian presque quotidiennement.
- Possède au moins quelques centaines de notes.
- Écrit, fait de la recherche, développe des produits ou gère des projets complexes.
- Pense régulièrement : « Je sais que j’ai écrit ça quelque part. »
- Accepte une application desktop, une indexation initiale et une clé OpenRouter.

Cette dernière friction doit être annoncée clairement : la bêta est gratuite, mais l’utilisateur supporte actuellement ses coûts OpenRouter, comme indiqué dans les conditions.

## 2. Offre de bêta

Proposition :

> **Private beta for serious Obsidian users**  
> Free access during the beta, direct access to the founder, and influence over the product roadmap.

### Cohortes progressives

1. 5 utilisateurs accompagnés individuellement.
2. 10 utilisateurs supplémentaires une semaine plus tard.
3. 20 à 30 utilisateurs lorsque l’activation fonctionne sans assistance.

Il ne faut pas inviter 100 utilisateurs d’un coup. Si l’onboarding ou l’indexation casse, mieux vaut le découvrir sur cinq personnes.

En échange de l’accès, demander :

- un appel de départ de 20 minutes ;
- l’autorisation de mesurer les événements produit ;
- un retour après 7 jours ;
- éventuellement un témoignage si la valeur est réelle.

## 3. Funnel à finaliser avant d’envoyer du trafic

Le parcours actuel :

```text
X → landing page → waitlist → invitation/code
  → création du compte → activation → app desktop
  → indexation → première valeur
```

Il existe une fuite importante : après activation, la page compte dit d’ouvrir l’application desktop, mais ne présente aucun bouton de téléchargement.

Avant toute campagne, rendre le chemin évident :

- bouton « Download for macOS/Windows » ;
- prérequis visibles ;
- guide d’installation en trois étapes ;
- lien d’aide ;
- version et plateforme détectées ;
- email d’invitation contenant le même lien.

Ajouter des paramètres UTM aux liens X :

```text
https://sillagehq.app/?utm_source=x&utm_medium=organic&utm_campaign=private_beta_01&utm_content=resurfacing_demo
```

### Événements minimum à mesurer

- `waitlist_joined`
- `invite_sent`
- `beta_activated`
- `desktop_downloaded`
- `vault_connected`
- `indexing_completed`
- `first_grounded_recall`
- `returned_day_7`
- `feedback_submitted`

La vraie activation n’est pas la création du compte. C’est :

> Vault indexé + première réponse utile reliée à une note source.

Attention à l’ajout de Google Analytics : la politique actuelle présente le stockage comme essentiellement nécessaire. Si une mesure non essentielle est ajoutée, le consentement et la politique de confidentialité devront être alignés. Une solution sobre et respectueuse de la vie privée conviendrait mieux à la marque.

## 4. Utilisation de X

Le compte Sillage doit montrer le résultat, pas raconter les technologies internes.

### Répartition du contenu

- 50 % : problèmes et idées autour de la mémoire, du PKM et des vaults oubliés.
- 30 % : démonstrations produit courtes.
- 20 % : construction de la bêta, retours et invitations.

### Cadence soutenable

- 3 publications originales par semaine.
- 2 courtes vidéos produit par semaine.
- 5 à 10 réponses utiles par jour dans les conversations Obsidian/PKM.
- 1 récapitulatif d’apprentissage par semaine.

Les messages doivent être concis, conversationnels, avec un CTA clair, peu ou pas de hashtags et des vidéos courtes sous-titrées.

Les réponses seront probablement plus importantes que les posts au début. Rechercher quotidiennement des conversations contenant :

- `forgotten notes`
- `Obsidian vault`
- `can’t find my notes`
- `note graveyard`
- `PKM overwhelm`
- `I know I wrote this somewhere`

Répondre utilement sans ajouter systématiquement un lien. Lorsque la douleur correspond vraiment :

> I’m building something specifically around this problem. Happy to give you private beta access if you’d like to test it on a real vault.

## 5. Profil X recommandé

### Bio

> The contextual memory layer for Obsidian. Bring forgotten notes back with their source and context intact. Private beta ↓

### Post épinglé

> Your Obsidian vault probably contains ideas you’ve completely forgotten.
>
> Sillage brings the right one back when it becomes relevant — with the original note and context still attached.
>
> We’re opening a small private beta for serious Obsidian users.
>
> [short demo]
>
> Request access: sillagehq.app

La bannière existante est déjà cohérente avec ce positionnement.

## 6. Premiers posts

Le contenu devrait être publié en anglais, car le produit et le marché Obsidian visé sont internationaux.

### Post 1 — Le problème

> The problem with a second brain isn’t capturing more notes.
>
> It’s remembering the right note when it matters.
>
> That’s what we’re building Sillage for.

### Post 2 — Démonstration

> 18 months ago, you wrote the missing piece.
>
> Today, Sillage brings it back — with the original source and context intact.
>
> Not another generated answer. Your own thinking, returned.
>
> [10–15 second video]

### Post 3 — Opinion

> Search only works when you remember what to search for.
>
> A useful second brain should also surface what you’ve forgotten.

### Post 4 — Différenciation

> Sillage doesn’t replace Obsidian.
>
> Your folders stay.  
> Your Markdown stays.  
> Your source notes stay authoritative.
>
> Recall simply gets better.

### Post 5 — Conversation

> Obsidian users: how often do you rediscover a note months later and think, “I needed this last week”?

### Post 6 — Appel bêta

> We’re inviting the first 10 Sillage beta testers.
>
> A good fit if you:  
> — use Obsidian regularly  
> — have a vault full of forgotten material  
> — are willing to share honest feedback
>
> Request access: [UTM link]

## 7. Programme sur 30 jours

### Jours 1 à 3

- Ajouter téléchargement, guide et analytics du funnel.
- Préparer une démonstration de 10 à 15 secondes.
- Mettre à jour la bio, la bannière et le post épinglé.
- Préparer les cinq emails de bêta.
- Créer un formulaire de qualification très court.

### Semaine 1

- Publier trois contenus.
- Contacter manuellement 20 personnes pertinentes via des interactions publiques.
- Inviter les cinq meilleurs profils.
- Faire leur onboarding en direct.
- Observer où chacun bloque.

### Semaine 2

- Corriger les blocages.
- Inviter dix nouveaux testeurs.
- Noter mot pour mot comment ils décrivent le problème et la valeur.
- Identifier le « wow moment » le plus fréquent.

### Semaine 3

- Publier deux démonstrations basées sur de vrais usages.
- Transformer un retour en mini étude de cas.
- Tester deux messages :
  - `Find what you wrote.`
  - `Resurface what you forgot.`

### Semaine 4

- Passer à 20–30 utilisateurs si l’activation tient.
- Demander une recommandation aux utilisateurs actifs.
- Tester la volonté de payer, sans encore imposer un prix.
- Décider quel usage devient le message principal.

## 8. Chiffres qui comptent

Pour la première cohorte :

- 15 utilisateurs activés ;
- au moins 10 ayant terminé l’indexation ;
- au moins 8 ayant obtenu une première réponse réellement utile ;
- au moins 5 revenus pendant la deuxième semaine ;
- 5 entretiens utilisateurs ;
- 3 citations ou témoignages exploitables ;
- une explication claire du cas d’usage qui provoque le plus de valeur.

Les impressions X et la taille de la waitlist sont secondaires. Le signal décisif est :

> Sillage m’a rendu une information utile que je n’aurais pas retrouvée autrement.

## Prochaine action

Terminer le parcours téléchargement → activation, enregistrer une seule démonstration forte, puis recruter manuellement les cinq premiers bêta-testeurs à partir de conversations Obsidian existantes.

## Références

- [Bonnes pratiques organiques de X](https://business.x.com/en/basics/organic-best-practices)
- [Smart Connections — Obsidian](https://community.obsidian.md/plugins/smart-connections)
- [Copilot — Obsidian](https://community.obsidian.md/plugins/copilot)
