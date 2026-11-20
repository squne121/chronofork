"""Generate the editable Blender source and GLB from the frozen common city input."""
import bpy
import json
import math
import os
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'city.json'), encoding='utf-8') as f:
    city = json.load(f)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def material(name, hex_color):
    rgb = [int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*rgb, 1)
    mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = .9
    return mat


mats = {k: material(k, v) for k, v in {
    'terrain': '8e8b7b', 'fortress': 'b4ac9c', 'bridge': 'a09a8c',
    'district': 'aaa390', 'broad': 'c0b29c', 'tall': 'aba99e',
}.items()}


def point(p):
    return (p[0], -p[2], p[1])


def group(name):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    return obj


def box(name, center, size, mat, parent, bevel=.10):
    bpy.ops.mesh.primitive_cube_add(size=1, location=point(center))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mats[mat])
    obj.parent = parent
    if bevel:
        mod = obj.modifiers.new('Editable edge softening', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.affect = 'EDGES'
    return obj


def beam(name, start, end, width, depth, mat, parent):
    a, b = Vector(point(start)), Vector(point(end))
    obj = box(name, (0, 0, 0), (width, (b-a).length, depth), mat, parent, .06)
    obj.location = (a+b)/2
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (b-a).to_track_quat('Z', 'Y')
    # box's vertical dimension is local Z, which the quaternion aligns to the span.
    return obj


terrain = group('terrain')
box('low ground', (0, -1, -11), (48, 2, 22), 'terrain', terrain, .15)
# Cut a bridge-width approach into the cliff so the deck reaches the gate.
cut = city['bridge']['width'] + .8
for side in (-1, 1):
    width = 24 - cut / 2
    box('high cliff', (side * (cut / 2 + width / 2), 2, 10), (width, 8, 20), 'terrain', terrain, .15)
a, b = city['bridge']['start'], city['bridge']['end']
cliff_z = city['terrain']['cliffZ']
box('high ground behind gate', (0, 2, (b[2]+20)/2), (cut, 8, 20-b[2]), 'terrain', terrain, .05)
t = (cliff_z - a[2]) / (b[2] - a[2])
cliff_y = a[1] + (b[1] - a[1]) * t
verts_world = [(-cut/2, -2, cliff_z), (cut/2, -2, cliff_z), (cut/2, -2, b[2]), (-cut/2, -2, b[2]),
               (-cut/2, cliff_y - .5, cliff_z), (cut/2, cliff_y - .5, cliff_z),
               (cut/2, b[1] - .5, b[2]), (-cut/2, b[1] - .5, b[2])]
mesh = bpy.data.meshes.new('approach cutting mesh')
mesh.from_pydata([point(v) for v in verts_world], [], [(1,2,3,0), (7,6,5,4), (4,5,1,0), (5,6,2,1), (6,7,3,2), (7,4,0,3)])
mesh.update()
approach = bpy.data.objects.new('approach cutting', mesh)
bpy.context.collection.objects.link(approach)
approach.parent = terrain
approach.data.materials.append(mats['terrain'])

# Individual irregular cliff spurs soften the straight escarpment silhouette.
for i, (cx, width, height, projection) in enumerate([
    (-20, 7, 4.6, 2.3), (-13, 6, 5.5, 1.6), (-7, 5, 4.1, 2.1),
    (7, 5, 5.0, 1.8), (13, 6, 4.3, 2.4), (20, 7, 5.2, 1.7),
]):
    vertices = [(cx-width/2, 0, 0), (cx+width/2, 0, 0), (cx, 0, -projection),
                (cx-width*.38, height, 0), (cx+width*.34, height*.91, 0),
                (cx+.3, height*.55, -projection*.7)]
    rock_mesh = bpy.data.meshes.new('cliff spur mesh')
    rock_mesh.from_pydata([point(v) for v in vertices], [], [(0,2,1), (3,4,5), (0,1,4,3), (1,2,5,4), (2,0,3,5)])
    rock_mesh.update()
    rock = bpy.data.objects.new('cliff spur %02d' % i, rock_mesh)
    bpy.context.collection.objects.link(rock)
    rock.parent = terrain
    rock.data.materials.append(mats['terrain'])
    bevel = rock.modifiers.new('Rock edge rounding', 'BEVEL')
    bevel.width = .12
    bevel.segments = 2

for d in city['districts']:
    root = group(d['id'])
    x, y, z = d['center']
    box('district paving', (x, y + .035, z), (d['size'][0], .07, d['size'][1]), 'district', root, .04)
    # Low boundary stones define each block without filling it with tiny detail.
    for side in (-1, 1):
        box('district edge', (x, y+.12, z+side*(d['size'][1]/2-.12)), (d['size'][0], .24, .24), 'bridge', root, .04)
        box('district edge', (x+side*(d['size'][0]/2-.12), y+.12, z), (.24, .24, d['size'][1]), 'bridge', root, .04)

for b in city['buildings']:
    root = group(b['id'])
    x, y, z = b['position']
    w, h, depth = b['size']
    box('building body', (x, y + h/2, z), (w, h, depth), b['type'], root, .10)
    # Broad, low stepped roofs and slender, tall tiered roofs have distinct silhouettes.
    if b['type'] == 'broad':
        roof_vertices = [(x-w*.55,y+h,z-depth*.55), (x+w*.55,y+h,z-depth*.55),
                         (x+w*.55,y+h,z+depth*.55), (x-w*.55,y+h,z+depth*.55),
                         (x,y+h+.8,z-depth*.55), (x,y+h+.8,z+depth*.55)]
        roof_mesh = bpy.data.meshes.new('gable roof mesh')
        roof_mesh.from_pydata([point(v) for v in roof_vertices], [], [(1,2,3,0), (4,1,0), (2,5,3), (3,5,4,0), (4,5,2,1)])
        roof_mesh.update()
        roof = bpy.data.objects.new('gable roof', roof_mesh)
        bpy.context.collection.objects.link(roof)
        roof.parent = root
        roof.data.materials.append(mats[b['type']])
        bevel = roof.modifiers.new('Roof edge rounding', 'BEVEL')
        bevel.width = .05
        bevel.segments = 2
    else:
        box('roof tier', (x, y+h+.35, z), (w*.68, .7, depth*.68), b['type'], root, .08)
        box('roof cap', (x, y+h+.78, z), (w*.42, .16, depth*.42), b['type'], root, .04)

f = city['fortress']
root = group(f['id'])
x, y, z = f['center']
w, h, d = f['size']
# The front wall is split around the bridge gate; the lintel makes a clear opening.
gate_w = city['bridge']['width'] + .8
for sign in (-1, 1):
    part = (w-gate_w)/2
    box('front wall', (x+sign*(gate_w/2+part/2), y+2, z-d/2), (part, 4, .9), 'fortress', root)
    box('side wall', (x+sign*w/2, y+2, z), (.9, 4, d), 'fortress', root)
box('gate lintel', (x, y+3.65, z-d/2), (gate_w, .7, .9), 'fortress', root)
box('rear wall', (x, y+2, z+d/2), (w, 4, .9), 'fortress', root)
for sx in (-1, 1):
    for sz in (-1, 1):
        box('corner tower', (x+sx*w/2, y+h/2, z+sz*d/2), (2.4, h, 2.4), 'fortress', root, .16)
        box('tower crown', (x+sx*w/2, y+h+.22, z+sz*d/2), (2.7, .44, 2.7), 'fortress', root, .06)
box('inner keep', (x, y+2.6, z+2), (5.5, 5.2, 4), 'fortress', root, .12)

bridge = city['bridge']
root = group(bridge['id'])
a, b = bridge['start'], bridge['end']
beam('sloping deck', [a[0], a[1]-.22, a[2]], [b[0], b[1]-.22, b[2]], bridge['width'], .44, 'bridge', root)
for side in (-1, 1):
    beam('parapet', [a[0]+side*(bridge['width']/2-.15), a[1]+.32, a[2]], [b[0]+side*(bridge['width']/2-.15), b[1]+.32, b[2]], .25, .5, 'bridge', root)
for t in (.30, .60):
    xx = a[0] + (b[0]-a[0])*t
    zz = a[2] + (b[2]-a[2])*t
    yy = a[1] + (b[1]-a[1])*t
    ground = city['terrain']['highY'] if zz >= city['terrain']['cliffZ'] else city['terrain']['lowY']
    if yy > ground+.3:
        box('bridge pier', (xx, (yy+ground)/2, zz), (1.2, yy-ground, 1.2), 'bridge', root)

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'city.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(HERE, 'city.glb'), export_format='GLB', export_apply=True)
