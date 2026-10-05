#!/usr/bin/env python3
"""Build Halo Diglett's detailed 3D models (High / Ultra graphics) with Blender, from code.

Every model is made from primitives with bevels and subdivision, gets ambient occlusion baked into
its vertex colours, and is exported as a binary glTF (.glb) into public/models/. The game loads them
only on High / Ultra ("Models & materials: Detailed") and falls back to its built-in procedural models
on any problem.

    python3.11 -m venv tools/models/.venv
    tools/models/.venv/bin/pip install -r tools/models/requirements.txt
    tools/models/.venv/bin/python tools/models/build_models.py            # all models
    tools/models/.venv/bin/python tools/models/build_models.py spartan    # just some

With a Blender install instead of the bpy package:

    blender -b -P tools/models/build_models.py -- spartan

See README.md next to this file for the conventions the game relies on (node names, materials).
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

import bpy  # first: with the pip package, bmesh and mathutils only exist once bpy is loaded

import bmesh  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = ROOT / "public" / "models"

# Coordinates: Blender is Z-up with the models facing +Y. The glTF exporter turns that into three.js's
# Y-up, facing -Z: three (x, y, z) = Blender (x, z, -y). Positions, rotations and scales below are all
# written in three.js terms (as in src/render/models.ts, so numbers can be copied across); primitives are
# built along Blender Z, which is three.js's Y, like three's own cylinders and capsules.
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # three -> Blender


def T(x: float, y: float, z: float) -> Vector:
    """A three.js position in Blender space."""
    return Vector((x, -z, y))


def three_matrix(pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)) -> Matrix:
    """A three.js transform (Euler order XYZ: R = Rx Ry Rz) as a Blender-space matrix."""
    m = Matrix.Translation(Vector(pos)) @ Matrix.Rotation(rot[0], 4, "X") @ Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[2], 4, "Z") @ Matrix.Diagonal((*scale, 1.0))
    return C @ m @ C.inverted()


# =============================================================================
#  Materials (names are part of the contract with src/render/models.ts)
# =============================================================================
def srgb(hexv: int) -> tuple[float, float, float, float]:
    def lin(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (lin(((hexv >> 16) & 255) / 255), lin(((hexv >> 8) & 255) / 255), lin((hexv & 255) / 255), 1.0)


def material(name: str, color: int, metallic: float = 0.0, roughness: float = 0.5, emission: int | None = None) -> bpy.types.Material:
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb(color)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = srgb(emission)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return m


# =============================================================================
#  Mesh building blocks
# =============================================================================
def reset() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def bm_box(w: float, h: float, d: float) -> bmesh.types.BMesh:
    """three.js BoxGeometry(w, h, d)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((w, d, h)), verts=bm.verts)
    return bm


