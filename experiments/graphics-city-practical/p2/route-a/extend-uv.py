"""Extend the P0 UV baseline with P1 sidewalk UVs; run before regenerating.

Usage: python3 -I route-a/extend-uv.py ../route-a/city.glb uv-repair-before/city.glb
Checks P1 versus first P2 position, normal and index accessor bytes before copying UVs.
"""
import base64
import json
from pathlib import Path
import struct
import sys


def load(path):
    data = Path(path).read_bytes()
    assert data[:4] == b'glTF'
    size, kind = struct.unpack_from('<I4s', data, 12)
    assert kind == b'JSON'
    doc = json.loads(data[20:20 + size])
    bin_size, kind = struct.unpack_from('<I4s', data, 20 + size)
    assert kind == b'BIN\0'
    return doc, data[28 + size:28 + size + bin_size]


def accessor(doc, binary, number):
    a = doc['accessors'][number]
    v = doc['bufferViews'][a['bufferView']]
    assert v.get('buffer', 0) == 0 and 'byteStride' not in v and 'sparse' not in a
    width = {5121: 1, 5123: 2, 5125: 4, 5126: 4}[a['componentType']]
    count = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return (a['componentType'], a['type'], a['count'], binary[start:start + a['count'] * count * width])


def primitive(doc, name):
    nodes = [n for n in doc['nodes'] if n.get('name') == name]
    assert len(nodes) == 1
    primitives = doc['meshes'][nodes[0]['mesh']]['primitives']
    assert len(primitives) == 1
    return primitives[0]


assert len(sys.argv) == 3, __doc__
before, before_bin = load(sys.argv[1])
after, after_bin = load(sys.argv[2])
path = Path(__file__).with_name('uv-baseline.json')
baseline = json.loads(path.read_text())
for name in ('sidewalk segment', 'sidewalk segment.001', 'sidewalk segment.002'):
    p, q = primitive(before, name), primitive(after, name)
    for key in ('POSITION', 'NORMAL'):
        assert accessor(before, before_bin, p['attributes'][key]) == accessor(after, after_bin, q['attributes'][key]), (name, key)
    assert accessor(before, before_bin, p['indices']) == accessor(after, after_bin, q['indices']), (name, 'indices')
    uv = accessor(before, before_bin, p['attributes']['TEXCOORD_0'])
    target = accessor(after, after_bin, q['attributes']['TEXCOORD_0'])
    assert uv[:3] == target[:3] and uv[0:2] == (5126, 'VEC2')
    baseline[name] = base64.b64encode(uv[3]).decode('ascii')
path.write_text(json.dumps(baseline, indent=2) + '\n')
print('Added P1 sidewalk UVs after confirming position, normal and index bytes')
