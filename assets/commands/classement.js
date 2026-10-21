import { SlashCommandBuilder } from 'discord.js';
import { channelAccounts, detectChannel, getProfile, isVisible } from '../comptes.js';
import { classementImage } from '../classementImage.js';
import { fmt, kyara, LADDERS } from '../kyara.js';
import { baseEmbed, sendPages } from '../pages.js';
import { salesStats } from '../ventes.js';

// Critères du classement : ceux du site (via son classement) et ceux tirés du profil des joueurs.
const CRITERIA = {
  collection: { ...LADDERS.collection, source: 'ladder' },
  prestige: { ...LADDERS.prestige, source: 'ladder' },
  mythics: { ...LADDERS.mythics, source: 'ladder' },
  series: { ...LADDERS.series, label: 'Collections finies', source: 'ladder' },
  achievements: { ...LADDERS.achievements, source: 'ladder' },
  boosters: { label: 'Boosters ouverts', unit: 'boosters', source: 'profile', get: (u) => (isVisible(u, 'stats') ? u.boostersOpened : null) }, // profil privé : non classé
  doubles: { label: 'Doublons', unit: 'doublons', source: 'profile', get: (u) => (isVisible(u, 'doubles') ? u.doublesCount : null) },
  // Suivi par le bot (le site ne publie pas les ventes) : nombre de cartes vendues, puis chakra gagné.
  ventes: {
    label: 'Meilleur vendeur',
    unit: 'ventes',
    source: 'sales',
    title: 'Les 10 meilleurs vendeurs du serveur',
    format: (stat) => `${fmt(stat.value)} vente${stat.value > 1 ? 's' : ''} · ${fmt(stat.chakra)} ◆`,
    note: '-# Ventes repérées par le bot depuis qu’il suit chaque membre : le site ne publie pas l’historique des ventes.',
  },
};

export const data = new SlashCommandBuilder()
  .setName('classement')
  .setDescription('Classement des membres de ce salon qui jouent à Kyara')
  .addStringOption((o) =>
    o
      .setName('par')
      .setDescription('Critère du classement (collection par défaut)')
      .addChoices(...Object.entries(CRITERIA).map(([value, c]) => ({ name: c.label, value }))),
  );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Valeur d'un compte pour le critère, et son pseudo Kyara à jour.
async function statFor(by, acc) {
  const crit = CRITERIA[by];
  if (crit.source === 'sales') {
    const u = await getProfile(acc.kyaraId, { fresh: true }).catch(() => null);
    if (!u) return null;
    const { count, chakra } = await salesStats(u);
    return count ? { pseudo: u.pseudo, value: count, chakra } : null; // seuls ceux qui ont vendu sont classés
  }
  if (crit.source === 'profile') {
    const u = await getProfile(acc.kyaraId, { fresh: true }).catch(() => null);
    return u ? { pseudo: u.pseudo, value: crit.get(u) } : null;
  }
  // Critère du site : on cherche le joueur par pseudo dans le classement du site.
  const find = async (pseudo) => (await kyara.ladder(by, pseudo, { fresh: true })).found?.find((p) => p.id === acc.kyaraId) ?? null;
  let row = await find(acc.pseudo).catch(() => null);
  if (!row) {
    // Pseudo changé, ou joueur masqué des classements : on repasse par le profil.
    const u = await getProfile(acc.kyaraId, { fresh: true }).catch(() => null);
    if (!u) return null;
    if (u.pseudo !== acc.pseudo) row = await find(u.pseudo).catch(() => null);
    row ??= { pseudo: u.pseudo, owned: u.owned, mythics: u.mythics, points: u.rank?.points ?? null, series: null, achievements: null };
  }
  return { pseudo: row.pseudo ?? acc.pseudo, value: row[crit.field] };
}

export async function execute(interaction) {
  if (!interaction.inGuild()) return interaction.reply('❌ Cette commande s’utilise sur un serveur.');
  await interaction.deferReply();
  const by = interaction.options.getString('par') ?? 'collection';
  const crit = CRITERIA[by];

  // Repère les comptes Kyara des membres qui ont accès au salon (10 s max : la recherche est souvent déjà faite en arrière-plan, et se poursuit sinon).
  const done = await Promise.race([detectChannel(interaction.channel).then(() => true), sleep(10_000).then(() => false)]);
  const { members, accounts } = await channelAccounts(interaction.channel);

  const rows = (await Promise.all(accounts.map(async (a) => ({ a, stat: await statFor(by, a) })))).filter(
    (x) => x.stat && x.stat.value !== null && x.stat.value !== undefined,
  );
  rows.sort((x, y) => y.stat.value - x.stat.value || (y.stat.chakra ?? 0) - (x.stat.chakra ?? 0));

  const footer =
    `${accounts.length} membre(s) sur ${members.size} ayant accès au salon ont un compte Kyara` +
    (done ? '' : ' · recherche des comptes en cours, relance dans un moment');
  const title = crit.title ?? 'Les 10 meilleurs collectionneurs du serveur';
  const embed = baseEmbed().setTitle(`🏆 ${title}`).setFooter({ text: footer });
  if (!rows.length) {
    embed.setDescription(
      accounts.length && crit.source === 'sales'
        ? `Aucune vente repérée pour l’instant parmi les membres de ce salon.\n${crit.note}`
        : 'Aucun membre de ce salon avec un compte Kyara trouvé pour l’instant.\n' +
            '-# Les comptes sont reconnus grâce à la connexion Discord de Kyara. Si le tien n’apparaît pas, lance `/profil pseudo:<ton pseudo Kyara>`.',
    );
    return sendPages(interaction, [embed]);
  }

  // Seul le pseudo Kyara est affiché ; les photos de profil sont celles de Discord (en grand pour rester nettes).
  const avatarOf = (a) => a.member.displayAvatarURL({ extension: 'png', size: 512 });
  const value = (stat) => crit.format?.(stat) ?? `${fmt(stat.value)} ${crit.unit}`;
  const top = rows.slice(0, 10).map(({ a, stat }) => ({ pseudo: stat.pseudo, value: value(stat), avatarUrl: avatarOf(a) }));

  // Image seule, hors embed (affichée en grand), avec ta position et le décompte des membres en légende.
  const me = rows.findIndex((x) => x.a.member.id === interaction.user.id);
  const caption =
    [me >= 0 && `Ta position : **${me + 1}** / ${rows.length} — ${value(rows[me].stat)}`, crit.note].filter(Boolean).join('\n') || null;
  embed.setTitle(`Classement · ${footer}`).setURL(null);
  return sendPages(interaction, [
    {
      embed,
      bare: true,
      caption,
      image: () =>
        classementImage({
          title,
          subtitle: `Classement de ${interaction.guild.name} · ${crit.label}`,
          rows: top,
        }),
    },
  ]);
}
