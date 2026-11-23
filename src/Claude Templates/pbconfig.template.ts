/* SPDX-License-Identifier: GPL-3.0-or-later */

// Copie ce fichier dans le dossier de ton extension sous le nom `pbconfig.ts`.

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  // TODO(1) : nom affiché dans Paperback
  name: "My Site",
  description: "Lecture de My Site.",

  // TODO(2) : augmente ce numéro à CHAQUE mise à jour, sinon Paperback ne la voit pas
  version: "1.0.0",

  // Fichier présent dans le dossier de l'extension
  icon: "icon.png",

  // Langue principale du site ("en", "fr", ...)
  language: "en",

  // Doit correspondre à `contentRating` dans main.ts (EVERYONE | MATURE | ADULT)
  contentRating: ContentRating.EVERYONE,

  // Fonctions fournies par l'extension.
  // Si search.mode = "none" dans main.ts, tu peux retirer SEARCH_RESULT_PROVIDING.
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
  ],

  badges: [],

  developers: [
    {
      // TODO(3) : ton nom
      name: "Ton nom",
      // github: "https://github.com/ton-compte",
    },
  ],
} satisfies ExtensionInfo;
