import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeSearch,
  parseCatalog,
  searchCatalog,
  tokenizeQuery,
} from "../web/catalog.mjs";

const inventory = [
  "001 爱 - 小虎队.mkv",
  "2020-2002年的第一场雪-刀郎.mkv",
  "659 听海 张惠妹.mkv",
  "七里香 周杰伦.mkv",
  "张学友-祝福-国语-流行歌曲.mkv",
  "张学友-情书-国语-流行歌曲.mkv",
  "蔡依林-倒带(演)-国语-流行歌曲.mkv",
  "张学友-爱是永恒(双语种)-粤语-流行歌曲.mkv",
  "Lady Gaga-Poker Face-英语-流行歌曲.MKV",
  "Kelly Clarkson-Behind These Hazel Eyes.mkv",
  "Five Hundred Miles Hedy West.mkv",
  "Yesterday Once More Carpenters.mkv",
  "When You Believe Whitney Houston Mariah Carey.mkv",
  "任贤齐-对折.mkv",
  "1010-伤心太平洋-任贤齐.mkv",
  "K歌之王—华语-陈奕迅.mkv",
  "陈奕迅-十年-国-流行歌曲.mkv",
  "某人-测试(续集)-国语-流行歌曲.mkv",
].join("\n");
const catalog = parseCatalog(inventory);
const song = (filename) => catalog.find((entry) => entry.filename === filename);

test("parses numbered title-first and whitespace title-artist records", () => {
  assert.equal(song("001 爱 - 小虎队.mkv").title, "爱");
  assert.equal(song("001 爱 - 小虎队.mkv").artist, "小虎队");
  assert.equal(song("659 听海 张惠妹.mkv").title, "听海");
  assert.equal(song("659 听海 张惠妹.mkv").artist, "张惠妹");
  assert.equal(song("七里香 周杰伦.mkv").artist, "周杰伦");
});

test("keeps the year in a numeric song title after removing its collection index", () => {
  assert.equal(
    song("2020-2002年的第一场雪-刀郎.mkv").title,
    "2002年的第一场雪",
  );
  assert.equal(song("2020-2002年的第一场雪-刀郎.mkv").artist, "刀郎");
});

test("recognizes singer-first records and disambiguates known title-first artists", () => {
  assert.equal(song("张学友-祝福-国语-流行歌曲.mkv").title, "祝福");
  assert.equal(song("张学友-祝福-国语-流行歌曲.mkv").language, "国语");
  assert.equal(song("任贤齐-对折.mkv").title, "对折");
  assert.equal(song("任贤齐-对折.mkv").artist, "任贤齐");
  assert.equal(song("K歌之王—华语-陈奕迅.mkv").title, "K歌之王—华语");
  assert.equal(song("K歌之王—华语-陈奕迅.mkv").artist, "陈奕迅");
  assert.equal(song("陈奕迅-十年-国-流行歌曲.mkv").language, "国语");
});

test("preserves complete English titles and their performers", () => {
  assert.equal(
    song("Lady Gaga-Poker Face-英语-流行歌曲.MKV").title,
    "Poker Face",
  );
  assert.equal(song("Lady Gaga-Poker Face-英语-流行歌曲.MKV").format, "MKV");
  assert.equal(
    song("Kelly Clarkson-Behind These Hazel Eyes.mkv").title,
    "Behind These Hazel Eyes",
  );
  assert.equal(
    song("Five Hundred Miles Hedy West.mkv").title,
    "Five Hundred Miles",
  );
  assert.equal(
    song("Yesterday Once More Carpenters.mkv").title,
    "Yesterday Once More",
  );
  assert.equal(
    song("When You Believe Whitney Houston Mariah Carey.mkv").title,
    "When You Believe",
  );
  assert.equal(
    parseCatalog("Unknown English Title And Artist.mkv")[0].title,
    "Unknown English Title And Artist",
  );
});

