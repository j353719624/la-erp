#!/usr/bin/env python3
"""Safely unpack an FPK and its app.tgz without following archive links."""
import argparse
import pathlib
import tarfile

def unpack(archive, target):
    root = target.resolve()
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            rel = pathlib.PurePosixPath(member.name)
            if rel.is_absolute() or '..' in rel.parts or '\\' in member.name:
                raise ValueError('Unsafe member path')
            dest = root.joinpath(*rel.parts).resolve()
            if not dest.is_relative_to(root): raise ValueError('Path escapes output directory')
            if member.isdir(): dest.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                dest.parent.mkdir(parents=True, exist_ok=True)
                with dest.open('xb') as output, source.extractfile(member) as data:
                    while chunk := data.read(1024 * 1024): output.write(chunk)
                dest.chmod(member.mode & 0o777)
            else: raise ValueError('Archive links and special files are unsupported: ' + member.name)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fpk')
    parser.add_argument('out')
    args = parser.parse_args()
    output = pathlib.Path(args.out)
    if output.exists() and any(output.iterdir()): raise ValueError('Output must be empty or new')
    output.mkdir(parents=True, exist_ok=True)
    unpack(args.fpk, output)
    unpack(output / 'app.tgz', output)
    print('Unpacked:', output.resolve())

if __name__ == '__main__': main()
