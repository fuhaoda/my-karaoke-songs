#!/usr/bin/env bash
set -euo pipefail

mv_path_0="/Volumes/Public Files/media3/MyFavMV"
mv_path_1="/Volumes/Public Files/media3/AudioBooks/NewMV"
mv_path_2="/Volumes/Public Files/media3/AudioBooks/群星.-《经典MV 888首》双音轨卡拉OK（原声.伴奏）经典歌曲_KTV_MTV_MV_首首经典_在家KTV首选_经典老歌"

out="media_filenames.txt"

# Media extensions to include (case-insensitive)
find_expr=(
  -type f
  ! -path '*/.*'
  \( -iname "*.mp3" -o -iname "*.flac" -o -iname "*.m4a" -o -iname "*.wav" -o -iname "*.aac" -o -iname "*.ogg" -o -iname "*.wma" -o -iname "*.aiff" -o -iname "*.alac" -o -iname "*.mp4" -o -iname "*.mkv" -o -iname "*.avi" -o -iname "*.mov" -o -iname "*.webm" \)
  -print0
)

# Write headerless list: one filename per line (basename only), de-duplicated, sorted
: > "$out"
for d in "$mv_path_0" "$mv_path_1" "$mv_path_2"; do
  if [[ -d "$d" ]]; then
    find "$d" "${find_expr[@]}"
  else
    echo "WARN: not a directory: $d" >&2
  fi
done \
| xargs -0 -n 1 basename \
| LC_ALL=C sort -u > "$out"

echo "Wrote $(wc -l < "$out") lines to ./$out"
