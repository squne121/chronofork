"""Generate the route A assets with Blender (not ordinary Python).

From the experiment directory:
    blender --background --python route-a/generate.py

The output is public/a/{block,taper,tiered}.glb. Blender's glTF exporter converts
Z-up coordinates to glTF Y-up, placing each part's base at the origin.
"""

from pathlib import Path

import bpy


OUTPUT = Path(__file__).resolve().parent.parent / "public" / "a"


def export_part(kind, top_half_width):
    # Blender X east, Y north, Z up. Both horizontal extents are one at
    # ground level; the top extents are one or 0.6 respectively.
    bottom = [(-0.5, -0.5, 0), (0.5, -0.5, 0), (0.5, 0.5, 0), (-0.5, 0.5, 0)]
    h = top_half_width
    top = [(-h, -h, 1), (h, -h, 1), (h, h, 1), (-h, h, 1)]
    # Winding points outward, including the underside.
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    export_mesh(kind, bottom + top, faces)


def export_mesh(kind, vertices, faces):
    bpy.ops.object.select_all(action="DESELECT")
    mesh = bpy.data.meshes.new(kind)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(kind, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT / f"{kind}.glb"),
        export_format="GLB",
        export_yup=True,
        use_selection=True,
    )


OUTPUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
export_part("block", 0.5)
export_part("taper", 0.3)
# Four horizontal rings: ground, outer ledge, inner ledge, and roof.
rings = [(-0.5, 0), (-0.5, 0.7), (-0.275, 0.7), (-0.275, 1)]
vertices = []
for lo, z in rings:
    hi = -lo
    vertices.extend([(lo, lo, z), (hi, lo, z), (hi, hi, z), (lo, hi, z)])
faces = [(3, 2, 1, 0), (12, 13, 14, 15)]
for lower in (0, 4, 8):
    for i in range(4):
        j = (i + 1) % 4
        faces.append((lower + i, lower + j, lower + 4 + j, lower + 4 + i))
export_mesh("tiered", vertices, faces)
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / "parts.blend"))
