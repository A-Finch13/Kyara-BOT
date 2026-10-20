// Fait le lien entre les comptes Discord et les comptes Kyara.
//
// On se connecte à Kyara avec Discord, et l'avatar Kyara est celui de Discord :
//   https://cdn.discordapp.com/avatars/<ID Discord>/<hash>.webp
// Il suffit donc de chercher le pseudo d'un membre sur Kyara et de comparer l'ID dans l'avatar :
// aucune liaison manuelle, et personne ne peut se faire passer pour un autre.

import { PermissionFlagsBits } from 'discord.js';
import { kyara, truncate } from './kyara.js';
import { jsonStore } from './store.js';
import { trackListings } from './ventes.js';

const store = jsonStore('comptes'); // { [discordId]: { kyaraId, pseudo, at } | { none: true, at } }
const RECHECK_MS = 3 * 24 * 60 * 60_000; // un membre sans compte trouvé est recherché à nouveau après 3 jours
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function discordIdFromAvatar(avatar) {
  return avatar?.match(/cdn\.discordapp\.com\/avatars\/(\d+)\//)?.[1] ?? null;
}

// Mémorise au passage tout joueur Kyara dont l'avatar révèle le compte Discord.
async function remember(players) {
  const all = await store.load();
  let changed = false;
  for (const p of players) {
    const discordId = discordIdFromAvatar(p?.avatar);
    if (!discordId) continue;
    const cur = all[discordId];
    if (cur?.kyaraId === p.id && cur.pseudo === p.pseudo) continue;
    all[discordId] = { kyaraId: p.id, pseudo: p.pseudo, at: Date.now() };
    changed = true;
  }
  if (changed) await store.save();
}

// Recherche de joueurs par pseudo (via le classement du site, 10 résultats max).
export async function searchPlayers(query) {
  const q = query.trim();
  const res = q ? await kyara.ladder('collection', q) : await kyara.ladder('collection');
  const players = (q ? res.found : res.rows) ?? [];
  remember(players).catch(() => {});
  return players;
}

// Empreinte de ce qui change quand un joueur ouvre un booster, vend, achète ou modifie ses envies.
export const profileFingerprint = (u) =>
  JSON.stringify([
    u.owned,
    u.byRarity,
    u.doublesCount,
    u.wishlistCount,
    (u.listings ?? []).map((l) => [l.id, l.price, l.bids]),
    (u.buyOrders ?? []).map((o) => [o.id, o.price, o.remaining]),
  ]);

// fresh: true → profil relu sur le site (à utiliser au lancement d'une commande).
export async function getProfile(kyaraId, { fresh = false } = {}) {
  const u = await kyara.user(kyaraId, { fresh });
  remember([u]).catch(() => {});
  trackListings(u).catch(() => {}); // suivi des ventes (classement « Meilleur vendeur »)
  return u;
}

// Suggestions de joueurs : d'abord les membres du salon dont on connaît le compte Kyara,
// puis la recherche sur le site.
export async function playerChoices(query, interaction = null) {
  const q = query.trim().toLowerCase();
  const choices = [];
  if (interaction?.inGuild() && interaction.channel) {
    const { accounts } = await channelAccounts(interaction.channel, { fetch: false }).catch(() => ({ accounts: [] }));
    for (const a of accounts) {
      const name = a.member.displayName ?? a.member.user.username;
      if (q && !a.pseudo.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) continue;
      choices.push({ name: truncate(`${a.pseudo} · ${name} (ce salon)`, 100), value: a.kyaraId });
    }
  }
  if (q.length >= 2) {
    const seen = new Set(choices.map((c) => c.value));
    for (const p of await searchPlayers(query)) {
      if (!seen.has(p.id)) choices.push({ name: truncate(`${p.pseudo} (#${p.pos})`, 100), value: p.id });
    }
  }
  return choices.slice(0, 25);
}

// Option "pseudo" : un ID (choisi via l'autocomplétion) ou un pseudo tapé à la main.
// Renvoie { id } si le pseudo désigne un joueur sans ambiguïté (pseudo exact, ou un seul résultat),
// sinon { suggestions } : on ne choisit jamais un autre joueur au hasard.
export async function resolvePlayerId(input) {
  const trimmed = input.trim();
  if (UUID.test(trimmed)) return { id: trimmed };
  const players = await searchPlayers(trimmed);
  const exact = players.find((p) => p.pseudo.toLowerCase() === trimmed.toLowerCase());
  if (exact) return { id: exact.id };
  if (players.length === 1) return { id: players[0].id };
  return { suggestions: players.slice(0, 5).map((p) => p.pseudo) };
}

// Noms sous lesquels un membre a pu s'inscrire sur Kyara, du plus précis au plus large.
// En mode approfondi, on ajoute des variantes : sans symboles ni emojis, premier mot, plus long mot…
function candidateNames(user, member, deep) {
  const names = [user.username, user.globalName, member?.nickname ?? member?.nick, member?.displayName];
  const out = new Set();
  const add = (n) => {
    n = n?.trim();
    if (n && n.length >= 2) out.add(n);
  };
  for (const n of names) {
    if (!n) continue;
    add(n);
    if (n.includes(' ')) add(n.replace(/\s+/g, '_'));
    if (!deep) continue;
    const clean = n.normalize('NFKC').replace(/[^\p{L}\p{N}_\-. ]/gu, '').trim(); // sans emojis ni symboles
    add(clean);
    add(clean.replace(/\s+/g, '_'));
    add(clean.replace(/\s+/g, ''));
    const words = clean.split(/[\s_.\-]+/).filter((w) => w.length >= 3);
    add(words[0]);
    add([...words].sort((a, b) => b.length - a.length)[0]);
    add(clean.replace(/\d+$/, '')); // sans les chiffres de fin
  }
  return [...out].slice(0, deep ? 10 : 4);
}

const pending = new Map(); // discordId -> promesse en cours
const LADDER_KINDS = ['collection', 'prestige', 'mythics', 'series', 'achievements'];

// Cherche un nom sur Kyara et renvoie le joueur dont l'avatar contient cet ID Discord.
// La recherche du site ne renvoie que 10 joueurs, triés selon le classement demandé :
// en mode approfondi, on la refait sur chaque classement pour élargir les résultats.
async function searchFor(name, discordId, deep) {
  for (const by of deep ? LADDER_KINDS : ['collection']) {
    const res = await kyara.ladder(by, name).catch(() => null);
    const players = res?.found ?? [];
    await remember(players);
    if (players.some((p) => discordIdFromAvatar(p.avatar) === discordId)) return true;
    if (players.length < 10) return false; // tous les résultats ont déjà été vus
  }
  return false;
}

// Renvoie { kyaraId, pseudo } pour un membre Discord, ou null s'il n'a pas de compte Kyara détectable.
// deep : recherche approfondie (plus de variantes de noms et tous les classements), ignore le cache négatif.
export async function findAccount(user, member = null, { force = false, deep = false } = {}) {
  const all = await store.load();
  const cur = all[user.id];
  if (cur?.kyaraId) return cur;
  if (cur?.none && !force && !deep && Date.now() - cur.at < RECHECK_MS) return null;
  const key = `${user.id}:${deep}`;
  if (pending.has(key)) return pending.get(key);

  const job = (async () => {
    for (const name of candidateNames(user, member, deep)) {
      if (await searchFor(name, user.id, deep)) return all[user.id];
    }
    all[user.id] = { none: true, at: Date.now() };
    await store.save();
    return null;
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

export async function knownAccount(discordId) {
  const acc = (await store.load())[discordId];
  return acc?.kyaraId ? acc : null;
}

// Ajoute les options communes "membre" et "pseudo" à une commande ou sous-commande.
export function targetOptions(builder) {
  return builder
    .addUserOption((o) => o.setName('membre').setDescription('Un membre du serveur (toi par défaut)'))
    .addStringOption((o) =>
      o.setName('pseudo').setDescription('Pseudo Kyara de n’importe quel joueur, ou un ID Discord').setAutocomplete(true),
    );
}

// Joueur visé par une commande : option "pseudo" (pseudo Kyara, ID Discord ou mention), sinon "membre", sinon l’auteur.
// Pour un compte Discord encore inconnu, recherche approfondie par ID Discord, que la commande vise
// l'auteur, un « membre » ou un ID Discord tapé dans « pseudo ». onSearch(user, self) permet à la
// commande de prévenir pendant la recherche. Renvoie { id, discordId, found? } ou { error }.
export async function resolveTarget(interaction, { onSearch = null } = {}) {
  const pseudo = interaction.options.getString('pseudo')?.trim();
  let user = interaction.options.getUser('membre');
  let member = user ? interaction.options.getMember('membre') : null;

  if (pseudo) {
    // Un ID Discord (ou une mention <@id>) tapé dans « pseudo » : on cherche ce compte Discord.
    const m = pseudo.match(/^<@!?(\d{17,20})>$|^(\d{17,20})$/);
    const discordId = m?.[1] ?? m?.[2];
    if (discordId) {
      user = await interaction.client?.users.fetch(discordId).catch(() => null);
      if (!user) return { error: `❌ Aucun compte Discord trouvé avec l’ID \`${discordId}\`.` };
      member = await interaction.guild?.members.fetch(discordId).catch(() => null);
    } else {
      const { id, suggestions } = await resolvePlayerId(pseudo);
      if (id) return { id, discordId: null };
      if (!suggestions.length) return { error: `❌ Aucun joueur Kyara trouvé pour « ${pseudo} ».` };
      return {
        error:
          `❌ Aucun joueur ne s’appelle exactement « ${pseudo} ». ` +
          `Tu cherches peut-être : ${suggestions.map((p) => `**${p}**`).join(', ')} ?\n` +
          '-# Choisis le joueur dans les suggestions qui s’affichent pendant la saisie de `pseudo`.',
      };
    }
  }

  user ??= interaction.user;
  const self = user.id === interaction.user.id;
  if (self) member = interaction.member;
  if (user.bot) return { error: '🤖 Les bots ne jouent pas à Kyara.' };
  const known = await knownAccount(user.id);
  if (known) return { id: known.kyaraId, discordId: user.id };

  // Compte encore inconnu : recherche approfondie à partir de l'ID Discord.
  await onSearch?.(user, self);
  const acc = await findAccount(user, member, { force: true, deep: true });
  if (acc) return { id: acc.kyaraId, discordId: user.id, found: true };
  return {
    error: self
      ? '❌ Je n’ai trouvé aucun compte Kyara relié à ton compte Discord.\n' +
        '-# Vérifie que tu t’es connecté à Kyara avec ce compte Discord. Si ton pseudo Kyara est très différent de ton pseudo Discord, ' +
        'lance une fois `/profil pseudo:<ton pseudo Kyara>` : je reconnaîtrai ensuite ton compte automatiquement.'
      : `❌ Je n’ai trouvé aucun compte Kyara relié au compte Discord de ${user}.\n` +
        '-# Son pseudo Kyara est peut-être très différent : utilise plutôt l’option `pseudo` avec son pseudo Kyara.',
  };
}

export const isVisible = (user, block) => !user.blocks?.find((b) => b.id === block)?.hidden;

// --- Détection des membres qui ont accès à un salon (pour /classement et /profil) ---

const lastFetch = new Map(); // guildId -> date du dernier fetch complet des membres

// fetch: false = seulement les membres déjà en cache (pour l'autocomplétion, qui doit répondre vite).
async function guildMembers(guild, { fetch = true } = {}) {
  if (fetch && Date.now() - (lastFetch.get(guild.id) ?? 0) > 10 * 60_000) {
    await guild.members.fetch();
    lastFetch.set(guild.id, Date.now());
  }
  return guild.members.cache.filter((m) => !m.user.bot);
}

async function scan(members) {
  // 4 membres à la fois : la limite globale de kyara.js régule le reste.
  for (let i = 0; i < members.length; i += 4) {
    await Promise.all(members.slice(i, i + 4).map((m) => findAccount(m.user, m).catch(() => null)));
  }
  return members;
}

// Membres (hors bots) qui peuvent voir ce salon.
export async function channelMembers(channel, opts) {
  const members = await guildMembers(channel.guild, opts);
  return members.filter((m) => channel.permissionsFor(m)?.has(PermissionFlagsBits.ViewChannel));
}

// Recherche les comptes Kyara des membres qui ont accès au salon (une recherche à la fois par salon).
const channelJobs = new Map(); // channelId -> promesse
export function detectChannel(channel) {
  if (channelJobs.has(channel.id)) return channelJobs.get(channel.id);
  const job = channelMembers(channel)
    .then((members) => scan([...members.values()]))
    .finally(() => channelJobs.delete(channel.id));
  channelJobs.set(channel.id, job);
  return job;
}

// Comptes Kyara connus des membres qui ont accès au salon.
export async function channelAccounts(channel, opts) {
  const all = await store.load();
  const members = await channelMembers(channel, opts);
  const accounts = [];
  for (const m of members.values()) if (all[m.id]?.kyaraId) accounts.push({ member: m, ...all[m.id] });
  return { members, accounts };
}
