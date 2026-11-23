/* SPDX-License-Identifier: GPL-3.0-or-later */

// =====================================================================
//  TEMPLATE D'EXTENSION PAPERBACK 0.9 — scraping HTML configurable
// =====================================================================
//
//  COMMENT L'UTILISER
//  1. Copie ton dossier d'extension, renomme-le (ex: src/MonSite).
//  2. Renomme ce fichier en main.ts, et pbconfig.template.ts en pbconfig.ts.
//  3. Dernière ligne de ce fichier : le nom exporté DOIT être identique
//     au nom du dossier (sinon : "extension id is invalid").
//  4. Remplis l'objet SITE ci-dessous, de haut en bas. Cherche "TODO".
//  5. Les « modules » sont des interrupteurs (mode, "none", chaîne vide…) :
//     laisse la valeur par défaut tant que le site n'en a pas besoin.
//  6. Teste avec `npm run dev`, puis `npm run conformance`.
//  7. Augmente `version` dans pbconfig.ts à chaque mise à jour.
//
//  QUAND UN SITE EST PLUS COMPLIQUÉ
//  - Images refusées (403)            -> module `headers.referer`, puis network.ts
//  - Chapitres chargés en AJAX        -> `chapters.mode = "madaraAjax"`
//  - Images dans un <script> JSON     -> `pages.mode = "script"`
//  - Images en lazy-load              -> ajoute des attributs dans `images.attrs`
//  - Site avec cookies / anti-bot     -> `headers.cookie`, `headers.userAgent`
//  - Cloudflare                       -> une erreur claire est levée (voir send())
//
// =====================================================================

