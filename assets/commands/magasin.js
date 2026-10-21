import { SlashCommandBuilder } from 'discord.js';
import { getProfile, isVisible, privateMessage, playerChoices, profileFingerprint, resolveTarget, targetOptions } from '../comptes.js';
import { withLargeArt } from '../images.js';
import { chakra, profileUrl, RARITIES, ts, wikiUrl } from '../kyara.js';
import { baseEmbed, characterControl, matchesCharacter, sendView } from '../pages.js';

const TYPES = [
  { label: 'Tout', value: null, emoji: '🏪' },
  { label: 'Ventes et enchères', value: 'ventes', emoji: '🛒' },
  { label: 'Ordres d’achat', value: 'achats', emoji: '📥' },
];

export const data = targetOptions(
  new SlashCommandBuilder()
    .setName('magasin')
    .setDescription('Les ventes, enchères et ordres d’achat d’un joueur, carte par carte')
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Tout afficher (par défaut) ou un seul type')
        .addChoices(...TYPES.filter((t) => t.value).map((t) => ({ name: t.label, value: t.value }))),
    ),
);

export const autocomplete = (interaction) => playerChoices(interaction.options.getFocused(), interaction);

// Une annonce du profil → { card, lines } (le prix et les détails propres à chaque type).
function listingEntry(l) {
  if (l.type === 'auction') {
    const lines = [`🔨 **Enchère** — ${chakra(l.price)}`];
    if (l.buyoutPrice) lines.push(`⚡ Achat immédiat : **${chakra(l.buyoutPrice)}**`);
    lines.push(`👥 ${l.bids ?? 0} enchère(s) · fin ${ts(l.endsAt)}`);
    return { card: l.card, lines, endsAt: l.endsAt };
  }
  const lines = [`🛒 **Vente** — ${chakra(l.price)}`];
  if (l.endsAt) lines.push(`⏳ Fin ${ts(l.endsAt)}`);
  return { card: l.card, lines, endsAt: l.endsAt };
}

const orderEntry = (o) => ({
  card: o.card,
  lines: [`📥 **Ordre d’achat** — ${chakra(o.price)}${o.remaining > 1 ? ` (×${o.remaining})` : ''}`],
});

export async function execute(interaction) {
  await interaction.deferReply();
  const target = await resolveTarget(interaction);
  if (target.error) return interaction.editReply(target.error);

  let u = await getProfile(target.id, { fresh: true });
  if (!isVisible(u, 'market')) return interaction.editReply(privateMessage(u, 'son activité sur le marché'));
  const author = { name: `Magasin de ${u.pseudo}`, iconURL: u.avatar ?? undefined, url: profileUrl(u.id) };

  const build = async ({ type, perso }) => {
    u = await getProfile(target.id, { fresh: true }); // données à jour à chaque reconstruction (la collection change vite)
    // Les annonces déjà terminées (compteur écoulé) ne sont plus affichées.
    const now = Date.now();
    const entries = [
      ...(type === 'achats' ? [] : (u.listings ?? []).map(listingEntry).filter((e) => !e.endsAt || new Date(e.endsAt) > now)),
      ...(type === 'ventes' ? [] : (u.buyOrders ?? []).map(orderEntry)),
    ].filter((e) => matchesCharacter(e.card, perso));
    if (!entries.length) {
      const what = { ventes: 'aucune carte en vente', achats: 'aucun ordre d’achat' }[type] ?? 'rien sur le marché';
      const filtre = perso ? ` correspondant à « ${perso} »` : '';
      return [baseEmbed().setAuthor(author).setDescription(`📭 **${u.pseudo}** n’a ${what}${filtre} en ce moment.`)];
    }
    return {
      count: entries.length,
      get: (i) => {
        const { card, lines } = entries[i];
        const r = RARITIES[card.rarity];
        const embed = baseEmbed()
          .setColor(r?.color ?? null)
          .setAuthor(author)
          .setTitle(card.name)
          .setURL(wikiUrl(card.id))
          .setDescription([r ? `${r.emoji} **${r.label}**` : card.rarity, ...lines].join('\n'))
          .setFooter({ text: 'kyara.games' });
        return withLargeArt(embed, card); // illustration jointe au message : toujours affichée
      },
    };
  };

  return sendView(interaction, {
    // Si le joueur a ouvert un booster, vendu ou acheté entre-temps, la réponse se met à jour au prochain clic.
    stale: async () => profileFingerprint(await getProfile(target.id, { fresh: true })) !== profileFingerprint(u),
    values: { type: interaction.options.getString('type') },
    controls: [{ name: 'type', placeholder: 'Type', options: TYPES }, characterControl],
    build,
  });
}
