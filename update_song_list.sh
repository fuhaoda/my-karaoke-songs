#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mv_path_0="/Volumes/Public Files/media3/MyFavMV"
mv_path_1="/Volumes/Public Files/media3/AudioBooks/NewMV"
mv_path_2="/Volumes/Public Files/media3/AudioBooks/群星.-《经典MV 888首》双音轨卡拉OK（原声.伴奏）经典歌曲_KTV_MTV_MV_首首经典_在家KTV首选_经典老歌"

out="$ROOT_DIR/media_filenames.txt"
jing_file="$ROOT_DIR/靖菡老师.md"
tbd_file="$ROOT_DIR/To be downloaded.md"

# Media extensions to include (case-insensitive)
find_expr=(
  -type f
  ! -path '*/.*'
  \( -iname "*.mp3" -o -iname "*.flac" -o -iname "*.m4a" -o -iname "*.wav" -o -iname "*.aac" -o -iname "*.ogg" -o -iname "*.wma" -o -iname "*.aiff" -o -iname "*.alac" -o -iname "*.mp4" -o -iname "*.mkv" -o -iname "*.avi" -o -iname "*.mov" -o -iname "*.webm" \)
  -print0
)

# Step 1: build media_filenames.txt (without clobbering on missing mounts)
tmp_out="$(mktemp)"
found_dir=0

for d in "$mv_path_0" "$mv_path_1" "$mv_path_2"; do
  if [[ -d "$d" ]]; then
    found_dir=1
    find "$d" "${find_expr[@]}"
  else
    echo "WARN: not a directory: $d" >&2
  fi
done \
| xargs -0 -n 1 basename \
| LC_ALL=C sort -u > "$tmp_out"

if [[ "$found_dir" -eq 1 ]]; then
  mv "$tmp_out" "$out"
  echo "Wrote $(wc -l < "$out") lines to $out"
else
  rm -f "$tmp_out"
  if [[ -f "$out" ]]; then
    echo "WARN: no media directories available; keeping existing $out" >&2
  else
    echo "WARN: no media directories and no existing $out; creating empty file" >&2
    : > "$out"
  fi
fi

# Step 2+3: update 靖菡老师.md and To be downloaded.md
python3 - "$jing_file" "$tbd_file" "$out" <<'PY'
import re
import sys
from pathlib import Path

jing_path = Path(sys.argv[1])
tbd_path = Path(sys.argv[2])
media_path = Path(sys.argv[3])

CJK_RE = re.compile(r'[\u3400-\u9fff]')
PUNCT_RE = re.compile(r"[\s\-—_·•()（）\[\]【】,，.。!！?？\"“”'’:：;；&＆+/\\]+")

def has_cjk(s: str) -> bool:
    return bool(CJK_RE.search(s))

def simp(s: str) -> str:
    mp = {
        '鄧': '邓', '麗': '丽', '華': '华', '臺': '台', '開': '开', '鳳': '凤', '樂': '乐',
        '憂': '忧', '與': '与', '後': '后', '麼': '么', '勝': '胜'
    }
    return ''.join(mp.get(c, c) for c in s)

def norm(s: str) -> str:
    return PUNCT_RE.sub('', simp(s)).lower()

def extract_title(text: str) -> str:
    left = re.split(r'[（(]', text, 1)[0].strip()
    low = left.lower()
    if low.startswith('five hundred miles'):
        return 'Five Hundred Miles'
    if low.startswith('you raise me up'):
        return 'you raise me up'

    toks = left.split()
    if not toks:
        return left

    if has_cjk(toks[0]):
        return toks[0]

    for i in range(1, len(toks)):
        if has_cjk(toks[i]):
            return ' '.join(toks[:i]).strip()

    if len(toks) >= 2:
        return ' '.join(toks[:-1]).strip()
    return toks[0]

