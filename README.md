# Kyara BOT

Bot Discord (discord.js v14) avec des commandes slash en français qui affichent les infos de [kyara.games](https://kyara.games).

## Commandes

| Commande | Description |
|---|---|
| `/profil [membre] [pseudo]` | Profil d'un joueur en 2 images : 1) avatar, pseudo, rang, bio, badges, et un encadré avec les cartes uniques, la complétion, les boosters ouverts, les œuvres complètes, les doublons et la progression vers le rang suivant, puis la vitrine ; 2) cartes par rareté |
| `/collection [rarete] [oeuvre] [membre] [pseudo]` | La collection carte par carte (façon Mudae), de la plus rare à la moins rare : nom, rareté, œuvre, prix au marché et grande illustration |
| `/persos fiche nom` | Fiche du personnage en image (nette, envoyée hors embed) : sa carte, son nom, son univers, sa rareté, sa valeur (puissance, aura, popularité), son prix au marché, si tu l'as ou pas (et combien de joueurs l'ont), et le meilleur booster qu'on peut ouvrir pour l'obtenir, avec sa chance et son prix |
| `/persos liste [rarete] [oeuvre] [tri]` | Les personnages de Kyara carte par carte (façon Mudae), du plus rare au moins rare par défaut |
| `/persos oeuvre oeuvre` | Les personnages d'une œuvre carte par carte, du plus rare au moins rare |
| `/persos envies [membre] [pseudo] [rarete]` | Les envies (wishlist) d'un joueur, 12 par page |
| `/persos doublons [membre] [pseudo] [rarete]` | Les doublons d'un joueur |
| `/persos nouveautes` | Dernière mise à jour du catalogue |
| `/classement [par]` | Les 10 meilleurs joueurs parmi les membres qui ont accès au salon, en image nette (2400 px, envoyée hors embed) : podium pour les 3 premiers, puis les places 4 à 10 (pseudo Kyara uniquement). Critère : collection, prestige, mythiques, collections finies, succès, boosters ouverts, doublons ou meilleur vendeur |
| `/magasin [type] [membre] [pseudo]` | Les ventes, enchères et ordres d'achat en cours d'un joueur, carte par carte (façon Mudae) : nom, rareté, prix et illustration. Les annonces dont le compteur est écoulé ne sont plus affichées |
| `/manquantes [oeuvre] [rarete] [membre] [pseudo]` | Les cartes qui manquent dans une œuvre (ou une rareté). Sans `oeuvre` ni `rarete` : toutes les œuvres favorites |
| `/favoris ajouter oeuvre` · `retirer oeuvre` · `liste [membre]` | Gère tes œuvres favorites (15 max), avec ta progression. Une œuvre absente de Kyara peut être ajoutée : elle apparaît comme « série personnalisée », puis sa progression s'affiche toute seule quand elle arrive sur le site |