def bm_lathe(profile: list[tuple[float, float]], segs: int = 40) -> bmesh.types.BMesh:
    """Spin a (radius, height) profile, bottom to top, around three's Y; radius 0 makes a pole.

    Built by hand because bmesh's own spin / UV sphere weld their seams with a merge that numbers vertices
    differently from run to run, and the .glb files should rebuild byte for byte."""
    bm = bmesh.new()
    rings = []
    for x, y in profile:
        if x == 0:
            rings.append([bm.verts.new((0, 0, y))])
        else:
            # angle 0 faces the viewer (three +z = Blender -y), going round towards +x like three's own lathes
            rings.append([bm.verts.new((x * math.sin(2 * math.pi * i / segs), -x * math.cos(2 * math.pi * i / segs), y)) for i in range(segs)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            if len(a) == 1:
                bm.faces.new((a[0], b[j], b[i]))
            elif len(b) == 1:
                bm.faces.new((a[i], a[j], b[0]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.normal_update()
    return bm


def _arc(r: float, rings: int) -> list[tuple[float, float]]:
    """Half circle from the bottom pole to the top one: (radius, height) points."""
    pts = []
    for k in range(rings + 1):
        phi = math.pi * k / rings
        pts.append((0.0 if k in (0, rings) else r * math.sin(phi), -r * math.cos(phi) if 2 * k != rings else 0.0))
    return pts


def bm_sphere(r: float, segs: int = 16, rings: int = 10) -> bmesh.types.BMesh:
    return bm_lathe(_arc(r, rings), segs)


def bm_cyl(r_top: float, r_bottom: float, h: float, segs: int = 16, caps: bool = True) -> bmesh.types.BMesh:
    """three.js CylinderGeometry(radiusTop, radiusBottom, height): along three's Y, centred."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r_bottom, radius2=r_top, depth=h)
    return bm


def bm_capsule(r: float, length: float, segs: int = 12) -> bmesh.types.BMesh:
    """three.js CapsuleGeometry(radius, length): along three's Y, centred."""
    rings = max(10, segs // 2 + 2) // 2 * 2
    arc = _arc(r, rings)
    lower = [(x, y - length / 2) for x, y in arc[: rings // 2 + 1]]
    upper = [(x, y + length / 2) for x, y in arc[rings // 2 :]]
    return bm_lathe(lower + upper, segs)


def part(bm: bmesh.types.BMesh, mat: str, pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), bevel: float = 0.0, bevel_segs: int = 2) -> tuple[bpy.types.Mesh, str]:
    """A finished piece of a node: bevel applied, then placed in the node's space (three.js terms).

    No Subdivision Surface (or bmesh spin / remove_doubles): their output is numbered differently from run
    to run, and the .glb files should rebuild byte for byte. Round things use more segments instead."""
    me = bpy.data.meshes.new("part")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("part", me)
    bpy.context.scene.collection.objects.link(ob)
    if bevel > 0:
        b = ob.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = bevel_segs
        b.limit_method = "ANGLE"
        b.angle_limit = math.radians(40)
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    out.transform(three_matrix(pos, rot, scale))
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return out, mat


def node(name: str, parts: list[tuple[bpy.types.Mesh, str]], mats: dict[str, bpy.types.Material], parent=None, pos=(0, 0, 0), sharp_deg: float = 38) -> bpy.types.Object:
    """A named object (a glTF node) made of parts, each with one named material, at a three.js position in its parent."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    order: list[str] = []
    for pm, mat in parts:
        if mat not in order:
            order.append(mat)
        n0 = len(bm.faces)
        bm.from_mesh(pm)
        bm.faces.ensure_lookup_table()
        for f in bm.faces[n0:]:
            f.material_index = order.index(mat)
        bpy.data.meshes.remove(pm)
    bm.to_mesh(me)
    bm.free()
    for mat in order:
        me.materials.append(mats[mat])
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(sharp_deg))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location = T(*pos)
    return ob


def empty(name: str, parent=None, pos=(0, 0, 0)) -> bpy.types.Object:
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location = T(*pos)
    return ob


# =============================================================================
#  Ambient occlusion baked into vertex colours
# =============================================================================
def bake_ao(objects: list[bpy.types.Object], rays: int = 24, dist: float = 0.3, strength: float = 0.7, seed: int = 1) -> None:
    """Darken creases: per vertex, the share of short rays over the normal's hemisphere that hit any part."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for ob in objects:
        if ob.type != "MESH":
            continue
        mw = ob.matrix_world
        base = len(verts)
        verts += [mw @ v.co for v in ob.data.vertices]
        polys += [[base + i for i in p.vertices] for p in ob.data.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    rng = random.Random(seed)
    dirs = []
    for _ in range(rays):
        # cosine-weighted hemisphere around +Z
        u, v = rng.random(), rng.random()
        r, a = math.sqrt(u), 2 * math.pi * v
        dirs.append(Vector((r * math.cos(a), r * math.sin(a), math.sqrt(max(0.0, 1 - u)))))
    for ob in objects:
        if ob.type != "MESH":
            continue
        me = ob.data
        mw = ob.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        attr = me.color_attributes.get("AO") or me.color_attributes.new("AO", "BYTE_COLOR", "POINT")
        for v in me.vertices:
            p = mw @ v.co
            n = (nm @ v.normal).normalized()
            rot = n.to_track_quat("Z", "Y")
            hit = 0
            for d in dirs:
                w = rot @ d
                loc, *_ = tree.ray_cast(p + n * 0.003, w, dist)
                if loc is not None:
                    hit += 1
            ao = 1.0 - strength * hit / rays
            attr.data[v.index].color = (ao, ao, ao, 1.0)
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = me.color_attributes.find("AO")


# =============================================================================
#  Export
# =============================================================================
def export(name: str) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_animations=False,
    )
    return path


def tri_count() -> int:
    n = 0
    for ob in bpy.context.scene.objects:
        if ob.type == "MESH":
            n += sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return n


# =============================================================================
#  Spartan
# =============================================================================
def build_spartan() -> dict:
    """Nodes root > body > aim > head and aim > weaponHolder, at the same pivots as buildSpartan()."""
    mats = {
        "armor": material("armor", 0xb0b8c0, 0.25, 0.45),
        "accent": material("accent", 0x6c7378, 0.3, 0.5),
        "undersuit": material("undersuit", 0x2a2d31, 0.0, 0.8),
        "visor": material("visor", 0xc08a20, 0.9, 0.18),
        "trim": material("trim", 0x8a949d, 0.8, 0.35),
        "light": material("light", 0x8fe3ff, 0.0, 0.4, emission=0x8fe3ff),
    }
    root = empty("root")

    # ---- body: pivot at the root (y 0 = rim level when fully up) ----
    b = [
        # undersuit legs / abdomen, down into the hole
        part(bm_cyl(0.25, 0.23, 1.3, 14), "undersuit", pos=(0, -0.55, 0)),
        # rounded chest armour
        part(bm_box(0.62, 0.5, 0.42), "armor", pos=(0, 0.36, 0), bevel=0.09, bevel_segs=5),
        # abdomen plates
        part(bm_box(0.42, 0.08, 0.3), "accent", pos=(0, 0.08, -0.03), bevel=0.02),
        part(bm_box(0.38, 0.08, 0.3), "accent", pos=(0, 0.17, -0.03), bevel=0.02),
        # chest plate with a light strip
        part(bm_box(0.5, 0.3, 0.12), "accent", pos=(0, 0.43, -0.2), bevel=0.03),
        part(bm_box(0.18, 0.035, 0.04), "light", pos=(0, 0.5, -0.265)),
        # collar, neck, belt, pouches
        part(bm_cyl(0.14, 0.17, 0.07, 16), "trim", pos=(0, 0.635, 0), bevel=0.012),
        part(bm_cyl(0.1, 0.11, 0.16, 12), "undersuit", pos=(0, 0.7, 0)),
        part(bm_cyl(0.285, 0.285, 0.09, 20), "undersuit", pos=(0, 0.0, 0), bevel=0.02),
        part(bm_box(0.1, 0.1, 0.07), "accent", pos=(-0.2, 0.0, -0.2), bevel=0.015),
        part(bm_box(0.1, 0.1, 0.07), "accent", pos=(0.2, 0.0, -0.2), bevel=0.015),
        # back pack
        part(bm_box(0.4, 0.34, 0.18), "accent", pos=(0, 0.38, 0.25), bevel=0.04),
    ]
    body = node("body", b, mats, parent=root)

    # ---- aim: pivot at the shoulders (three y 0.58); shoulders and the arms holding the weapon ----
    a = []
    for sx in (-1, 1):
        a.append(part(bm_sphere(0.17, 24, 14), "armor", pos=(sx * 0.38, 0.01, 0), rot=(0, 0, sx * 0.3), scale=(1.15, 0.9, 1.05)))
        a.append(part(bm_box(0.2, 0.06, 0.28), "accent", pos=(sx * 0.4, 0.11, 0), bevel=0.02))
    # upper arms + forearm armour + gloves, as in buildSpartan
    for (x, y, z, rx, rz), (gx, gy, gz) in (((-0.3, -0.15, -0.18, 1.1, 0.35), (-0.12, -0.2, -0.42)), ((0.32, -0.18, -0.08, 1.3, -0.35), (0.14, -0.22, -0.22))):
        a.append(part(bm_capsule(0.075, 0.34, 10), "undersuit", pos=(x, y, z), rot=(rx, 0, rz)))
        a.append(part(bm_cyl(0.088, 0.078, 0.17, 12), "armor", pos=((x + gx) / 2, (y + gy) / 2, (z + gz) / 2), rot=(rx, 0, rz), bevel=0.015))
        a.append(part(bm_box(0.11, 0.1, 0.13), "undersuit", pos=(gx, gy, gz), bevel=0.03))
    aim = node("aim", a, mats, parent=body, pos=(0, 0.58, 0))

    # ---- head: pivot at the head centre (three y 0.95 = HEAD_Y) ----
    vis = bm_sphere(0.2, 40, 26)
    # a wide band that wraps around the front (three -z = Blender +y)
    bmesh.ops.delete(vis, geom=[v for v in vis.verts if not (v.co.y > 0.035 and -0.075 < v.co.z < 0.065)], context="VERTS")
    # a curved brow ridge just above it, cut from a slightly bigger shell
    brow = bm_sphere(0.2, 32, 24)
    bmesh.ops.delete(brow, geom=[v for v in brow.verts if not (v.co.y > 0.02 and 0.045 < v.co.z < 0.105)], context="VERTS")
    h = [
        # helmet shell, a little longer front to back
        part(bm_sphere(0.215, 32, 22), "armor", scale=(0.96, 1.04, 1.12)),
        part(vis, "visor", pos=(0, -0.01, -0.016), scale=(1.04, 1.08, 1.17)),
        # brow ridge over the visor and the crest along the top
        part(brow, "accent", pos=(0, -0.006, -0.02), scale=(1.12, 1.1, 1.28)),
        part(bm_box(0.07, 0.06, 0.3), "accent", pos=(0, 0.17, 0.02), bevel=0.02),
        # ear pieces
        part(bm_cyl(0.065, 0.065, 0.05, 14), "accent", pos=(-0.2, -0.02, 0.02), rot=(0, 0, math.pi / 2), bevel=0.012),
        part(bm_cyl(0.065, 0.065, 0.05, 14), "accent", pos=(0.2, -0.02, 0.02), rot=(0, 0, math.pi / 2), bevel=0.012),
        # mouth plate with a breathing grille
        part(bm_box(0.17, 0.07, 0.08), "accent", pos=(0, -0.155, -0.15), bevel=0.02),
        part(bm_box(0.1, 0.03, 0.02), "trim", pos=(0, -0.155, -0.195), bevel=0.006),
    ]
    head = node("head", h, mats, parent=aim, pos=(0, 0.37, 0), sharp_deg=45)

    empty("weaponHolder", parent=aim, pos=(0.05, -0.2, -0.3))
    bake_ao([body, aim, head])
    path = export("spartan")
    return {"file": path.name, "triangles": tri_count()}


# =============================================================================
#  Energy drink can (Pitre Mode power-up): radius 0.3, height 1.44, centred on its middle
# =============================================================================
def build_can() -> dict:
    mats = {"metal": material("metal", 0xd4d8dd, 1.0, 0.28), "label": material("label", 0x101114, 0.55, 0.32)}
    r, hh = 0.3, 0.72

    parts = [
        part(bm_lathe([(0, -hh + 0.05), (0.2, -hh + 0.06), (0.24, -hh), (0.27, -hh + 0.004), (0.293, -hh + 0.045), (r, -hh + 0.1)]), "metal"),
        part(bm_lathe([(r, hh - 0.13), (0.287, hh - 0.075), (0.256, hh - 0.035), (0.263, hh - 0.01), (0.255, hh), (0.236, hh - 0.012), (0.226, hh - 0.03), (0, hh - 0.03)]), "metal"),
        # pull tab and rivet
        part(bm_box(0.12, 0.012, 0.17), "metal", pos=(0, hh - 0.018, 0.06), bevel=0.02),
        part(bm_cyl(0.024, 0.024, 0.02, 10), "metal", pos=(0, hh - 0.024, 0)),
    ]
    # the painted wall, u once around and v bottom (0) to top (1) like three's CylinderGeometry. Written
    # upside down: the glTF exporter flips v, and the game's label is a canvas texture (flipY).
    segs, y0, y1 = 48, -hh + 0.1, hh - 0.13
    wall = bmesh.new()
    uv = wall.loops.layers.uv.new("UVMap")
    # angle 0 faces the viewer (three +z = Blender -y) and u grows towards +x, as in three's cylinders
    ring = lambda y: [wall.verts.new((r * math.sin(2 * math.pi * i / segs), -r * math.cos(2 * math.pi * i / segs), y)) for i in range(segs + 1)]
    lo, hi = ring(y0), ring(y1)
    for i in range(segs):
        f = wall.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
        for loop, (u, v) in zip(f.loops, ((i / segs, 1), ((i + 1) / segs, 1), ((i + 1) / segs, 0), (i / segs, 0))):
            loop[uv].uv = (u, v)
    wall.normal_update()
    for f in wall.faces:
        c = f.calc_center_median()
        if f.normal.x * c.x + f.normal.y * c.y < 0:
            f.normal_flip()
    parts.append(part(wall, "label"))
    can = node("can", parts, mats, sharp_deg=50)
    bake_ao([can], rays=16, dist=0.12, strength=0.5)
    path = export("can")
    return {"file": path.name, "triangles": tri_count()}


# =============================================================================
#  Super Soaker (Gerry Sauce): barrel toward -Z (three), origin at the grip, a "muzzle" empty
# =============================================================================
def build_soaker() -> dict:
    mats = {
        "body": material("body", 0xff7a1a, 0.0, 0.35),
        "accent": material("accent", 0x2fbf4a, 0.0, 0.4),
        "trim": material("trim", 0xf2c230, 0.2, 0.35),
        "tank": material("tank", 0xfff4d6, 0.0, 0.15),
    }
    p = [
        part(bm_box(0.13, 0.16, 0.5), "body", pos=(0, 0, -0.12), bevel=0.03, bevel_segs=3),
        part(bm_cyl(0.035, 0.045, 0.3, 14), "accent", pos=(0, 0.03, -0.5), rot=(math.pi / 2, 0, 0), bevel=0.01),
        part(bm_cyl(0.05, 0.05, 0.06, 16), "trim", pos=(0, 0.03, -0.66), rot=(math.pi / 2, 0, 0), bevel=0.012),
        part(bm_box(0.1, 0.07, 0.24), "accent", pos=(0, -0.09, -0.3), bevel=0.025),
        part(bm_box(0.06, 0.16, 0.08), "body", pos=(0, -0.13, 0.05), rot=(-0.25, 0, 0), bevel=0.02),
        part(bm_box(0.02, 0.012, 0.09), "trim", pos=(0, -0.11, -0.05)),
        # the custard tank and its cap
        part(bm_capsule(0.1, 0.16, 24), "tank", pos=(0, 0.17, -0.1), rot=(0, 0, math.pi / 2)),
        part(bm_cyl(0.035, 0.035, 0.05, 12), "trim", pos=(0, 0.29, -0.1), bevel=0.01),
    ]
    soaker = node("soaker", p, mats)
    empty("muzzle", parent=soaker, pos=(0, 0.03, -0.7))
    bake_ao([soaker], rays=16, dist=0.1, strength=0.55)
    path = export("soaker")
    return {"file": path.name, "triangles": tri_count()}


# =============================================================================
#  Spring Jump spring: 1 m tall from its base (the game scales it in Y), pad on top
# =============================================================================
def build_spring() -> dict:
    mats = {"metal": material("metal", 0xc9d2da, 0.9, 0.3), "pad": material("pad", 0x3cffd0, 0.0, 0.5, emission=0x0b4a3c)}
    turns, per = 6, 20
    cu = bpy.data.curves.new("coil", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.05
    cu.bevel_resolution = 2
    sp = cu.splines.new("POLY")
    n = turns * per + 1
    sp.points.add(n - 1)
    for i in range(n):
        a = i / per * 2 * math.pi
        sp.points[i].co = (math.cos(a) * 0.42, math.sin(a) * 0.42, 0.05 + 0.9 * i / (n - 1), 1)
    ob = bpy.data.objects.new("coil", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    coil = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    parts = [
        (coil, "metal"),
        part(bm_cyl(0.55, 0.55, 0.07, 32), "pad", pos=(0, 1.0, 0), bevel=0.02),
        part(bm_cyl(0.5, 0.5, 0.05, 32), "metal", pos=(0, 0.025, 0), bevel=0.015),
    ]
    spring = node("spring", parts, mats, sharp_deg=60)
    bake_ao([spring], rays=12, dist=0.15, strength=0.5)
    path = export("spring")
    return {"file": path.name, "triangles": tri_count()}


BUILDERS = {"spartan": build_spartan, "can": build_can, "soaker": build_soaker, "spring": build_spring}


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    names = argv or list(BUILDERS)
    unknown = [n for n in names if n not in BUILDERS]
    if unknown:
        sys.exit(f"unknown model(s): {', '.join(unknown)} (have: {', '.join(BUILDERS)})")
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"version": 1, "models": {}}
    for n in names:
        reset()
        info = BUILDERS[n]()
        size = (OUT / info["file"]).stat().st_size
        manifest["models"][n] = {"file": f"models/{info['file']}", "triangles": info["triangles"], "bytes": size}
        print(f"{n:8s} {info['triangles']:6d} triangles  {size / 1024:6.1f} KB")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