def parse_media_titles(lines):
    titles = []
    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        base = re.sub(r'\.[^.]+$', '', s)
        base = re.sub(r'^\d+[\-_\s]*', '', base)
        if ' - ' in base:
            left = base.split(' - ', 1)[0].strip()
        elif '-' in base:
            left = base.split('-', 1)[0].strip()
        else:
            left = base.strip()
        titles.append(extract_title(left))
    return titles

def is_downloaded(title, media_keys):
    k = norm(title)
    if not k:
        return False
    if k in media_keys:
        return True
    if len(k) < 4:
        return False
    for mk in media_keys:
        if len(mk) >= 4 and (k in mk or mk in k):
            return True
    return False

media_titles = parse_media_titles(media_path.read_text(encoding='utf-8').splitlines())
media_keys = {norm(x) for x in media_titles if x}

# Update 靖菡老师.md download marks while preserving phrase text.
jing_lines = jing_path.read_text(encoding='utf-8').splitlines()
new_jing = []
undownloaded_prefixes = []
undownloaded_titles = []
jing_entry_count = 0

entry_re = re.compile(r'^-\s*(.*?)（([^）]*)）(?:\s*-\s*已下载)?\s*$')
for ln in jing_lines:
    m = entry_re.match(ln.strip())
    if not m:
        new_jing.append(ln)
        continue

    jing_entry_count += 1
    prefix = m.group(1).strip()
    phrase = m.group(2).strip()
    title = extract_title(prefix)
    downloaded = is_downloaded(title, media_keys)

    out = f'- {prefix}（{phrase}）'
    if downloaded:
        out += ' - 已下载'
    else:
        undownloaded_prefixes.append(prefix)
        undownloaded_titles.append(title)

    new_jing.append(out)

jing_path.write_text('\n'.join(new_jing).rstrip() + '\n', encoding='utf-8')

# Rebuild To be downloaded.md
tbd_lines = tbd_path.read_text(encoding='utf-8').splitlines()
header = []
old_items = []
for ln in tbd_lines:
    m = re.match(r'^\s*\d+\.\s*(.+)$', ln.strip())
    if m:
        old_items.append(m.group(1).strip())
    else:
        header.append(ln)

front_items = [f'{p}（靖菡老师未下载优先）' for p in undownloaded_prefixes]
front_keys = [norm(extract_title(p)) for p in undownloaded_prefixes]
front_set = set(front_keys)

final_items = []
seen = set()
for item, key in zip(front_items, front_keys):
    if key and key not in seen:
        final_items.append(item)
        seen.add(key)

removed_dup = 0
removed_downloaded = 0
for item in old_items:
    title = extract_title(item)
    key = norm(title)
    if not key:
        continue
    if key in front_set or key in seen:
        removed_dup += 1
        continue
    if is_downloaded(title, media_keys):
        removed_downloaded += 1
        continue
    final_items.append(item)
    seen.add(key)

new_tbd = []
new_tbd.extend(header)
if new_tbd and new_tbd[-1].strip() != '':
    new_tbd.append('')
for i, item in enumerate(final_items, 1):
    new_tbd.append(f'{i}. {item}')

tbd_path.write_text('\n'.join(new_tbd).rstrip() + '\n', encoding='utf-8')

old_set = {norm(extract_title(x)) for x in old_items}
already_in_old = [t for t in undownloaded_titles if norm(t) in old_set]
missing_in_old = [t for t in undownloaded_titles if norm(t) not in old_set]

print('----- update summary -----')
print(f'靖菡老师 entries: {jing_entry_count}')
print(f'靖菡老师 undownloaded: {len(undownloaded_titles)}')
print(f'old To-be entries: {len(old_items)}')
print(f'overlap with old To-be: {len(already_in_old)}')
print(f'not in old To-be: {len(missing_in_old)}')
print(f'removed duplicates from old To-be: {removed_dup}')
print(f'removed downloaded from old To-be: {removed_downloaded}')
print(f'final To-be entries: {len(final_items)}')
print('already in old To-be: ' + (' | '.join(already_in_old) if already_in_old else '(none)'))
print('missing in old To-be: ' + (' | '.join(missing_in_old) if missing_in_old else '(none)'))
PY
