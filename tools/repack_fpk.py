#!/usr/bin/env python3
"""Repack only the verified 1.4.51 FPK, rotating its Ed25519 public key.
Preserves tar member permissions and updates manifest payload MD5 checksum.
Does not extract archives to disk or alter runtime databases.
"""
import argparse
import base64
import hashlib
import io
import json
import pathlib
import re
import tarfile

FPK_HASH = 'd42f552cafa578500e287c5a53dcb1d5b6d9f2ef1ef12d3b20ff3b1b52b7c06e'
SERVER_HASH = 'ce7b3d8a5d5b46470a51349f0dc357086c95476bb46a73f2ec3537da78432ef8'
OLD_PUBLIC = b'v08PqUbX9oNfLruLg3oDEVuTbM+koZ5uG2Qf5rIDYhw='

def rotate(data, public):
    if hashlib.sha256(data).hexdigest() != SERVER_HASH:
        raise ValueError('Original server SHA256 mismatch')
    if len(base64.b64decode(public, validate=True)) != 32 or base64.b64encode(base64.b64decode(public)) != public:
        raise ValueError('Expected a standard Base64 Ed25519 public key')
    if public == OLD_PUBLIC:
        raise ValueError('New key is identical to original key')
    if data.count(OLD_PUBLIC) != 1:
        raise ValueError('Original public key is not unique')
    return data.replace(OLD_PUBLIC, public), data.index(OLD_PUBLIC)

def rebuild(data, replacements):
    output = io.BytesIO()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as src, tarfile.open(fileobj=output, mode='w:gz') as dst:
        remaining = set(replacements)
        for member in src.getmembers():
            name = member.name.removeprefix('./')
            if name in replacements:
                if not member.isfile(): raise ValueError('Replacement target must be a file')
                content = replacements[name]
                member.size = len(content)
                dst.addfile(member, io.BytesIO(content))
                remaining.remove(name)
            else:
                dst.addfile(member, src.extractfile(member) if member.isfile() else None)
        if remaining: raise ValueError('Missing tar members: ' + ', '.join(remaining))
    return output.getvalue()

def member_data(data, wanted):
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        members = [m for m in archive.getmembers() if m.name.removeprefix('./') == wanted and m.isfile()]
        if len(members) != 1: raise ValueError('Missing or duplicate member: ' + wanted)
        return archive.extractfile(members[0]).read()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fpk', required=True)
    parser.add_argument('--public', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    source, target = pathlib.Path(args.fpk).resolve(), pathlib.Path(args.out).resolve()
    if source == target or target.exists(): raise ValueError('Output must be a new file')
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != FPK_HASH: raise ValueError('Original FPK SHA256 mismatch')
    public = pathlib.Path(args.public).read_bytes().strip()
    payload = member_data(data, 'app.tgz')
    server = member_data(payload, 'server/la-erp-server')
    migrated, offset = rotate(server, public)
    new_payload = rebuild(payload, {'server/la-erp-server': migrated})
    manifest = member_data(data, 'manifest').decode('utf-8')
    old_checksum = re.search(r'(?m)^checksum\s*=\s*(\S+)', manifest)
    if not old_checksum or old_checksum[1] != hashlib.md5(payload).hexdigest(): raise ValueError('Original manifest checksum mismatch')
    new_checksum = hashlib.md5(new_payload).hexdigest()
    manifest = re.sub(r'(?m)^checksum\s*=.*$', 'checksum                   = ' + new_checksum, manifest)
    manifest = re.sub(r'(?m)^fpk_version\s*=.*$', 'fpk_version                = 1.4.51-recovery', manifest)
    result = rebuild(data, {'app.tgz': new_payload, 'manifest': manifest.encode('utf-8')})
    # Validate the result before committing the output file.
    check_payload = member_data(result, 'app.tgz')
    check_server = member_data(check_payload, 'server/la-erp-server')
    if check_server != migrated or hashlib.md5(check_payload).hexdigest() != new_checksum: raise ValueError('Repack validation failed')
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as out: out.write(result)
    report = {'input_sha256': FPK_HASH, 'output_sha256': hashlib.sha256(result).hexdigest(), 'server_sha256': hashlib.sha256(migrated).hexdigest(), 'public_key_offset': offset, 'changed_server_bytes': sum(a != b for a, b in zip(server, migrated)), 'payload_md5': new_checksum}
    target.with_suffix('.manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))

if __name__ == '__main__': main()
