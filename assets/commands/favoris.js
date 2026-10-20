import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { seriesChoices } from '../autocomplete.js';
import { findAccount, getProfile, isVisible } from '../comptes.js';
import { addFavori, getFavoris, MAX_FAVORIS, removeFavori } from '../favoris.js';
import { bar, listSeries, normalize, truncate } from '../kyara.js';
import { baseEmbed, sendPages } from '../pages.js';
import { seriesProgress } from '../scan.js';

export const data = new SlashCommandBuilder()
  .setName('favoris')
  .setDescription('Gère tes œuvres favorites (utilisées par /manquantes)')
  .addSubcommand((s) =>
    s
      .setName('ajouter')
      .setDescription('Ajoute une œuvre à tes favoris, même si elle n’est pas encore sur Kyara')
      .addStringOption((o) =>
        o.setName('oeuvre').setDescription('L’œuvre à ajouter').setRequired(true).setMaxLength(100).setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('retirer')
      .setDescription('Retire une œuvre de tes favoris')
      .addStringOption((o) => o.setName('oeuvre').setDescription('L’œuvre à retirer').setRequired(true).setAutocomplete(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('liste')
      .setDescription('Affiche les œuvres favorites d’un membre et sa progression')
      .addUserOption((o) => o.setName('membre').setDescription('Un membre du serveur (toi par défaut)')),
  );

// Œuvre du catalogue qui correspond exactement à ce qui a été tapé (ou choisi dans l'autocomplétion).
async function catalogSeries(input) {
  const q = normalize(input);
  const all = await listSeries();
  return (
    all.find((s) => normalize(s.name) === q) ??
    // Les noms de plus de 100 caractères sont tronqués dans l'autocomplétion.
    (input.length >= 100 ? all.find((s) => normalize(s.name).startsWith(q)) : null) ??
    null
  );
}

export async function autocomplete(interaction) {
  const query = interaction.options.getFocused();
  if (interaction.options.getSubcommand() === 'retirer') {
    const known = new Set((await listSeries()).map((s) => normalize(s.name)));
    return (await getFavoris(interaction.user.id))
      .filter((f) => normalize(f).includes(normalize(query)))
      .slice(0, 25)
      .map((f) => ({ name: truncate(known.has(normalize(f)) ? f : `${f} (personnalisée)`, 100), value: f.slice(0, 100) }));
  }
  const choices = await seriesChoices(query);
  // Toujours proposer d'ajouter le texte tapé tel quel s'il ne correspond à aucune œuvre.
  const typed = query.trim();
  if (typed && !(await catalogSeries(typed))) {
    choices.splice(24, 1);
    choices.unshift({ name: truncate(`➕ « ${typed} » (série personnalisée)`, 100), value: typed.slice(0, 100) });
  }
  return choices.slice(0, 25);
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const me = interaction.user.id;

  if (sub === 'ajouter') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const input = interaction.options.getString('oeuvre').trim().replace(/\s+/g, ' ');
    if (!input) return interaction.editReply('❌ Donne le nom d’une œuvre.');
    const series = await catalogSeries(input);
    const name = series?.name ?? input;
    const res = await addFavori(me, name);
    if (res === 'deja') return interaction.editReply(`**${name}** est déjà dans tes favoris.`);
    if (res === 'plein') return interaction.editReply(`❌ Tu as déjà ${MAX_FAVORIS} favoris : retires-en un d’abord.`);
    return interaction.editReply(
      series
        ? `⭐ **${name}** ajoutée à tes favoris. Vois ce qu’il te manque avec \`/manquantes\`.`
        : `✨ **${name}** ajoutée à tes favoris comme **série personnalisée** : elle n’est pas encore sur Kyara. ` +
            'Ta progression s’affichera toute seule le jour où elle arrivera sur le site (avec ce nom exact).',
    );
  }

  if (sub === 'retirer') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const input = interaction.options.getString('oeuvre');
    const favoris = await getFavoris(me);
    const name =
      favoris.find((f) => f === input) ??
      favoris.find((f) => normalize(f) === normalize(input)) ??
      favoris.find((f) => normalize(f).startsWith(normalize(input)));
    if (!name || !(await removeFavori(me, name))) return interaction.editReply(`**${input}** n’est pas dans tes favoris.`);
    return interaction.editReply(`🗑️ **${name}** retirée de tes favoris.`);
  }

  // liste
  await interaction.deferReply();
  const user = interaction.options.getUser('membre') ?? interaction.user;
  const favoris = await getFavoris(user.id);
  const embed = baseEmbed()
    .setAuthor({ name: user.displayName ?? user.username, iconURL: user.displayAvatarURL() })
    .setTitle(`⭐ Œuvres favorites (${favoris.length}/${MAX_FAVORIS})`)
    .setFooter({ text: 'kyara.games' });
  if (!favoris.length) {
    embed.setDescription(user.id === me ? 'Aucune œuvre en favoris. Ajoute-en avec `/favoris ajouter`.' : 'Aucune œuvre en favoris.');
    return sendPages(interaction, [embed]);
  }

  const custom = (name) => `✨ **${name}** — *série personnalisée (pas encore sur Kyara)*`;
  // Progression si on connaît le compte Kyara du membre.
  const member = user.id === me ? interaction.member : interaction.options.getMember('membre');
  const acc = await findAccount(user, member).catch(() => null);
  const u = acc ? await getProfile(acc.kyaraId, { fresh: true }) : null;
  if (u && isVisible(u, 'collection')) {
    const progress = await seriesProgress(u, favoris);
    embed.setDescription(
      progress
        .map((p) =>
          p.gone
            ? custom(p.name)
            : `${bar(p.owned.size, p.cards.length, 10)} **${p.name}** : ${p.owned.size}/${p.cards.length}${p.owned.size >= p.cards.length ? ' ✅' : ''}`,
        )
        .join('\n')
        .slice(0, 4096),
    );
  } else {
    const known = new Set((await listSeries()).map((s) => normalize(s.name)));
    embed.setDescription(
      favoris.map((f) => (known.has(normalize(f)) ? `• **${f}**` : custom(f))).join('\n') + (u ? '\n\n-# 🔒 Collection masquée.' : ''),
    );
  }
  return sendPages(interaction, [embed]);
}