Avec `pseudo`, le bot ne prend un joueur que si le pseudo correspond exactement (ou s'il n'y a qu'un résultat) ; sinon il propose les pseudos proches, sans jamais choisir un autre joueur au hasard. Le joueur visé est celui de l'option `pseudo` (n'importe quel joueur Kyara, ou un ID Discord / une mention), sinon le `membre` mentionné, sinon toi. Les longues réponses ont des boutons ◀ ▶, qui bouclent (◀ sur la première page mène à la dernière), utilisables par l'auteur de la commande pendant 30 min.

Sous les réponses de `/collection`, `/manquantes`, `/magasin` et `/persos` (liste, oeuvre, envies, doublons), des menus permettent de changer les options (rareté, œuvre, tri, type) sans retaper la commande. Ils sont placés juste au-dessus des boutons ◀ ▶. Dans `/collection`, le menu Œuvre liste toutes les œuvres dont le joueur possède au moins une carte (ses 8 plus avancées d'abord, puis les autres par ordre alphabétique) ; au-delà de 25, des entrées « Précédentes / Suivantes » font défiler le menu. Le profil public ne donnant que 8 œuvres, le bot analyse la collection en arrière-plan à la première ouverture (quelques minutes, à 24 requêtes/s au plus, un joueur à la fois) et garde le résultat 6 h : la liste se complète pendant l'analyse. Ailleurs, le menu Œuvre propose l'œuvre choisie, tes favoris, puis les plus grandes œuvres de Kyara.

Le bouton **🔎 Rechercher un personnage** (dans `/collection`, `/manquantes`, `/magasin` et `/persos` liste, oeuvre, envies, doublons) filtre la liste affichée sur un nom de personnage (ou une partie, nom japonais compris) : par exemple « uchiha » dans `/collection` ne montre plus que les Uchiha du joueur. Le bouton ✖ efface la recherche. Les menus Œuvre ont un bouton **🔎 Rechercher une œuvre** : on tape un titre (ou une partie), et le menu n'affiche plus que les œuvres trouvées (parmi celles du joueur dans `/collection`, parmi toutes les œuvres de Kyara ailleurs). Un titre exact ou un résultat unique est sélectionné directement.

**Données à jour** : les collections changent vite (un booster toutes les 10 min). Chaque commande relit le profil du joueur directement sur le site (au lancement, à chaque changement de filtre et à chaque vérification au clic), la vérification d'une carte n'est gardée que 5 s, et ce que le bot sait d'une rareté est oublié dès que son compteur change sur le profil (et au bout d'1 h dans tous les cas). Pendant la navigation, chaque clic vérifie si le profil a changé (cartes, doublons, envies, ventes, achats) : si oui, la réponse est reconstruite avec les données à jour. Une page affichée il y a plus d'une minute est reconstruite, et chaque message indique l'heure de ses données. La liste complète des œuvres d'un joueur est réanalysée toutes les 6 h ; entre-temps, les œuvres des cartes vérifiées s'ajoutent au fur et à mesure. Les ventes sont suivies toutes les 5 min.

Pour limiter l'attente : chaque page de `/collection` ne vérifie que les cartes nécessaires, la page suivante et la précédente sont préparées en arrière-plan, et les comptes Kyara des membres d'un salon sont recherchés dès qu'une commande y est utilisée. Les illustrations des cartes sont jointes aux messages (et gardées dans `data/cache/cartes-lg/`) : Discord n'arrive pas toujours à les charger depuis kyara.games.

### Reconnaissance des comptes Kyara

Il n'y a rien à lier : on se connecte à Kyara avec Discord, et l'avatar Kyara contient l'ID Discord du joueur. Le bot cherche le pseudo Discord de chaque membre sur Kyara et vérifie cet ID. Personne ne peut donc se faire passer pour un autre. Quand `/classement` ou `/profil` est utilisé, le bot analyse les membres qui ont accès au salon (ainsi que chaque nouveau membre à son arrivée). Les comptes reconnus dans le salon sont proposés en premier dans l'autocomplétion de `pseudo`. Les correspondances sont enregistrées dans `data/comptes.json`.

Quand une commande vise un compte Discord pas encore enregistré (le sien, un `membre`, ou un ID Discord tapé dans `pseudo`), le bot fait une recherche approfondie : variantes de ses noms Discord (sans emojis ni symboles, premier mot, sans les chiffres de fin…), sur les 5 classements du site. Le site ne permet pas de chercher directement par ID Discord : c'est l'ID dans l'avatar des résultats qui confirme le bon compte. `/profil` prévient pendant la recherche, puis confirme que le compte est enregistré.

Si un compte n'est pas trouvé (pseudo Kyara très différent du pseudo Discord), il suffit de lancer une fois `/profil pseudo:<pseudo Kyara>` : le bot reconnaît alors le compte. Les comptes Kyara sans avatar Discord ne peuvent pas être reconnus.

### Suivi des ventes

Le site ne publie ni historique ni classement des ventes. Pour le critère « Meilleur vendeur » de `/classement`, le bot note chaque annonce qu'il voit sur le profil d'un joueur, puis, quand elle disparaît du profil ou que son compteur est écoulé, il demande son statut final au site (vendue, expirée ou annulée) et retient le prix de vente. Toutes les 5 min, il relit les profils des membres dont il connaît le compte, pour ne pas manquer de ventes. Les ventes sont donc comptées à partir du moment où le bot suit un membre (stockage : `data/ventes.json`). Une carte vendue entre deux passages, sans que son annonce ait été vue, n'est pas comptée.

### Limites du site

L'API publique de Kyara ne donne pas la liste complète des cartes d'un joueur. Le bot vérifie donc carte par carte, et s'arrête dès que les compteurs du profil permettent de déduire le reste. Une vérification porte sur 1 100 cartes au maximum : ça couvre une œuvre, ou les raretés Épique, Légendaire et Mythique. Pour Commune, Peu commune et Rare, il faut ajouter une `oeuvre`, sauf si le joueur n'en a aucune ou les a toutes. Les envies et les doublons se limitent aux 24 premières cartes que montre le profil public.

Chaque carte vérifiée est mémorisée dans `data/collections/<id du joueur>.json`, même après un redémarrage. Une carte déjà connue n'est plus redemandée au site. Ce qu'on sait d'une rareté est oublié seulement quand son compteur change sur le profil du joueur (nouvelle carte, vente…), ou au bout de 12 h par sécurité.

### Images

- `/profil` est entièrement en images, dessinées par le bot dans le style de la page profil du site ([assets/profilImage.js](assets/profilImage.js)). Elles sont rendues en double résolution (2400 px de large) et envoyées seules, hors embed, pour que Discord les affiche en grand. `/persos fiche` affiche la carte du personnage générée par le site.
- Les listes de cartes (`/manquantes`, `/persos envies`, `doublons`, `nouveautes`) sont accompagnées d'une grille des cartes de la page : illustration, bordure de la couleur de la rareté (arc-en-ciel pour les Mythiques), nom et quantité. Le bot génère ces images avec [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) ([assets/images.js](assets/images.js)), uniquement quand la page est affichée.
- Chaque illustration est téléchargée une seule fois, puis gardée dans `data/cache/cartes/`.
- Les polices sont celles du site : Zen Kaku Gothic New, Unbounded (pseudos et chiffres) et JetBrains Mono (libellés). Elles sont fournies dans [assets/fonts/](assets/fonts/) sous licence SIL OFL, pour un rendu identique sur n'importe quel hébergement.

## Installation

### 1. Application Discord

1. Crée une application sur le [portail développeur Discord](https://discord.com/developers/applications). Dans l'onglet **Bot**, clique sur *Reset Token*, puis active **Server Members Intent** (requis pour `/classement`).
2. Invite le bot avec ce lien, en remplaçant `TON_CLIENT_ID` par l'Application ID. Il donne les permissions Voir les salons, Envoyer des messages, Intégrer des liens et **Joindre des fichiers** (les images sont jointes aux messages) :
   ```
   https://discord.com/oauth2/authorize?client_id=TON_CLIENT_ID&scope=bot+applications.commands&permissions=52224
   ```
3. Crée un fichier `.env` à la racine du projet :
   ```
   DISCORD_TOKEN=le token du bot
   CLIENT_ID=l'application id
   GUILD_ID=l'id de ton serveur Discord (facultatif : sans, les commandes sont globales et mettent jusqu'à 1 h à apparaître)
   ```

### 2. Lancement

Node.js 20 ou plus est requis.

```sh
npm install        # installe les dépendances
npm run deploy     # enregistre les commandes slash (1re fois et après chaque modification de commande)
npm start          # lance le bot
```

Ne lance pas le bot à deux endroits à la fois avec le même token. À l’arrêt (Ctrl+C…), le bot termine d'écrire ses données avant de quitter.

Le dossier `data/` (comptes reconnus, favoris, ventes suivies, collections analysées, cache des images) est créé automatiquement au premier lancement. Garde-le ensuite : le supprimer fait repartir le bot de zéro.

## Fonctionnement

Le site est une application SvelteKit : ses pages chargent leurs données depuis `https://kyara.games/api/...`. Le bot interroge ces mêmes routes publiques ([assets/kyara.js](assets/kyara.js)) :

- un cache de 1 min à 1 h selon les données ; le catalogue complet (~6 700 persos) est téléchargé une fois par heure et la recherche se fait en local ;
- 6 requêtes simultanées au maximum, avec une pause automatique avant d'atteindre le quota du site (2 000 requêtes par minute) ;
- en cas de panne du site, la dernière réponse en cache est réutilisée.

Ces routes ne sont pas une API officielle documentée : elles peuvent changer sans préavis. Le `robots.txt` du site exclut `/api/` des robots d'indexation. Si le bot doit tourner sur de gros serveurs, préviens l'équipe Kyara.

### Ajouter une commande

Crée un fichier dans `assets/commands/` qui exporte `data` (un `SlashCommandBuilder`), `execute(interaction)` et, si besoin, `autocomplete(interaction)` qui renvoie une liste de `{ name, value }`. Pour répondre sur plusieurs pages, construis les embeds puis appelle `sendPages(interaction, pages)` ([assets/pages.js](assets/pages.js)).