import {
  BasicRateLimiter,
  ContentRating,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Metadata,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";
import * as cheerio from "cheerio";

// TODO(1) : le nom du fichier de config de CE dossier
import type SiteConfig from "./pbconfig";

// =====================================================================
//  CONFIGURATION DU SITE — tout ce que tu dois remplir est ici
// =====================================================================

const SITE = {
  // ---------- Identité ----------
  // TODO(2) : adresse du site, sans "/" final
  baseUrl: "https://www.example.com",
  lang: "EN",
  contentRating: ContentRating.EVERYONE, // EVERYONE | MATURE | ADULT

  // ---------- MODULE : en-têtes des requêtes ----------
  headers: {
    referer: true, // envoie Referer = baseUrl (utile contre les blocages basiques)
    userAgent: "", // "" = valeur par défaut de l'app
    cookie: "", // ex: "cf_clearance=...". À éviter si possible.
    extra: {} as Record<string, string>,
  },

  // ---------- MODULE : réseau ----------
  network: {
    requests: 10, // requêtes autorisées...
    interval: 10, // ...par tranche de N secondes (baisse si le site te bloque)
    retries: 1, // nouvelles tentatives en cas d'erreur (hors Cloudflare)
  },

  // ---------- MODULE : mode du site ----------
  // "single"    : le site ne contient qu'UNE série (comme Homunculus)
  // "catalogue" : plusieurs séries, avec liste / recherche
  mode: "catalogue" as "single" | "catalogue",

  // Utilisé seulement si mode = "single"
  single: {
    id: "my-series", // identifiant interne libre
    title: "My Series",
    author: "",
    seriesPath: "/", // page qui contient la liste des chapitres
  },

  // Utilisé seulement si mode = "catalogue"
  catalogue: {
    // Sections de la page « Découvrir ». {page} = numéro de page (1, 2, 3…)
    // TODO(3) : adapte les URLs ; ajoute autant de sections que tu veux
    sections: [
      { id: "latest", title: "Latest", url: "/manga/?page={page}" },
      { id: "popular", title: "Popular", url: "/manga/?m_orderby=views&page={page}" },
    ],
    // Sélecteurs CSS d'une « carte » de série dans une liste
    cards: {
      item: ".manga-card", // TODO(4) : l'élément qui entoure une série
      link: "a", // lien vers la série, DANS l'élément (vide = l'élément lui-même)
      title: ".title", // vide = attribut title du lien, sinon son texte
      cover: "img", // l'image de couverture
      // Fragment qui doit apparaître dans le href d'une série (filtre les faux liens)
      linkFilter: "/manga/",
    },
    // Sélecteur du bouton « page suivante » ("" = on continue tant qu'il y a des cartes)
    nextPage: "a.next",
  },

  // ---------- MODULE : recherche ----------
  // "none"   : pas de recherche
  // "local"  : filtre sur le titre dans la 1re section (suffisant pour un petit site)
  // "remote" : appelle la recherche du site (réutilise `catalogue.cards`)
  search: {
    mode: "remote" as "none" | "local" | "remote",
    // {query} = texte cherché, {page} = numéro de page
    url: "/?s={query}&post_type=wp-manga&paged={page}",
  },

  // ---------- Page d'une série ----------
  // Sélecteurs CSS. Laisse "" pour ignorer un champ.
  details: {
    title: "h1", // TODO(5)
    cover: ".summary_image img",
    synopsis: ".description-summary",
    author: ".author-content a",
    status: ".post-status .summary-content",
    genres: ".genres-content a",
    // MODULE optionnel : si le résumé suit un texte fixe (ex: « The Summary is »),
    // le code prend le paragraphe suivant. "" pour désactiver.
    synopsisAfterText: "",
  },

  // ---------- Liste des chapitres ----------
  chapters: {
    // "html"       : la liste est dans la page de la série
    // "madaraAjax" : sites WordPress/Madara (POST sur <série>/ajax/chapters/)
    mode: "html" as "html" | "madaraAjax",
    row: "li.wp-manga-chapter", // TODO(6) : une ligne de chapitre
    link: "a", // le lien, DANS la ligne (vide = la ligne elle-même)
    date: "", // sélecteur de la date dans la ligne ("" = pas de date)
    // Regex qui capture le numéro, testée sur l'URL puis sur le titre
    numberRegex: /chapter[-\s_]*(\d+(?:[.-]\d+)?)/i,
  },

  // ---------- Pages d'un chapitre ----------
  pages: {
    // "html"   : des <img> dans la page
    // "script" : une liste JSON d'URLs dans un <script> (voir scriptRegex)
    mode: "html" as "html" | "script",
    selector: ".reading-content img", // TODO(7) : mode "html"
    // Mode "script" : regex dont le groupe 1 est un tableau JSON d'URLs
    // ex: /images\s*=\s*(\[[\s\S]*?\]);/
    scriptRegex: /images\s*=\s*(\[[\s\S]*?\]);/,
    // Préfixe ajouté aux URLs d'images relatives ("" = baseUrl)
    cdnBase: "",
  },

  // ---------- MODULE : images (lazy-load) ----------
  // Attributs essayés dans l'ordre pour trouver l'URL d'une image
  images: {
    attrs: ["data-src", "data-lazy-src", "data-original", "src"],
  },
};

// =====================================================================
//  CODE GÉNÉRIQUE — normalement, tu n'as rien à modifier en dessous
// =====================================================================

type Cards = { mangaId: string; title: string; imageUrl: string };
type Selection = ReturnType<cheerio.CheerioAPI>;

function absUrl(href: string, base: string = SITE.baseUrl): string {
  const h = href.trim();
  if (/^https?:\/\//i.test(h)) return h;
  if (h.startsWith("//")) return "https:" + h;
  return base + (h.startsWith("/") ? h : "/" + h);
}

// Chemin relatif (stocké comme identifiant), ex: "/manga/one-piece/"
function relPath(href: string): string {
  const abs = absUrl(href);
  const rel = abs.startsWith(SITE.baseUrl) ? abs.slice(SITE.baseUrl.length) : abs;
  return rel.startsWith("/") ? rel : "/" + rel;
}

function fill(template: string, values: { page?: number; query?: string }): string {
  return template
    .replace("{page}", String(values.page ?? 1))
    .replace("{query}", encodeURIComponent(values.query ?? ""));
}

function firstAttr(el: Selection, attrs: string[], base?: string): string {
  for (const attr of attrs) {
    const value = el.attr(attr)?.trim();
    if (value && !value.startsWith("data:")) return absUrl(value, base);
  }
  return "";
}

// Requête HTTP avec en-têtes, nouvelles tentatives et détection de Cloudflare
async function send(
  url: string,
  method: "GET" | "POST" = "GET",
  body?: string,
  extra: Record<string, string> = {},
): Promise<string> {
  const headers: Record<string, string> = { ...SITE.headers.extra, ...extra };
  if (SITE.headers.referer) headers["Referer"] = SITE.baseUrl + "/";
  if (SITE.headers.userAgent) headers["User-Agent"] = SITE.headers.userAgent;
  if (SITE.headers.cookie) headers["Cookie"] = SITE.headers.cookie;

  let lastError = new Error(`Requête échouée : ${url}`);
  for (let attempt = 0; attempt <= SITE.network.retries; attempt++) {
    const request = body === undefined ? { url, method, headers } : { url, method, headers, body };
    const [response, data] = await Application.scheduleRequest(request);
    const text = Application.arrayBufferToUTF8String(data);

    if (response.status === 200) return text;

    if (
      (response.status === 403 || response.status === 503) &&
      /cloudflare|cf-chl|just a moment/i.test(text)
    ) {
      throw new Error(
        "Le site est protégé par Cloudflare. Essaie headers.userAgent / headers.cookie, ou vérifie s'il existe une API.",
      );
    }
    lastError = new Error(`HTTP ${response.status} : ${url}`);
  }
  throw lastError;
}

async function fetchHtml(url: string): Promise<cheerio.CheerioAPI> {
  return cheerio.load(await send(url));
}

function parseCards($: cheerio.CheerioAPI): Cards[] {
  const c = SITE.catalogue.cards;
  const out: Cards[] = [];
  const seen = new Set<string>();

  $(c.item).each((_, el) => {
    const card = $(el);
    const link = c.link ? card.find(c.link).first() : card;
    const href = link.attr("href") ?? "";
    if (href === "" || (c.linkFilter !== "" && !href.includes(c.linkFilter))) return;

    const mangaId = relPath(href);
    if (seen.has(mangaId)) return;
    seen.add(mangaId);

    const title = (
      c.title ? card.find(c.title).first().text() : (link.attr("title") ?? link.text())
    ).trim();
    out.push({
      mangaId,
      title: title || "Unknown Title",
      imageUrl: firstAttr(card.find(c.cover).first(), SITE.images.attrs),
    });
  });
  return out;
}

function seriesUrl(mangaId: string): string {
  return SITE.mode === "single" ? absUrl(SITE.single.seriesPath) : absUrl(mangaId);
}

// ---------------------------------------------------------------------
//  Extension
// ---------------------------------------------------------------------

export class SiteExtension implements ExtensionImpl<typeof SiteConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: SITE.network.requests,
    bufferInterval: SITE.network.interval,
    ignoreImages: true,
  });

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
  }

  // ---------- Découvrir ----------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    if (SITE.mode === "single") {
      return [{ id: "main", title: SITE.single.title, type: DiscoverSectionType.simpleCarousel }];
    }
    return SITE.catalogue.sections.map((s) => ({
      id: s.id,
      title: s.title,
      type: DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: number | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata ?? 1;

    if (SITE.mode === "single") {
      const $ = await fetchHtml(seriesUrl(SITE.single.id));
      return {
        items: [
          {
            type: "simpleCarouselItem",
            mangaId: SITE.single.id,
            title: SITE.single.title,
            subtitle: SITE.single.author,
            imageUrl: $('meta[property="og:image"]').attr("content")?.trim() ?? "",
          } as DiscoverSectionItem,
        ],
      };
    }

    const def = SITE.catalogue.sections.find((s) => s.id === section.id);
    if (!def) return { items: [] };

    const $ = await fetchHtml(absUrl(fill(def.url, { page })));
    const cards = parseCards($);
    const hasNext = SITE.catalogue.nextPage
      ? $(SITE.catalogue.nextPage).length > 0
      : cards.length > 0;

    return {
      items: cards.map(
        (c) =>
          ({
            type: "simpleCarouselItem",
            mangaId: c.mangaId,
            title: c.title,
            subtitle: "",
            imageUrl: c.imageUrl,
          }) as DiscoverSectionItem,
      ),
      ...(hasNext ? { metadata: page + 1 } : {}),
    };
  }

  // ---------- Recherche ----------

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata?: number,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    void sortingOption;
    const page = metadata ?? 1;
    const text = (query.title ?? "").trim();

    if (SITE.search.mode === "none") return { items: [] };

    // Site à série unique : simple filtre sur le titre
    if (SITE.mode === "single") {
      if (text !== "" && !SITE.single.title.toLowerCase().includes(text.toLowerCase())) {
        return { items: [] };
      }
      const $ = await fetchHtml(seriesUrl(SITE.single.id));
      return {
        items: [
          {
            mangaId: SITE.single.id,
            title: SITE.single.title,
            subtitle: SITE.single.author,
            imageUrl: $('meta[property="og:image"]').attr("content")?.trim() ?? "",
          },
        ],
      };
    }

    // Recherche locale : filtre sur la 1re section (page 1 seulement)
    if (SITE.search.mode === "local") {
      const first = SITE.catalogue.sections[0];
      if (!first) return { items: [] };
      const $ = await fetchHtml(absUrl(fill(first.url, { page: 1 })));
      const cards = parseCards($).filter((c) => c.title.toLowerCase().includes(text.toLowerCase()));
      return {
        items: cards.map((c) => ({
          mangaId: c.mangaId,
          title: c.title,
          subtitle: "",
          imageUrl: c.imageUrl,
        })),
      };
    }

    // Recherche distante
    const $ = await fetchHtml(absUrl(fill(SITE.search.url, { page, query: text })));
    const cards = parseCards($);
    const hasNext = SITE.catalogue.nextPage
      ? $(SITE.catalogue.nextPage).length > 0
      : cards.length > 0;

    return {
      items: cards.map((c) => ({
        mangaId: c.mangaId,
        title: c.title,
        subtitle: "",
        imageUrl: c.imageUrl,
      })),
      ...(hasNext ? { metadata: page + 1 } : {}),
    };
  }

  // ---------- Détails ----------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await fetchHtml(seriesUrl(mangaId));
    const d = SITE.details;
    const text = (selector: string): string => (selector ? $(selector).first().text().trim() : "");

    const og = (name: string): string =>
      $(`meta[property="og:${name}"]`).attr("content")?.trim() ?? "";

    const cover = (d.cover ? firstAttr($(d.cover).first(), SITE.images.attrs) : "") || og("image");

    // Résumé : paragraphe après un texte fixe, sinon sélecteur, sinon og:description
    let synopsis = "";
    if (d.synopsisAfterText !== "") {
      const needle = d.synopsisAfterText.toLowerCase();
      $("strong, b").each((_, el) => {
        if (synopsis !== "") return;
        if ($(el).text().toLowerCase().includes(needle)) {
          const parent = $(el).closest("p");
          const next = (parent.length > 0 ? parent : $(el)).nextAll("p").first().text().trim();
          if (next !== "") synopsis = next;
        }
      });
    }
    if (synopsis === "") synopsis = text(d.synopsis);
    if (synopsis === "") synopsis = og("description");

    const statusText = text(d.status);
    const status = /complet|finish|termin|end/i.test(statusText) ? "COMPLETED" : "ONGOING";

    const genres = d.genres
      ? $(d.genres)
          .map((_, el) => $(el).text().trim())
          .get()
          .filter((g) => g !== "")
      : [];

    const title =
      (SITE.mode === "single" ? SITE.single.title : text(d.title)) || og("title") || mangaId;

    return {
      mangaId,
      mangaInfo: {
        thumbnailUrl: cover,
        synopsis: synopsis || "No synopsis.",
        primaryTitle: title,
        secondaryTitles: [],
        contentRating: SITE.contentRating,
        status,
        author: text(d.author) || (SITE.mode === "single" ? SITE.single.author : ""),
        rating: 0,
        tagGroups:
          genres.length > 0
            ? [
                {
                  id: "genres",
                  title: "Genres",
                  tags: genres.map((g) => ({ id: g.toLowerCase().replace(/\s+/g, "-"), title: g })),
                },
              ]
            : [],
        artworkUrls: cover ? [cover] : [],
        shareUrl: seriesUrl(mangaId),
      },
    };
  }

  // ---------- Chapitres ----------

  async getChapters(sourceManga: SourceManga, sinceDate?: Date): Promise<Chapter[]> {
    void sinceDate;
    const base = seriesUrl(sourceManga.mangaId);
    const ch = SITE.chapters;

    const $ =
      ch.mode === "madaraAjax"
        ? cheerio.load(
            await send(base.replace(/\/?$/, "/") + "ajax/chapters/", "POST", "", {
              "X-Requested-With": "XMLHttpRequest",
            }),
          )
        : await fetchHtml(base);

    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    $(ch.row).each((_, el) => {
      const row = $(el);
      const link = ch.link ? row.find(ch.link).first() : row;
      const href = link.attr("href") ?? "";
      if (href === "") return;

      const chapterId = relPath(href);
      if (seen.has(chapterId)) return;
      seen.add(chapterId);

      const title = link.text().trim();
      const num = ch.numberRegex.exec(chapterId) ?? ch.numberRegex.exec(title);
      if (!num?.[1]) return;
      const chapNum = parseFloat(num[1].replace("-", "."));

      let publishDate: Date | undefined;
      if (ch.date) {
        const parsed = Date.parse(row.find(ch.date).first().text().trim());
        if (!Number.isNaN(parsed)) publishDate = new Date(parsed);
      }

      chapters.push({
        chapterId,
        sourceManga,
        langCode: SITE.lang,
        chapNum,
        title: title || `Chapter ${chapNum}`,
        // Si tsc refuse `publishDate`, supprime cette ligne.
        ...(publishDate ? { publishDate } : {}),
      });
    });

    return chapters;
  }

  // ---------- Pages ----------

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const html = await send(absUrl(chapter.chapterId));
    const p = SITE.pages;
    const cdn = p.cdnBase !== "" ? p.cdnBase : SITE.baseUrl;
    const pages: string[] = [];

    if (p.mode === "script") {
      const match = p.scriptRegex.exec(html);
      if (!match?.[1]) throw new Error("Liste d'images introuvable dans le script");
      const parsed: unknown = JSON.parse(match[1]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item.trim() !== "") pages.push(absUrl(item, cdn));
        }
      }
    } else {
      const $ = cheerio.load(html);
      $(p.selector).each((_, el) => {
        const url = firstAttr($(el), SITE.images.attrs, cdn);
        if (url !== "") pages.push(url);
      });
    }

    if (pages.length === 0) throw new Error("Aucune page trouvée pour ce chapitre");

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }
}

// TODO(8) : ce nom DOIT être identique au nom du dossier de l'extension
export const MySite = new SiteExtension();
