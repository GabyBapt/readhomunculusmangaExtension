/* SPDX-License-Identifier: GPL-3.0-or-later */

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

import type HomunculusConfig from "./pbconfig";

const BASE_URL = "https://www.homunculusmanga.com";
const MANGA_ID = "homunculus";
const TITLE = "Homunculus";
const FALLBACK_COVER = `${BASE_URL}/wp-content/uploads/2025/10/homunculus-cover-2-1.webp`;
const CHAPTER_HREF_RE = /\/manga\/(homunculus-chapter-[\w-]+)\/?$/i;

export class HomunculusExtension implements ExtensionImpl<typeof HomunculusConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 10,
    bufferInterval: 10,
    ignoreImages: true,
  });

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
  }

  // ---------- Réseau ----------

  private async fetchHtml(url: string): Promise<cheerio.CheerioAPI> {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
      headers: { Referer: BASE_URL + "/" },
    });
    if (response.status !== 200) {
      throw new Error(`Requête échouée (${response.status}) : ${url}`);
    }
    return cheerio.load(Application.arrayBufferToUTF8String(data));
  }

  private getCover($: cheerio.CheerioAPI): string {
    return $('meta[property="og:image"]').attr("content")?.trim() || FALLBACK_COVER;
  }

  // ---------- Discover ----------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "homunculus",
        title: TITLE,
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: number | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    void section;
    void metadata;

    const $ = await this.fetchHtml(BASE_URL + "/");
    return {
      items: [
        {
          type: "simpleCarouselItem",
          mangaId: MANGA_ID,
          title: TITLE,
          subtitle: "Hideo Yamamoto",
          imageUrl: this.getCover($),
        },
      ],
    };
  }

  // ---------- Recherche ----------

  // Le site ne contient qu'une série : on filtre localement sur le titre.
  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata?: number,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    void metadata;
    void sortingOption;

    const search = (query.title ?? "").trim().toLowerCase();
    if (search !== "" && !TITLE.toLowerCase().includes(search)) {
      return { items: [] };
    }

    const $ = await this.fetchHtml(BASE_URL + "/");
    return {
      items: [
        {
          mangaId: MANGA_ID,
          title: TITLE,
          subtitle: "Hideo Yamamoto",
          imageUrl: this.getCover($),
        },
      ],
    };
  }

  // ---------- Détails ----------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    if (mangaId !== MANGA_ID) throw new Error("No title with this id exists");

    const $ = await this.fetchHtml(BASE_URL + "/");
    const cover = this.getCover($);

    // Résumé : le paragraphe qui suit « The Summary is », sinon repli sur og:description.
    let synopsis = "";
    $("strong, b").each((_, el) => {
      if (synopsis !== "") return;
      if (/the summary is/i.test($(el).text())) {
        const parent = $(el).closest("p");
        const next = (parent.length > 0 ? parent : $(el)).nextAll("p").first().text().trim();
        if (next !== "") synopsis = next;
      }
    });
    if (synopsis === "") {
      const og = $('meta[property="og:description"]').attr("content") ?? "";
      const idx = og.search(/the summary is/i);
      synopsis = (idx >= 0 ? og.slice(idx).replace(/^the summary is/i, "") : og).trim();
    }

    return {
      mangaId,
      mangaInfo: {
        thumbnailUrl: cover,
        synopsis: synopsis || "No synopsis.",
        primaryTitle: TITLE,
        secondaryTitles: [],
        contentRating: ContentRating.MATURE,
        status: "COMPLETED",
        author: "Hideo Yamamoto",
        rating: 8.34 / 10,
        tagGroups: [
          {
            id: "genres",
            title: "Genres",
            tags: [
              { id: "drama", title: "Drama" },
              { id: "horror", title: "Horror" },
              { id: "mystery", title: "Mystery" },
            ],
          },
        ],
        artworkUrls: [cover],
        shareUrl: BASE_URL + "/",
      },
    };
  }

  // ---------- Chapitres ----------

  async getChapters(sourceManga: SourceManga, sinceDate?: Date): Promise<Chapter[]> {
    void sinceDate;
    if (sourceManga.mangaId !== MANGA_ID) throw new Error("No title with this id exists");

    const $ = await this.fetchHtml(BASE_URL + "/");
    const chapters: Chapter[] = [];
    const seen = new Set<string>();

    $("table a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const match = CHAPTER_HREF_RE.exec(href);
      if (!match?.[1]) return;

      const chapterId = match[1];
      if (seen.has(chapterId)) return;
      seen.add(chapterId);

      // "homunculus-chapter-10-5" -> 10.5
      const numMatch = /chapter-(\d+)(?:-(\d+))?$/i.exec(chapterId);
      if (!numMatch?.[1]) return;
      const chapNum = parseFloat(numMatch[2] ? `${numMatch[1]}.${numMatch[2]}` : numMatch[1]);

      chapters.push({
        chapterId,
        sourceManga,
        langCode: "EN",
        chapNum,
        title: $(el).text().trim() || `${TITLE} – Chapter ${chapNum}`,
      });
    });

    return chapters;
  }

  // ---------- Pages ----------

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const $ = await this.fetchHtml(`${BASE_URL}/manga/${chapter.chapterId}/`);

    const pages: string[] = [];
    $(".chapter-content img").each((_, el) => {
      const img = $(el);
      const src = (
        img.attr("src") ??
        img.attr("data-src") ??
        img.attr("data-lazy-src") ??
        ""
      ).trim();
      if (src !== "" && !src.startsWith("data:")) pages.push(src);
    });

    if (pages.length === 0) throw new Error("Aucune page trouvée pour ce chapitre");

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }
}

export const HomunculusManga = new HomunculusExtension();
