#!/usr/bin/env python3
"""Prepare the buildless Karaoke app for any static host, including GitHub Pages."""

import argparse
import shutil
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=root / 'dist')
    args = parser.parse_args()
    output = args.output.resolve()
    sources = [root / 'web' / name for name in
               ('index.html', 'styles.css', 'app.mjs', 'catalog.mjs', 'favicon.svg')]
    sources.append(root / 'media_filenames.txt')
    for source in sources:
        if not source.is_file():
            parser.error(f'Missing source file: {source}')
        if source.resolve() == output / source.name:
            parser.error('Output directory must differ from the source directory')
    output.mkdir(parents=True, exist_ok=True)
    for source in sources:
        shutil.copyfile(source, output / source.name)
    print(f'Prepared {len(sources)} files in {output}')


if __name__ == '__main__':
    main()
