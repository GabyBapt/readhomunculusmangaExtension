/* SPDX-License-Identifier: GPL-3.0-or-later */
 
import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";
 
export default {
  name: "Homunculus",
  description: "Lecture de Homunculus sur homunculusmanga.com.",
  version: "1.0.0",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
  ],
  badges: [],
  developers: [
    {
      // TODO: remplace par ton nom / ton GitHub
      name: "GabyDev",
    },
  ],
} satisfies ExtensionInfo;
 