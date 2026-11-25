import { parseCatalog, searchCatalog } from "./catalog.mjs";

const SOURCE_URL =
  "https://raw.githubusercontent.com/fuhaoda/my-karaoke-songs/main/media_filenames.txt";
const ISSUE_URL = "https://github.com/fuhaoda/my-karaoke-songs/issues/new";
const PAGE_SIZE = 40;
const $ = (id) => document.getElementById(id);
const state = {
  catalog: [],
  matches: [],
  page: 1,
  ready: false,
  loading: false,
};
const formatNumber = (number) => number.toLocaleString("en-US");
let searchTimer;
let toastTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 4000);
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(message);
  } catch {
    const field = element("textarea", "copy-fallback");
    field.value = text;
    field.setAttribute("aria-label", "请复制这段文字");
    const dialog = element("dialog");
    dialog.append(element("p", "", "请长按或选中下方文字复制。"), field);
    const close = element("button", "primary-button", "完成");
    close.type = "button";
    close.addEventListener("click", () => dialog.close());
    dialog.append(close);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    field.focus();
    field.select();
  }
}

function updateUrl() {
  const url = new URL(location.href);
  const query = $("search").value.trim();
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");
  if ($("language").value !== "all")
    url.searchParams.set("lang", $("language").value);
  else url.searchParams.delete("lang");
  if (url.href !== location.href) history.replaceState(null, "", url);
}

function renderRow(song, position) {
  const row = element("article", "song-row");
  const main = element("div", "song-main");
  const title = element("h3", "song-title", song.title);
  if (song.version) title.append(element("span", "song-version", song.version));
  const details = element("details", "file-details");
  details.append(
    element("summary", "", "查看文件名"),
    element("code", "", song.filename),
  );
  const copy = element("button", "copy-song", "复制歌名");
  copy.type = "button";
  copy.setAttribute(
    "aria-label",
    `复制 ${song.title}${song.artist ? ` · ${song.artist}` : ""}`,
  );
  copy.addEventListener("click", () =>
    copyText(
      `${song.title}${song.artist ? ` - ${song.artist}` : ""}`,
      "歌名已复制，可以发给朋友了。",
    ),
  );
  details.append(document.createElement("br"), copy);
  main.append(title, details);
  row.append(
    element("span", "song-number", String(position).padStart(2, "0")),
    main,
    element("p", "song-artist", song.artist || "歌手见文件名"),
    element("span", "language-badge", song.language),
    element("span", "available-badge", "有这首"),
  );
  return row;
}

function renderResults() {
  if (!state.ready) return;
  const query = $("search").value.trim();
  const filtered = $("language").value !== "all";
  $("results-heading").textContent = query
    ? `“${query}”的搜索结果`
    : "随手翻翻歌库";
  $("results-kicker").textContent = query
    ? "FIND YOUR NEXT SONG"
    : "THE COLLECTION";
  $("clear-search").hidden = !query;
  $("language").classList.toggle("filter-active", filtered);
  const total = state.matches.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, total);
  $("results-count").textContent = total
    ? `${query || filtered ? "找到" : "共"} ${formatNumber(total)} 个歌曲文件${total > PAGE_SIZE ? ` · 当前 ${start + 1}–${end}` : ""} · 不同版本分别列出`
    : "没有匹配的歌曲文件";
  const fragment = document.createDocumentFragment();
  state.matches
    .slice(start, end)
    .forEach((song, index) =>
      fragment.append(renderRow(song, start + index + 1)),
    );
  $("results").replaceChildren(fragment);
  $("results").hidden = total === 0;
  $("empty-state").hidden = total !== 0;
  $("empty-message").textContent = query
    ? `没有找到匹配“${query}”的歌。试试减少关键字，或把想唱的歌推荐给我。`
    : "这个语言分类暂时没有歌曲，试试其他分类。";
  $("filter-hint").hidden = !filtered;
  $("pagination").hidden = pages <= 1;
  $("page-status").textContent = `第 ${state.page} / ${pages} 页`;
  $("previous-page").disabled = state.page === 1;
  $("next-page").disabled = state.page === pages;
}

function runSearch({ resetPage = true, updateAddress = true } = {}) {
  clearTimeout(searchTimer);
  if (!state.ready) return;
  if (resetPage) state.page = 1;
  state.matches = searchCatalog(state.catalog, $("search").value, {
    language: $("language").value,
  });
  if (updateAddress) updateUrl();
  renderResults();
}

