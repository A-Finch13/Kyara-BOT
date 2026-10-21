# Politique de confidentialité de Kyara BOT

*Dernière mise à jour : 21 octobre 2026*

Kyara BOT est un bot Discord non officiel qui affiche dans Discord les données publiques du jeu de cartes Kyara (profils, collections, personnages, ventes, classements). Cette page explique quelles données il utilise, pourquoi, combien de temps il les garde, et comment les faire supprimer.

## Données utilisées

**Données Discord**
- **Identifiant Discord** des membres, pour relier un compte Discord à un compte Kyara.
- **Nom d'utilisateur, nom affiché et surnom sur le serveur**, utilisés uniquement le temps d'une recherche (voir plus bas). Ils ne sont **pas** enregistrés.
- **Liste des membres d'un serveur et leurs permissions sur un salon** (Server Members Intent), lue quand une commande est utilisée dans ce salon, pour savoir quels membres apparaissent dans `/classement`. Cette liste n'est pas enregistrée.
- **Photo de profil Discord**, affichée dans les images de classement et de profil.
- **Options des commandes** que tu utilises (pseudo cherché, œuvre, rareté…).

Le bot **ne lit pas** le contenu des messages et **n'utilise pas** les présences (statut, activité).

**Données Kyara**
Le bot lit uniquement les données **publiques** du site Kyara : profils, collections, envies, doublons, annonces de vente et classements. Il respecte les profils privés : il n'affiche pas ce qu'un joueur a masqué.

## Comment les comptes sont reliés

On se connecte à Kyara avec son compte Discord, et l'avatar Kyara est celui de Discord : son adresse contient l'identifiant Discord. Pour trouver le compte Kyara d'un membre, le bot cherche son nom dans la recherche publique de joueurs du site Kyara. Il ne garde un résultat que si l'avatar contient l'identifiant Discord de ce membre. Aucune liaison manuelle n'est nécessaire, et personne ne peut se faire passer pour un autre.

## Données enregistrées et durée de conservation

Les données sont enregistrées dans des fichiers **chiffrés (AES-256-GCM)** sur la machine qui héberge le bot, lisibles uniquement par le compte qui fait tourner le bot.

| Donnée | Pourquoi | Durée |
|---|---|---|
| Identifiant Discord → identifiant et pseudo Kyara | Reconnaître ton compte sans refaire la recherche | Effacé après **30 jours** sans être revu ni utilisé |
| Identifiant Discord → « aucun compte trouvé » + date | Éviter de refaire la recherche à chaque fois | Revérifié après 3 jours, effacé après **30 jours** |
| Date de ta dernière commande | Calculer la durée de conservation | Effacée après **30 jours** sans commande |
| Tes œuvres favorites (`/favoris`) | Faire fonctionner `/favoris` et `/manquantes` | Effacées après **30 jours** sans commande |
| Identifiant Discord + date d'une demande de suppression | Ne plus relier ton compte automatiquement, comme tu l'as demandé | Jusqu'à ce que tu utilises `/profil` sur toi-même |
| Cartes vérifiées de la collection publique d'un joueur Kyara | Éviter de redemander chaque carte au site | Données Kyara, sans lien avec Discord |
| Annonces de vente publiques vues sur les profils Kyara (prix, statut) | Classement « Meilleur vendeur » | Données Kyara, sans lien avec Discord |
| Images des cartes Kyara | Accélérer l'affichage | Cache |

Le bot n'enregistre **ni messages, ni listes de membres, ni noms d'utilisateur Discord, ni adresses e-mail**.

## Partage

Les données ne sont **ni vendues, ni partagées**. Le seul envoi vers l'extérieur de Discord concerne les recherches de noms faites dans la recherche publique de joueurs du site Kyara, le service que le bot sert. Les résultats des commandes sont visibles par les membres du salon où la commande a été utilisée.

## Voir et supprimer tes données

- **`/donnees voir`** affiche tout ce que le bot a enregistré sur ton compte Discord (visible par toi seul).
- **`/donnees supprimer`** efface immédiatement, après confirmation, le lien avec ton compte Kyara, tes favoris, ta date d'activité, et ce que le bot avait noté de la collection et des ventes du compte Kyara relié. Ton compte n'est ensuite plus relié automatiquement (par exemple dans `/classement`) ; seule ta demande est gardée pour cela. Pour être reconnu à nouveau, utilise `/profil` sur toi-même.

Tu peux aussi demander la suppression sur https://github.com/A-Finch13/Kyara-BOT/issues en indiquant ton identifiant Discord.

Si tu rends ton profil privé sur Kyara, le bot n'affiche plus les parties masquées.

## Modifications

Cette politique peut évoluer avec le bot. La date en haut de la page indique la dernière mise à jour.

## Contact

https://github.com/A-Finch13/Kyara-BOT/issues
