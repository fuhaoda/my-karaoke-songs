/** Filename parsing and search shared by the browser app and its Node checks. */

const MEDIA_EXTENSIONS = new Set([
  "mp3",
  "flac",
  "m4a",
  "wav",
  "aac",
  "ogg",
  "wma",
  "aiff",
  "alac",
  "mp4",
  "mkv",
  "avi",
  "mov",
  "webm",
]);
const LANGUAGES = new Set([
  "国语",
  "国",
  "粤语",
  "闽南",
  "英语",
  "韩语",
  "日语",
  "其它",
]);
const ENGLISH_ARTISTS = [
  "Ariana Grande, Jessie J, Nicki Minaj",
  "Whitney Houston Mariah Carey",
  "Backstreet Boys",
  "Justin Bieber",
  "Fool's Garden",
  "Celine Dion",
  "Daniel Ingram",
  "Hedy West",
  "Charlie Puth",
  "Carpenters",
  "Radiohead",
  "Westfile",
  "ABBA",
];
const VERSION_SUFFIX = /\s*[（(](演|MTV|双语种|Remix)[）)]\s*$/iu;

export function normalizeSearch(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

/** Returns deduplicated, normalized AND-search terms. */
export function tokenizeQuery(query) {
  return [
    ...new Set(
      String(query ?? "")
        .split(/[\s,，、;；+＋]+/u)
        .map(normalizeSearch)
        .filter(Boolean),
    ),
  ];
}

function prepareFilename(raw) {
  const filename = raw.replace(/^\uFEFF/u, "").trim();
  if (!filename || filename.startsWith(".") || /[\u0000/\\]/u.test(filename))
    return null;
  const match = /^(.*)\.([^.]+)$/u.exec(filename);
  if (
    !match ||
    !match[1].trim() ||
    !MEDIA_EXTENSIONS.has(match[2].toLowerCase())
  )
    return null;
  const originalStem = match[1].trim();
  // Remove at most one collection index. A year inside the song title stays intact.
  const indexMatch = /^\d{3,4}(?:\s+|[-_])(.+)$/u.exec(originalStem);
  const stem = (indexMatch ? indexMatch[1] : originalStem).trim();
  return {
    filename,
    stem,
    indexed: Boolean(indexMatch),
    format: match[2].toUpperCase(),
  };
}

function splitKnownFormat(item) {
  const { stem, indexed } = item;
  const fields = stem.split("-");
  if (fields.length >= 4 && LANGUAGES.has(fields.at(-2).trim())) {
    return {
      artist: fields[0].trim(),
      title: fields.slice(1, -2).join("-").trim(),
      language: fields.at(-2).trim() === "国" ? "国语" : fields.at(-2).trim(),
    };
  }
  if (stem.includes(" - ")) {
    const [title, ...artist] = stem.split(" - ");
    return { title: title.trim(), artist: artist.join(" - ").trim() };
  }
  if (indexed && stem.includes("-")) {
    const [title, ...artist] = stem.split("-");
    return { title: title.trim(), artist: artist.join("-").trim() };
  }
  if (!stem.includes("-")) {
    for (const artist of ENGLISH_ARTISTS) {
      const suffix = ` ${artist}`;
      if (stem.toLowerCase().endsWith(suffix.toLowerCase())) {
        return {
          title: stem.slice(0, -suffix.length).trim(),
          artist: stem.slice(-artist.length),
        };
      }
    }
    const words = stem.split(/\s+/u);
    if (words.length > 1 && /\p{Script=Han}/u.test(words[0])) {
      return { title: words[0], artist: words.slice(1).join(" ") };
    }
    return { title: stem, artist: "" };
  }
  return null;
}

/**
 * Parse the filename inventory, retaining separate recordings of the same song.
 * Only exact duplicate filenames and unsupported/malformed inventory lines drop out.
 */
export function parseCatalog(text) {
  const unique = new Map();
  for (const raw of String(text ?? "").split(/\r?\n/u)) {
    const item = prepareFilename(raw);
    if (item && !unique.has(item.filename)) unique.set(item.filename, item);
  }
  const prepared = [...unique.values()];
  const knownArtists = new Set();
  for (const item of prepared) {
    item.known = splitKnownFormat(item);
    if (item.known?.artist)
      knownArtists.add(normalizeSearch(item.known.artist));
  }
  return prepared.map((item) => {
    let details = item.known;
    if (!details) {
      const [left, ...remaining] = item.stem.split("-");
      const right = remaining.join("-").trim();
      // Compact unnumbered files generally use singer-title. The known artist
      // vocabulary also recognizes the title-singer files in NewMV.
      details =
        knownArtists.has(normalizeSearch(right)) &&
        !knownArtists.has(normalizeSearch(left))
          ? { title: left.trim(), artist: right }
          : { title: right, artist: left.trim() };
    }
    const suffix = VERSION_SUFFIX.exec(details.title);
    const title =
      (suffix ? details.title.slice(0, suffix.index) : details.title).trim() ||
      item.stem;
    const entry = {
      id: item.filename,
      filename: item.filename,
      title,
      artist: details.artist,
      language: details.language || "未标注",
      format: item.format,
      version: suffix ? suffix[1] : "",
      searchText: "",
    };
    entry.searchText = normalizeSearch(
      `${entry.filename} ${entry.title} ${entry.artist} ${entry.language}`,
    );
    return entry;
  });
}

/** Match every query term against the same recording, optionally by language. */
export function searchCatalog(catalog, query, { language = "all" } = {}) {
  const terms = tokenizeQuery(query);
  const selectedLanguage = language === "国" ? "国语" : language;
  const matches = catalog.filter(
    (entry) =>
      (selectedLanguage === "all" || entry.language === selectedLanguage) &&
      terms.every((term) => entry.searchText.includes(term)),
  );
  if (!terms.length) return matches;
  const completeQuery = normalizeSearch(query);
  const rank = (entry) => {
    const title = normalizeSearch(entry.title);
    if (title === completeQuery) return 3;
    if (terms.every((term) => title.includes(term))) return 2;
    if (terms.every((term) => normalizeSearch(entry.artist).includes(term)))
      return 1;
    return 0;
  };
  // Stable sorting preserves the inventory order among equally relevant versions.
  return matches.sort((left, right) => rank(right) - rank(left));
}