async function fetchCatalog(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      cache: "no-cache",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    // A proxy error page must never look like a valid catalog.
    if (/<(?:!doctype|html|head|body)\b/i.test(text))
      throw new Error("Unexpected HTML response");
    const parsed = parseCatalog(text);
    if (!parsed.length) throw new Error("Empty catalog");
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

function populateLanguages() {
  const previous =
    new URL(location.href).searchParams.get("lang") || $("language").value;
  const languages = [...new Set(state.catalog.map((song) => song.language))];
  const preferred = [
    "国语",
    "粤语",
    "闽南",
    "英语",
    "日语",
    "韩语",
    "其它",
    "未标注",
  ];
  languages.sort((a, b) => {
    const left = preferred.indexOf(a),
      right = preferred.indexOf(b);
    return (
      (left < 0 ? 99 : left) - (right < 0 ? 99 : right) ||
      a.localeCompare(b, "zh-CN")
    );
  });
  $("language").replaceChildren(new Option("全部语言", "all"));
  languages.forEach((language) =>
    $("language").append(new Option(language, language)),
  );
  $("language").value = languages.includes(previous) ? previous : "all";
}

async function loadCatalog() {
  if (state.loading) return;
  state.loading = true;
  $("catalog-section").setAttribute("aria-busy", "true");
  $("source-notice").hidden = true;
  $("error-state").hidden = true;
  $("collection-status").textContent = "正在打开歌库…";
  let backup = false;
  try {
    try {
      state.catalog = await fetchCatalog(SOURCE_URL);
    } catch {
      state.catalog = await fetchCatalog("./media_filenames.txt");
      backup = true;
    }
    state.ready = true;
    populateLanguages();
    $("collection-status").textContent =
      `${formatNumber(state.catalog.length)} 个歌曲文件 · ${backup ? "备份清单" : "最新清单已载入"}`;
    if (backup) {
      $("source-message").textContent =
        "暂时无法读取最新曲库，当前使用发布时的备份清单。";
      $("source-notice").hidden = false;
    }
    runSearch();
  } catch {
    if (state.ready) {
      $("collection-status").textContent =
        `${formatNumber(state.catalog.length)} 个歌曲文件 · 本次未能刷新`;
      $("source-message").textContent = "刷新失败，当前保留已载入的曲库。";
      $("source-notice").hidden = false;
    } else {
      $("collection-status").textContent = "曲库暂时无法载入";
      $("results-count").textContent = "请重新加载后再搜索";
      $("results").hidden = true;
      $("empty-state").hidden = true;
      $("pagination").hidden = true;
      $("error-state").hidden = false;
    }
  } finally {
    state.loading = false;
    $("catalog-section").setAttribute("aria-busy", "false");
  }
}

function openSuggestion() {
  $("suggest-song").setCustomValidity("");
  $("suggest-song").value = $("search").value.trim().slice(0, 120);
  $("suggest-artist").value = "";
  $("suggest-note").value = "";
  $("suggest-dialog").showModal();
  $("suggest-song").focus();
}

const initialUrl = new URL(location.href);
$("search").value = (initialUrl.searchParams.get("q") || "").slice(0, 200);
$("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});
$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(), 100);
});
$("language").addEventListener("change", () => runSearch());
$("clear-search").addEventListener("click", () => {
  $("search").value = "";
  runSearch();
  $("search").focus();
});
document.querySelectorAll("[data-query]").forEach((button) =>
  button.addEventListener("click", () => {
    $("search").value = button.dataset.query;
    runSearch();
  }),
);
document
  .querySelectorAll("[data-suggest]")
  .forEach((button) => button.addEventListener("click", openSuggestion));
for (const id of ["retry-load", "retry-error"])
  $(id).addEventListener("click", loadCatalog);
for (const [id, increment] of [
  ["previous-page", -1],
  ["next-page", 1],
])
  $(id).addEventListener("click", () => {
    state.page += increment;
    renderResults();
    $("catalog-section").scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
  });
$("share-search").addEventListener("click", () => {
  updateUrl();
  copyText(location.href, "搜索链接已复制，发给朋友就能直接打开。");
});
$("close-suggest").addEventListener("click", () => $("suggest-dialog").close());
$("suggest-dialog").addEventListener("click", (event) => {
  if (event.target === $("suggest-dialog")) {
    const bounds = event.target.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      event.target.close();
  }
});
$("suggest-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const song = $("suggest-song").value.trim();
  const artist = $("suggest-artist").value.trim();
  if (!song) {
    $("suggest-song").setCustomValidity("请输入歌名");
    $("suggest-song").reportValidity();
    return;
  }
  if (song.length > 120 || artist.length > 120) {
    showToast("歌名和歌手请分别控制在 120 字以内。");
    return;
  }
  const url = new URL(ISSUE_URL);
  url.searchParams.set("template", "recommend-song.yml");
  url.searchParams.set(
    "title",
    `[歌曲推荐] ${song}${artist ? ` - ${artist}` : ""}`.slice(0, 100),
  );
  url.searchParams.set("song", song);
  if (artist) url.searchParams.set("artist", artist);
  if ($("suggest-note").value.trim())
    url.searchParams.set("note", $("suggest-note").value.trim().slice(0, 300));
  window.open(url.href, "_blank", "noopener,noreferrer");
  // Do not report success: visitors still need to confirm on GitHub.
  $("suggest-dialog").close();
});
$("suggest-song").addEventListener("input", () =>
  $("suggest-song").setCustomValidity(""),
);
window.addEventListener("popstate", () => {
  const params = new URL(location.href).searchParams;
  $("search").value = (params.get("q") || "").slice(0, 200);
  $("language").value = [...$("language").options].some(
    (option) => option.value === params.get("lang"),
  )
    ? params.get("lang")
    : "all";
  runSearch({ updateAddress: false });
});
loadCatalog();
