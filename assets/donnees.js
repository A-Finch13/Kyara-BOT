// Durée de conservation des données liées aux comptes Discord, et suppression à la demande.
//
// Tout ce qui est lié à un identifiant Discord est effacé après 30 jours sans activité :
// - lien Discord ↔ Kyara : 30 jours après la dernière fois qu'il a été revu ou utilisé ;
// - favoris et date de dernière activité : 30 jours après la dernière commande du membre.
// Stockage de l'activité : data/activite.json ({ [discordId]: date de la dernière commande }).

import { accountRecord, forgetAccount, purgeAccounts } from './comptes.js';
import { favorisOwners, forgetFavoris, getFavoris } from './favoris.js';
import { forgetPlayer } from './scan.js';
import { jsonStore } from './store.js';
import { forgetSeller } from './ventes.js';

export const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60_000;
const TOUCH_EVERY = 60 * 60_000; // la date d'activité est notée au plus une fois par heure
const PURGE_EVERY = 6 * 60 * 60_000;

const activity = jsonStore('activite');

// Note qu'un membre vient d'utiliser une commande.
export async function touch(discordId) {
  const all = await activity.load();
  if (Date.now() - (all[discordId] ?? 0) < TOUCH_EVERY) return;
  all[discordId] = Date.now();
  await activity.save();
}

export async function lastActive(discordId) {
  return (await activity.load())[discordId] ?? 0;
}

async function purge() {
  const seen = await activity.load();
  const limit = Date.now() - RETENTION_MS;
  let changed = false;

  // Favoris enregistrés avant le suivi d'activité : le délai démarre maintenant.
  for (const id of await favorisOwners()) {
    if (seen[id]) continue;
    seen[id] = Date.now();
    changed = true;
  }
  let removed = await purgeAccounts(RETENTION_MS, (id) => seen[id] ?? 0);
  for (const id of await favorisOwners()) {
    if (seen[id] < limit && (await forgetFavoris(id))) removed++;
  }
  for (const [id, at] of Object.entries(seen)) {
    if (at >= limit) continue;
    delete seen[id];
    changed = true;
  }
  if (changed) await activity.save();
  if (removed) console.log(`🧹 Durée de conservation : ${removed} donnée(s) de plus de ${RETENTION_DAYS} jours effacée(s)`);
}

export function startRetention() {
  setInterval(() => purge().catch((err) => console.warn('⚠️ Purge des données :', err.message)), PURGE_EVERY).unref?.();
  purge().catch((err) => console.warn('⚠️ Purge des données :', err.message));
}

// Tout ce que le bot a enregistré sur un compte Discord.
export async function userData(discordId) {
  return {
    account: await accountRecord(discordId),
    favoris: await getFavoris(discordId),
    lastActive: await lastActive(discordId),
  };
}

// Efface tout ce qui est lié à ce compte Discord : lien Kyara, favoris, activité, et ce que le bot
// avait noté de la collection et des ventes du compte Kyara relié. Le compte n'est plus relié
// automatiquement ensuite (seul son identifiant Discord est gardé, avec cette demande).
export async function deleteUserData(discordId) {
  const kyaraId = await forgetAccount(discordId);
  await forgetFavoris(discordId);
  const all = await activity.load();
  if (discordId in all) {
    delete all[discordId];
    await activity.save();
  }
  if (kyaraId) {
    await forgetPlayer(kyaraId);
    await forgetSeller(kyaraId);
  }
  return { kyaraId };
}