test("separates only confirmed version suffixes from song names", () => {
  assert.equal(song("蔡依林-倒带(演)-国语-流行歌曲.mkv").title, "倒带");
  assert.equal(song("蔡依林-倒带(演)-国语-流行歌曲.mkv").version, "演");
  assert.equal(
    song("张学友-爱是永恒(双语种)-粤语-流行歌曲.mkv").version,
    "双语种",
  );
  assert.equal(song("某人-测试(续集)-国语-流行歌曲.mkv").title, "测试(续集)");
});

test("AND search requires all keywords to occur in the same recording", () => {
  assert.deepEqual(
    searchCatalog(catalog, "张学友 祝福").map((entry) => entry.title),
    ["祝福"],
  );
  assert.equal(searchCatalog(catalog, "张学友 七里香").length, 0);
  assert.deepEqual(
    searchCatalog(catalog, "pOkEr，GAGA + FACE").map((entry) => entry.title),
    ["Poker Face"],
  );
  assert.equal(
    searchCatalog(catalog, "Hedy West Five Hundred Miles").length,
    1,
  );
});

test("normalizes fullwidth text, case, punctuation, and repeated query terms", () => {
  assert.equal(normalizeSearch(" Ｐｏｋｅｒ—ＦＡＣＥ! "), "pokerface");
  assert.deepEqual(tokenizeQuery("张学友，祝福、张学友； ＭＫＶ"), [
    "张学友",
    "祝福",
    "mkv",
  ]);
  assert.deepEqual(tokenizeQuery(" ; + — "), []);
});

test("filters marked or unmarked language without inferring language from artist", () => {
  assert.equal(song("七里香 周杰伦.mkv").language, "未标注");
  assert.equal(
    searchCatalog(catalog, "周杰伦", { language: "国语" }).length,
    0,
  );
  assert.equal(
    searchCatalog(catalog, "周杰伦", { language: "未标注" }).length,
    1,
  );
  assert.equal(searchCatalog(catalog, "十年", { language: "国" }).length, 1);
  assert.equal(searchCatalog(catalog, "", { language: "粤语" }).length, 1);
});

test("retains separate versions, removes only duplicate filenames, and skips malformed lines", () => {
  const records = parseCatalog(
    "\uFEFF童话 光良.mkv\r\n童话 光良.mkv\n光良-童话-国语-流行歌曲.mkv\n\nnotes.txt\n.hidden.mkv\n.mkv\n/folder/song.mkv\nbad\0name.mkv",
  );
  assert.equal(records.length, 2);
  assert.ok(records.every((entry) => entry.title === "童话"));
  assert.notEqual(records[0].id, records[1].id);
  assert.deepEqual(parseCatalog(null), []);
});

test("ranks exact song titles before partial-title matches and preserves input records", () => {
  const entries = parseCatalog(
    "某人-祝福你-国语-流行歌曲.mkv\n张学友-祝福-国语-流行歌曲.mkv",
  );
  assert.deepEqual(
    searchCatalog(entries, "祝福").map((entry) => entry.title),
    ["祝福", "祝福你"],
  );
  assert.equal(entries[0].title, "祝福你");
});

test("the full checked-in catalog remains searchable with one record per filename", () => {
  const filenames = readFileSync(
    new URL("../media_filenames.txt", import.meta.url),
    "utf8",
  );
  const entries = parseCatalog(filenames);
  assert.equal(entries.length, new Set(filenames.trim().split("\n")).size);
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.ok(entry.title && entry.filename && entry.searchText);
    assert.equal(searchCatalog([entry], entry.filename).length, 1);
  }
  assert.ok(searchCatalog(entries, "周杰伦 七里香").length > 0);
  assert.ok(
    searchCatalog(entries, "任贤齐 对折").some(
      (entry) => entry.title === "对折",
    ),
  );
  assert.ok(
    searchCatalog(entries, "lady poker face").some(
      (entry) => entry.artist === "Lady Gaga",
    ),
  );
});
