// Réponses sur plusieurs pages, avec des boutons ◀ ▶ et, en option, des menus pour changer les
// options de la commande sans la retaper (rareté, tri…), placés sous l'embed juste avant les boutons.
//
// Une page est un embed, ou { embed, image, imageName?, bare?, caption? } où image() renvoie le
// fichier image de la page (Buffer), généré à la demande. Les pages sont construites seulement
// quand on les affiche. Les sessions restent en mémoire 30 min après la dernière utilisation.

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { cardGrid } from './images.js';
import { BRAND_COLOR, listSeries, normalize, RARITIES, RARITY_ORDER, truncate } from './kyara.js';

const sessions = new Map(); // token -> session
const TTL = 30 * 60_000;
const PAGES_KEPT = 30; // pages déjà construites gardées par session (avec leur image)
const ALL = '*'; // valeur « aucun filtre » dans les menus

// ◀ ▶ qui bouclent : avant la première page on arrive à la dernière, et inversement.
// Les menus marqués « searchable » ont en plus un bouton 🔎 qui ouvre une fenêtre de recherche par titre.
function buttons(token, i, n, controls, values) {
  const row = [];
  const btn = (slot, target, label) =>
    new ButtonBuilder().setCustomId(`page:${token}:${target}:${slot}`).setLabel(label).setStyle(ButtonStyle.Primary);
  if (n > 1) row.push(btn('p', (i - 1 + n) % n, '◀'), btn('s', (i + 1) % n, '▶'));
  for (const c of controls.filter((c) => c.searchable)) {
    row.push(
      new ButtonBuilder()
        .setCustomId(`page:${token}:search:${c.name}`)
        .setLabel(c.searchLabel ?? 'Rechercher')
        .setEmoji('🔎')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  // Filtres texte (ex. « Rechercher un personnage ») : un bouton qui ouvre la saisie, et un ✖ pour l'effacer.
  for (const c of controls.filter((c) => c.type === 'text')) {
    const value = values?.[c.name];
    row.push(
      new ButtonBuilder()
        .setCustomId(`page:${token}:text:${c.name}`)
        .setLabel(c.label)
        .setEmoji('🔎')
        .setStyle(value ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
    if (value) {
      row.push(
        new ButtonBuilder()
          .setCustomId(`page:${token}:textclear:${c.name}`)
          .setLabel(truncate(`« ${value} »`, 70))
          .setEmoji('✖️')
          .setStyle(ButtonStyle.Danger),
      );
    }
  }
  return row.length ? [new ActionRowBuilder().addComponents(row.slice(0, 5))] : [];
}

const resolveControls = async (s) => (typeof s.controls === 'function' ? await s.controls(s.values) : (s.controls ?? []));

// Résultats d'une recherche dans un menu : c.search(texte) si fourni (ex. toutes les œuvres de Kyara),
// sinon les choix du menu dont le libellé contient le texte (sans tenir compte des accents ni des majuscules).
async function searchOptions(c, query) {
  if (c.search) return c.search(query);
  const q = normalize(query);
  return c.options.slice(1).filter((o) => normalize(o.label).includes(q));
}

// Un menu par option modifiable ; l'option choisie est présélectionnée.
// Les contrôles peuvent être une liste fixe, ou une fonction (async) recalculée à chaque affichage
// (ex. la liste des œuvres d'un joueur, qui se complète pendant l'analyse de sa collection).
// Discord limite un menu à 25 choix : au-delà, le premier choix (« toutes ») reste fixe, et les autres
// défilent par pages de 22 avec des entrées « précédentes / suivantes » dans le menu lui-même.
const MENU_PAGE = 22;
const PAGE_PREFIX = '__page:';
const CLEAR = '__clear'; // « effacer la recherche » dans un menu

async function menus(token, s, controls) {
  s.menuPage ??= {};
  s.menuSearch ??= {};
  return Promise.all(controls.filter((c) => c.type !== 'text').slice(0, 4).map(async (c) => {
    const current = s.values[c.name] ?? ALL;
    const opt = (o) => ({
      label: truncate(o.label, 100),
      value: o.value ?? ALL,
      description: o.description ? truncate(o.description, 100) : undefined,
      emoji: o.emoji,
      default: (o.value ?? ALL) === current,
    });
    let options = c.options.map(opt);
    // Recherche en cours : seulement les résultats, avec une entrée pour l'effacer.
    const query = s.menuSearch[c.name];
    if (query) {
      const found = (await searchOptions(c, query)).map(opt);
      options = [
        options[0],
        { label: truncate(`Effacer la recherche « ${query} » (${found.length} résultat${found.length > 1 ? 's' : ''})`, 100), value: CLEAR, emoji: '✖️' },
        ...found,
      ];
    }
    // Discord refuse deux choix avec la même valeur (ex. deux noms identiques une fois tronqués).
    const seen = new Set();
    options = options.filter((o) => !seen.has(o.value) && seen.add(o.value));
    if (options.length > 25) {
      // Les premiers choix (« toutes », « effacer la recherche ») restent fixes ; les autres défilent.
      const fixedCount = query ? 2 : 1;
      const size = MENU_PAGE - (fixedCount - 1);
      const fixed = options.slice(0, fixedCount);
      const rest = options.slice(fixedCount);
      const pages = Math.ceil(rest.length / size);
      // Page du menu : celle choisie par l'utilisateur, sinon celle qui contient l'option sélectionnée.
      let p = s.menuPage[c.name] ?? Math.max(0, Math.floor(rest.findIndex((o) => o.default) / size));
      p = Math.min(Math.max(p, 0), pages - 1);
      const from = p * size;
      const range = (a, b) => `${a + 1}–${Math.min(b, rest.length)} / ${rest.length}`;
      options = [
        ...fixed,
        ...(p > 0 ? [{ label: `Précédentes (${range(from - size, from)})`, value: `${PAGE_PREFIX}${p - 1}`, emoji: '⬅️' }] : []),
        ...rest.slice(from, from + size),
        ...(p < pages - 1 ? [{ label: `Suivantes (${range(from + size, from + 2 * size)})`, value: `${PAGE_PREFIX}${p + 1}`, emoji: '➡️' }] : []),
      ];
    }
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`page:${token}:opt:${c.name}`).setPlaceholder(c.placeholder).addOptions(options),
    );
  }));
}

const asPage = (p) => (p instanceof EmbedBuilder ? { embed: p } : p);

// Page i construite avec son image (promesse mise en cache : une page préparée en avance
// n'est jamais construite deux fois).
// Une page construite il y a plus d'une minute est reconstruite : les collections changent vite.
const PAGE_MAX_AGE = 60_000;

function pageAt(s, i) {
  let promise = s.cache.get(i);
  if (promise && Date.now() - promise.builtAt > PAGE_MAX_AGE) {
    s.cache.delete(i);
    promise = null;
  }
  if (!promise) {
    promise = (async () => {
      const page = asPage(await s.get(i));
      page.footerBase ??= page.embed.data.footer?.text ?? null;
      page.embed.setTimestamp(new Date()); // heure des données, affichée en bas de l'embed
      if (page.image) {
        try {
          page.buffer = await page.image();
        } catch (err) {
          page.buffer = null; // la page s'affiche sans image
          console.warn('⚠️ Image non générée :', err.message);
        }
      }
      return page;
    })();
    promise.builtAt = Date.now();
    promise.catch(() => s.cache.delete(i)); // en cas d'erreur, on réessaiera au prochain affichage
    s.cache.set(i, promise);
    if (s.cache.size > PAGES_KEPT) s.cache.delete(s.cache.keys().next().value);
  }
  return promise;
}

// Prépare en arrière-plan la page suivante (et la précédente) pour que ◀ ▶ soient instantanés.
function prefetch(s, i) {
  if (s.count <= 1) return;
  for (const j of new Set([(i + 1) % s.count, (i - 1 + s.count) % s.count])) pageAt(s, j).catch(() => {});
}

// Contenu du message pour la page i (avec son image si elle en a une).
async function render(s, i, token) {
  const page = await pageAt(s, i);
  if (token) prefetch(s, i);
  if (s.count > 1) page.embed.setFooter({ text: [page.footerBase, `${i + 1} / ${s.count}`].filter(Boolean).join(' · ') });
  const payload = { content: '', embeds: [page.embed], files: [], attachments: [] };
  if (page.image) {
    try {
      if (page.buffer) {
        const name = page.imageName ?? `page-${i + 1}.jpg`;
        payload.files = [new AttachmentBuilder(page.buffer, { name })];
        if (page.bare) {
          // Image seule, hors embed : Discord l'affiche bien plus grande (un embed la réduit à ~400 px).
          // L'embed est remplacé par une ligne de texte (titre, lien, numéro de page).
          const { title, url } = page.embed.data;
          const label = url ? `[${title}](<${url}>)` : title;
          payload.content = [
            page.caption, // texte libre facultatif au-dessus de l'image
            `-# ${[label, s.count > 1 && `${i + 1} / ${s.count}`].filter(Boolean).join(' · ')}`,
          ]
            .filter(Boolean)
            .join('\n');
          payload.embeds = [];
        } else {
          page.embed.setImage(`attachment://${name}`);
        }
      }
    } catch (err) {
      page.image = null; // on n'insiste pas : la page s'affiche sans image
      console.warn('⚠️ Image non générée :', err.message);
    }
  }
  s.current = i;
  if (token) {
    const controls = await resolveControls(s);
    s.lastControls = controls; // gardés pour ouvrir la fenêtre de recherche sans attendre (délai de 3 s de Discord)
    payload.components = [...(await menus(token, s, controls)), ...buttons(token, i, s.count, controls, s.values)];
  } else payload.components = [];
  return payload;
}

function newSession(interaction, fields) {
  const now = Date.now();
  for (const [k, old] of sessions) if (now - old.at > TTL) sessions.delete(k);
  const s = { cache: new Map(), owner: interaction.user.id, at: now, values: {}, ...fields };
  const token = Math.random().toString(36).slice(2, 10);
  sessions.set(token, s);
  return { s, token };
}

// count pages, la page i étant construite par get(i) (async) seulement quand on l'affiche.
export async function sendLazyPages(interaction, count, get) {
  if (count <= 1) {
    const s = { count, get, cache: new Map(), values: {} };
    return interaction.editReply(await render(s, 0, null));
  }
  const { s, token } = newSession(interaction, { count, get });
  return interaction.editReply(await render(s, 0, token));
}

export function sendPages(interaction, pages) {
  pages = pages.filter(Boolean);
  return sendLazyPages(interaction, pages.length, (i) => pages[i]);
}

// Normalise ce que renvoie un build() : un tableau de pages, ou { count, get }.
function asResult(r) {
  if (Array.isArray(r)) {
    const pages = r.filter(Boolean);
    return { count: pages.length, get: (i) => pages[i] };
  }
  return r;
}

// Vue avec options modifiables : les menus `controls` ([{ name, placeholder, options: [{ label, value, emoji?, description? }] }],
// value null = « aucun filtre ») changent `values`, puis build(values) reconstruit la réponse (pages ou { count, get },
// au moins une page). Les autres options de la commande (joueur visé…) restent celles d'origine.
// stale() (facultatif) : renvoie true si les données ont changé depuis le dernier build (ex. le joueur a
// ouvert un booster) ; la réponse est alors reconstruite au prochain clic, pour rester d'actualité.
export async function sendView(interaction, { values, controls, build, stale = null }) {
  const result = asResult(await build(values));
  const { s, token } = newSession(interaction, { ...result, values: { ...values }, controls, build, stale });
  return interaction.editReply(await render(s, 0, token));
}

function checkSession(interaction) {
  const [, token] = interaction.customId.split(':');
  const s = sessions.get(token);
  if (!s) {
    interaction.reply({ content: '⌛ Cette liste a expiré : relance la commande.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return null;
  }
  if (interaction.user.id !== s.owner) {
    interaction
      .reply({ content: '🙅 Seule la personne qui a lancé la commande peut l’utiliser. Relance-la de ton côté !', flags: MessageFlags.Ephemeral })
      .catch(() => {});
    return null;
  }
  s.at = Date.now();
  return { s, token };
}

export async function handlePageButton(interaction) {
  const found = checkSession(interaction);
  if (!found) return;
  const { s, token } = found;
  const [, , action, name] = interaction.customId.split(':');
  // 🔎 filtre texte : fenêtre de saisie (à ouvrir tout de suite, sans deferUpdate avant).
  if (action === 'text') {
    const control = (s.lastControls ?? []).find((c) => c.name === name);
    const input = new TextInputBuilder()
      .setCustomId('q')
      .setLabel(truncate(control?.inputLabel ?? 'Nom (ou une partie du nom)', 45))
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(100)
      .setRequired(true);
    if (s.values[name]) input.setValue(String(s.values[name]).slice(0, 100)); // jamais de valeur vide (refusée par Discord)
    const modal = new ModalBuilder()
      .setCustomId(`page:${token}:textq:${name}`)
      .setTitle(truncate(control?.label ?? 'Rechercher', 45))
      .addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal).catch((err) => {
      console.error('[recherche] fenêtre refusée par Discord :', err.message);
      return interaction
        .reply({ content: '⚠️ Impossible d’ouvrir la recherche. Réessaie dans un instant.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    });
  }
  // ✖ : efface le filtre texte et revient à la liste complète.
  if (action === 'textclear') {
    await interaction.deferUpdate();
    s.values = { ...s.values, [name]: null };
    return withLoading(interaction, async () => {
      await rebuild(s);
      return render(s, 0, token);
    });
  }
  // 🔎 : fenêtre de recherche par titre (à ouvrir tout de suite, sans deferUpdate avant).
  if (action === 'search') {
    const control = (s.lastControls ?? []).find((c) => c.name === name);
    const input = new TextInputBuilder()
      .setCustomId('q')
      .setLabel('Titre (ou une partie du titre)')
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(100)
      .setRequired(true);
    // Pré-remplissage seulement s'il y a une recherche précédente : Discord refuse un champ
    // pré-rempli vide quand il exige au moins 1 caractère (la fenêtre ne s'ouvrirait pas).
    const previous = s.menuSearch?.[name];
    if (previous) input.setValue(previous.slice(0, 100));
    const modal = new ModalBuilder()
      .setCustomId(`page:${token}:searchq:${name}`)
      .setTitle(truncate(control?.searchLabel ?? 'Rechercher', 45))
      .addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal).catch((err) => {
      console.error('[recherche] fenêtre refusée par Discord :', err.message);
      return interaction
        .reply({ content: '⚠️ Impossible d’ouvrir la recherche. Réessaie dans un instant.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    });
  }
  const target = Number(action);
  await interaction.deferUpdate(); // construire la page peut dépasser les 3 s permises
  return withLoading(interaction, async () => {
    // Données changées depuis l'affichage (nouvelles cartes, ventes…) : on reconstruit avec les données à jour.
    if (s.stale && (await s.stale().catch(() => false))) await rebuild(s);
    return render(s, Math.max(0, Math.min(s.count - 1, target)), token);
  });
}

// Mise à jour d'un message avec indicateur : si la reconstruction dure plus de 1,5 s (ex. première vérification
// des doublons d'une grande rareté), un « ⏳ » s'affiche au-dessus du message pour montrer que le bot travaille.
const LOADING = '⏳ Mise à jour en cours… La première vérification d’une grande rareté peut prendre jusqu’à une minute.';
async function withLoading(interaction, work) {
  let loading = null;
  const timer = setTimeout(() => {
    loading = Promise.resolve()
      .then(() => interaction.editReply({ content: LOADING }))
      .catch(() => {}); // l'indicateur ne doit jamais faire échouer la mise à jour
  }, 1500);
  let payload;
  try {
    payload = await work();
  } finally {
    clearTimeout(timer);
  }
  if (loading) await loading; // le « ⏳ » ne doit pas arriver après le résultat
  return interaction.editReply(payload);
}

// Reconstruit la réponse avec les valeurs actuelles (les pages déjà préparées sont oubliées).
async function rebuild(s) {
  Object.assign(s, asResult(await s.build(s.values)));
  s.cache = new Map();
}

// Changement d'option dans un menu : on reconstruit la réponse et on revient à la première page.
export async function handlePageSelect(interaction) {
  const found = checkSession(interaction);
  if (!found) return;
  const { s, token } = found;
  const name = interaction.customId.split(':')[3];
  const value = interaction.values[0];
  await interaction.deferUpdate();
  // « Effacer la recherche » : le menu retrouve tous ses choix.
  if (value === CLEAR) {
    s.menuSearch = { ...s.menuSearch, [name]: undefined };
    s.menuPage = { ...s.menuPage, [name]: undefined };
    return interaction.editReply(await render(s, s.current ?? 0, token));
  }
  // « Précédentes / suivantes » : on fait seulement défiler le menu, sans changer d'option.
  if (value.startsWith(PAGE_PREFIX)) {
    s.menuPage = { ...s.menuPage, [name]: Number(value.slice(PAGE_PREFIX.length)) };
    return interaction.editReply(await render(s, s.current ?? 0, token));
  }
  s.values = { ...s.values, [name]: value === ALL ? null : value };
  s.menuPage = { ...s.menuPage, [name]: undefined };
  s.menuSearch = { ...s.menuSearch, [name]: undefined };
  return withLoading(interaction, async () => {
    await rebuild(s);
    return render(s, 0, token);
  });
}

// Validation de la fenêtre de recherche : un seul résultat → il est choisi directement ;
// plusieurs → le menu n'affiche plus que ceux-là ; aucun → message visible seulement par l'auteur.
export async function handlePageModal(interaction) {
  const found = checkSession(interaction);
  if (!found) return;
  const { s, token } = found;
  const [, , kind, name] = interaction.customId.split(':');
  const query = interaction.fields.getTextInputValue('q').trim();
  // On répond tout de suite à Discord (3 s max), puis on cherche.
  await interaction.deferUpdate();
  // Filtre texte (ex. personnage) : la réponse est reconstruite avec ce filtre, en page 1.
  if (kind === 'textq') {
    s.values = { ...s.values, [name]: query || null };
    return withLoading(interaction, async () => {
      await rebuild(s);
      return render(s, 0, token);
    });
  }
  const control = (s.lastControls ?? (await resolveControls(s))).find((c) => c.name === name);
  const notice = (content) => interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  if (!control) return notice('⌛ Ce menu n’existe plus : relance la commande.');
  const results = await searchOptions(control, query);
  if (!results.length) return notice(`🔎 Aucun résultat pour « ${query} ».`);
  // Un seul résultat, ou un titre qui correspond exactement : on le sélectionne.
  const exact = results.find((o) => normalize(o.label) === normalize(query));
  if (results.length === 1 || exact) {
    const choice = exact ?? results[0];
    s.values = { ...s.values, [name]: choice.value ?? null };
    s.menuSearch = { ...s.menuSearch, [name]: undefined };
    s.menuPage = { ...s.menuPage, [name]: undefined };
    return withLoading(interaction, async () => {
      await rebuild(s);
      return render(s, 0, token);
    });
  }
  s.menuSearch = { ...s.menuSearch, [name]: query };
  s.menuPage = { ...s.menuPage, [name]: 0 };
  return interaction.editReply(await render(s, s.current ?? 0, token));
}

// Découpe une liste de lignes en pages d'embeds. `make()` renvoie l'embed de base (titre, couleur…).
export function listPages(lines, perPage, make, { header = '', empty = 'Rien à afficher.' } = {}) {
  if (!lines.length) return [make().setDescription(`${header}${header ? '\n\n' : ''}${empty}`)];
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) {
    const body = lines.slice(i, i + perPage).join('\n');
    pages.push(make().setDescription(`${header}${header ? '\n\n' : ''}${body}`.slice(0, 4096)));
  }
  return pages;
}

// Comme listPages, pour une liste de cartes : chaque page a en plus une grille des cartes qu'elle liste.
// `line(card)` donne la ligne de texte, `qty(card)` la quantité affichée sur la tuile.
export function cardPages(cards, perPage, make, { line, qty = () => 1, cols = 5, ...opts }) {
  const embeds = listPages(cards.map(line), perPage, make, opts);
  if (!cards.length) return embeds;
  return embeds.map((embed, p) => {
    const slice = cards.slice(p * perPage, (p + 1) * perPage);
    return { embed, image: () => cardGrid(slice.map((card) => ({ card, qty: qty(card) })), { cols }) };
  });
}

// Une seule grille de cartes à joindre à un embed.
export const withGrid = (embed, cards, opts) =>
  cards?.length ? { embed, image: () => cardGrid(cards.map((card) => ({ card })), opts) } : embed;

export const baseEmbed = () => new EmbedBuilder().setColor(BRAND_COLOR);

// Bouton « Rechercher un personnage » : filtre la liste affichée sur le nom tapé (valeur « perso »).
export const characterControl = {
  name: 'perso',
  type: 'text',
  label: 'Rechercher un personnage',
  inputLabel: 'Nom du personnage (ou une partie)',
};

// La carte correspond-elle au nom cherché ? (nom ou nom japonais, sans accents ni majuscules)
export function matchesCharacter(card, query) {
  if (!query) return true;
  const q = normalize(query);
  return normalize(card.name).includes(q) || (card.native ?? '').includes(query.trim());
}

// Menus prêts à l'emploi.
export const rarityControl = {
  name: 'rarete',
  placeholder: 'Rareté',
  options: [
    { label: 'Toutes les raretés', value: null, emoji: '🃏' },
    ...[...RARITY_ORDER].reverse().map((r) => ({ label: RARITIES[r].label, value: r, emoji: RARITIES[r].emoji })),
  ],
};

// Menu des œuvres : « toutes » (ou autre libellé), l'œuvre choisie, les favoris du membre,
// puis les plus grandes œuvres de Kyara pour compléter (25 choix max, limite de Discord).
// Comme dans /collection : toutes les œuvres de Kyara (l'œuvre choisie et tes favoris d'abord, puis les
// autres par ordre alphabétique), avec « Précédentes / Suivantes » dans le menu et le bouton 🔎 de recherche.
const cartes = (n) => `${n} carte${n > 1 ? 's' : ''}`;

export async function seriesControl(current, favoris, { allLabel = 'Toutes les œuvres' } = {}) {
  const all = await listSeries();
  const size = new Map(all.map((s) => [s.name, s.cards.length]));
  const option = (n) => ({
    label: n,
    value: n.slice(0, 100),
    emoji: favoris.includes(n) ? '⭐' : '📖',
    description: favoris.includes(n)
      ? size.has(n)
        ? `Dans tes favoris · ${cartes(size.get(n))}`
        : 'Dans tes favoris · série personnalisée'
      : cartes(size.get(n) ?? 0),
  });
  const rest = all.map((s) => s.name).sort((a, b) => a.localeCompare(b, 'fr'));
  const names = [...new Set([current, ...favoris, ...rest].filter(Boolean))];
  return {
    name: 'oeuvre',
    placeholder: 'Œuvre',
    searchable: true,
    searchLabel: 'Rechercher une œuvre',
    search: async (query) => {
      const q = normalize(query);
      return names.filter((n) => normalize(n).includes(q)).map(option);
    },
    options: [{ label: allLabel, value: null, emoji: '📚' }, ...names.map(option)],
  };
}
