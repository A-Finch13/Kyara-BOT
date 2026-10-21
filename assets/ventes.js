// Suivi des ventes des joueurs, pour le classement « Meilleur vendeur ».
//
// Le site ne publie ni historique ni classement des ventes. Le bot note donc chaque annonce qu'il voit
// sur un profil, puis, quand elle disparaît du profil ou que son compteur est écoulé, il demande son
// statut final au site (vendue, expirée ou annulée). Les ventes sont comptées à partir du moment où
// le bot suit le joueur. Stockage : data/ventes.json.

import { getProfile, knownAccount } from './comptes.js';
import { kyara } from './kyara.js';
import { jsonStore } from './store.js';

const store = jsonStore('ventes'); // { [idAnnonce]: { seller, price, endsAt, status, finalPrice?, seen } }
const TRACK_EVERY = 5 * 60_000;

// Note les annonces en cours d'un profil (appelé à chaque lecture de profil).
export async function trackListings(profile) {
  if (!profile?.listings?.length) return;
  const all = await store.load();
  let changed = false;
  for (const l of profile.listings) {
    if (all[l.id]) continue;
    all[l.id] = { seller: profile.id, price: l.price, endsAt: l.endsAt ?? null, status: 'active', seen: Date.now() };
    changed = true;
  }
  if (changed) await store.save();
}

// Statut final des annonces d'un vendeur qui ne sont plus sur son profil, ou dont le compteur est écoulé.
async function settleSeller(profile) {
  const all = await store.load();
  const current = new Set((profile.listings ?? []).map((l) => l.id));
  const now = Date.now();
  const pending = Object.entries(all).filter(
    ([id, v]) => v.seller === profile.id && v.status === 'active' && (!current.has(id) || (v.endsAt && new Date(v.endsAt) < now)),
  );
  if (!pending.length) return;
  const results = await Promise.all(pending.map(([id]) => kyara.listing(id).catch(() => null)));
  let changed = false;
  pending.forEach(([id, v], i) => {
    const l = results[i];
    if (!l || l.status === 'active') return; // encore en cours (ex. enchère sur le point de se clore)
    v.status = l.status; // sold, expired ou cancelled
    if (l.status === 'sold') v.finalPrice = l.finalPrice ?? l.currentBid ?? l.price;
    changed = true;
  });
  if (changed) await store.save();
}

// { count, chakra } : nombre de cartes vendues et chakra gagné, depuis que le bot suit ce joueur.
export async function salesStats(profile) {
  await trackListings(profile);
  await settleSeller(profile);
  const all = await store.load();
  let count = 0;
  let chakra = 0;
  for (const v of Object.values(all)) {
    if (v.seller !== profile.id || v.status !== 'sold') continue;
    count++;
    chakra += v.finalPrice ?? v.price ?? 0;
  }
  return { count, chakra };
}

// Toutes les 5 min, relit les profils des membres dont le compte Kyara est connu, pour repérer
// les nouvelles annonces et les ventes même quand personne n'utilise de commande.
export function startSalesTracker(client) {
  const round = async () => {
    const seen = new Set();
    for (const guild of client.guilds.cache.values()) {
      for (const member of guild.members.cache.values()) {
        if (member.user.bot) continue;
        const acc = await knownAccount(member.id);
        if (!acc || seen.has(acc.kyaraId)) continue;
        seen.add(acc.kyaraId);
        try {
          await settleSeller(await getProfile(acc.kyaraId)); // getProfile note déjà les annonces
        } catch {
          // site indisponible ou compte supprimé : on réessaiera au prochain tour
        }
      }
    }
  };
  setInterval(() => round().catch(() => {}), TRACK_EVERY).unref?.();
  round().catch(() => {});
}

// Oublie les annonces suivies d'un vendeur (suppression des données à sa demande).
export async function forgetSeller(kyaraId) {
  const all = await store.load();
  const ids = Object.keys(all).filter((id) => all[id].seller === kyaraId);
  for (const id of ids) delete all[id];
  if (ids.length) await store.save();
}
