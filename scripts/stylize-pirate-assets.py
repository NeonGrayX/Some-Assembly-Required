"""Pushes the pirate assets toward the reference picture's look, before they are baked.

    python scripts/stylize-pirate-assets.py -- pirate.blend /tmp/pirate-styled.blend
    python scripts/bake-pirate-assets.py -- /tmp/pirate-styled.blend /tmp/pirate-assets.glb

Materials: wood darker and less saturated with brighter painted edges, deeper grime in the
corners, greyer plaster, indigo roof slates, lighter blue-grey iron that shines, warm grey rock
with faint cracks, cream and rust sails, yellow-green leaves.

Shapes: the tavern's and shop's timbers thicker, iron plates bolted over the ends of their
studs and braces, a deeper roof and a big ridge cap on the tavern, both buildings leaning and
widening upward; the cannon's barrel tapered and ringed, the ship's guns longer; the rocks in
large flat facets with chamfered edges; the bushes and red bushes covered in leaves; the palm
fronds broader.
"""
import bpy, bmesh, sys, math, random
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
src, out = args[0], args[1]
bpy.ops.wm.open_mainfile(filepath=src)
random.seed(7)
M = bpy.data.materials


# ---------------------------------------------------------------- materials

def principled(m):
    return next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def final_mix(m):
    """The last mix before the base colour: the material's colour (A) and its edges' (B)."""
    return principled(m).inputs['Base Color'].links[0].from_node


def grade(m, sat=1.0, val=1.0, tint=None):
    """The colour under the edges, its saturation and value scaled, and multiplied by `tint`."""
    nt = m.node_tree
    f = final_mix(m)
    a = f.inputs[6]
    source = a.links[0].from_socket
    hsv = nt.nodes.new('ShaderNodeHueSaturation')
    hsv.inputs['Saturation'].default_value = sat
    hsv.inputs['Value'].default_value = val
    nt.links.new(source, hsv.inputs['Color'])
    result = hsv.outputs['Color']
    if tint:
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs[0].default_value = 1
        nt.links.new(result, mul.inputs[6])
        mul.inputs[7].default_value = (*tint, 1)
        result = mul.outputs[2]
    nt.links.new(result, a)


def edges(m, colour=None, strength=None):
    """The painted highlight along the edges: its colour, and how strongly it shows."""
    f = final_mix(m)
    if colour:
        f.inputs[7].default_value = (*colour, 1)
    if strength is not None:
        fac = f.inputs[0].links[0].from_node
        fac.inputs[1].default_value = strength


def grime(m, darkest):
    """How dark the corners get: the ambient occlusion ramp's dark end."""
    nt = m.node_tree
    ao = next(n for n in nt.nodes if n.type == 'AMBIENT_OCCLUSION')
    ramp = next(l.to_node for l in nt.links if l.from_node == ao and l.to_node.type == 'VALTORGB')
    ramp.color_ramp.elements[0].color = (darkest, darkest, darkest, 1)


def ramp(m, name, colours):
    for e, c in zip(m.node_tree.nodes[name].color_ramp.elements, colours):
        e.color = (*c, 1)


def mix_colour(m, name, slot, colour):
    m.node_tree.nodes[name].inputs[6 if slot == 'A' else 7].default_value = (*colour, 1)


def shine(m, metal, rough):
    p = principled(m)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough


WOOD_EDGE = {
    'Cannon_Wood': (0.72, 0.5, 0.3),
    'Cannon_WoodDark': (0.5, 0.33, 0.2),
    'Prop_Planks': (0.7, 0.48, 0.28),
    'Prop_DeckPlanks': (0.72, 0.52, 0.32),
    'Prop_HullPlanks': (0.45, 0.3, 0.18),
    'Prop_WoodStave': (0.72, 0.5, 0.3),
    'Prop_SignWood': (0.75, 0.56, 0.36),
}
for name, edge in WOOD_EDGE.items():
    grade(M[name], sat=1.0, val=0.85)
    edges(M[name], edge, 0.95)
    grime(M[name], 0.25)

m = M['Prop_Plaster']
ramp(m, 'Color Ramp', [(0.4, 0.36, 0.25), (0.6, 0.55, 0.38), (0.66, 0.6, 0.43)])
edges(m, (0.78, 0.72, 0.56))
grime(m, 0.35)

m = M['Prop_RoofShingle']
ramp(m, 'Color Ramp.001', [(0.03, 0.03, 0.15), (0.05, 0.045, 0.21), (0.07, 0.06, 0.27)])
edges(m, (0.17, 0.16, 0.45), 0.9)
grime(m, 0.3)

m = M['Prop_RoofTileY']
grade(m, sat=1.0, val=0.55, tint=(1.0, 0.6, 0.55))
grime(m, 0.3)

for name, (metal, rough) in {'Cannon_Iron': (0.6, 0.35), 'Cannon_IronTrim': (0.65, 0.3)}.items():
    m = M[name]
    grade(m, val=1.5)
    edges(m, (0.5, 0.55, 0.62), 0.95)
    shine(m, metal, rough)

m = M['Prop_Rock']
ramp(m, 'Color Ramp', [(0.17, 0.155, 0.12), (0.33, 0.3, 0.23), (0.42, 0.385, 0.3)])
ramp(m, 'Color Ramp.002', [(0.7, 0.7, 0.7)])
mix_colour(m, 'Mix.002', 'B', (0.55, 0.52, 0.45))
edges(m, (0.62, 0.58, 0.5), 0.9)
grime(m, 0.3)

m = M['Prop_SailStripes']
mix_colour(m, 'Mix', 'A', (0.66, 0.56, 0.42))
mix_colour(m, 'Mix', 'B', (0.5, 0.13, 0.05))
# Straighter stripes: less of the noise that bends them.
warp = m.node_tree.nodes['Math.001']
for i in warp.inputs:
    if not i.is_linked and isinstance(i.default_value, float) and i.default_value not in (0.0,):
        i.default_value *= 0.25
        break
edges(m, (0.7, 0.6, 0.46))

m = M['Prop_Bush']
ramp(m, 'Color Ramp', [(0.09, 0.16, 0.012), (0.3, 0.42, 0.04)])
mix_colour(m, 'Mix.001', 'B', (0.45, 0.6, 0.08))
edges(m, (0.55, 0.68, 0.12))

m = M['Prop_Leaf']
ramp(m, 'Color Ramp', [(0.06, 0.14, 0.01), (0.26, 0.36, 0.03), (0.55, 0.58, 0.08)])
mix_colour(m, 'Mix', 'B', (0.62, 0.66, 0.12))
edges(m, (0.65, 0.7, 0.2))

grade(M['Prop_PalmTrunk'], sat=0.7, val=0.85)
for name in ('Prop_Rope', 'Prop_Burlap'):
    grade(M[name], sat=0.8)


# ---------------------------------------------------------------- shapes

def parts(root_name, kind='MESH'):
    return [o for o in bpy.data.objects[root_name].children_recursive if o.type == kind]


def single_user(o):
    if o.data.users > 1:
        o.data = o.data.copy()


def deform(root_name, f):
    """Moves every part of an asset through `f`, a function of a point in the world."""
    for o in bpy.data.objects[root_name].children_recursive:
        if o.type == 'MESH':
            single_user(o)
            mw = o.matrix_world
            inv = mw.inverted()
            for v in o.data.vertices:
                v.co = inv @ f(mw @ v.co)
        elif o.type == 'EMPTY' and o.parent and o.parent.type != 'MESH':
            o.matrix_world.translation = f(o.matrix_world.translation.copy())


def base_centre(root_name):
    ps = [o.matrix_world.translation for o in parts(root_name)]
    return Vector((sum(p.x for p in ps) / len(ps), sum(p.y for p in ps) / len(ps), 0))


def add_mesh(name, root_name, bm, material, bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.parent = bpy.data.objects[root_name]
    o.matrix_parent_inverse = bpy.data.objects[root_name].matrix_world.inverted()
    o.data.materials.append(M[material])
    for p in me.polygons:
        p.use_smooth = True
    if bevel:
        b = o.modifiers.new('Bevel', 'BEVEL')
        b.width = bevel
        b.segments = 2
    return o


BEAMS = ('Post_', 'Stud_', 'Brace', 'Barge_', 'Gable_King', 'Gable_Collar', 'TopBeam',
         'JettyBeam', 'DoorFrame', 'DoorJamb', 'DoorLintel', 'RidgeBeam', 'Ridge', 'Joist')


def thicken(root_name, factor=1.5):
    """The asset's timbers thicker across, not longer."""
    for o in parts(root_name):
        if not o.name.startswith(BEAMS):
            continue
        d = o.dimensions
        longest = max(d)
        for i in range(3):
            if d[i] < 0.5 * longest:
                o.scale[i] *= factor


def plates(root_name):
    """Iron plates, bolted, over both ends of every upright stud and brace."""
    centre = base_centre(root_name)
    n = 0
    for o in parts(root_name):
        if not o.name.startswith(('Stud_', 'Brace', 'Post_')):
            continue
        d = o.dimensions
        if d.z < 1.0 or abs(o.rotation_euler.x) + abs(o.rotation_euler.y) > 0.01:
            continue
        p = o.matrix_world.translation
        out = p - centre
        out.z = 0
        # The face that looks out: along x or along y.
        if abs(out.x) * d.y > abs(out.y) * d.x:
            normal, across, depth, width = Vector((math.copysign(1, out.x), 0, 0)), Vector((0, 1, 0)), d.x, d.y
        else:
            normal, across, depth, width = Vector((0, math.copysign(1, out.y), 0)), Vector((1, 0, 0)), d.y, d.x
        for end in (-1, 1):
            if o.name.startswith('Post_') and end == -1:
                continue
            at = p + Vector((0, 0, end * (d.z / 2 - 0.2))) + normal * (depth / 2 + 0.025)
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1)
            size = across * (width * 1.6) + normal * 0.06 + Vector((0, 0, 0.3))
            bmesh.ops.scale(bm, vec=Vector((abs(size.x) or 0.06, abs(size.y) or 0.06, 0.3)), verts=bm.verts)
            for s in (-1, 1):
                bolt = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=0.035)
                bmesh.ops.translate(bm, vec=across * (s * width * 0.5) + normal * 0.035,
                                    verts=bolt['verts'])
            bmesh.ops.translate(bm, vec=at, verts=bm.verts)
            add_mesh(f'Plate_{o.name}_{end}', root_name, bm, 'Cannon_IronTrim', bevel=0.012)
            n += 1
    return n


def roof(root_name, pivot, spread, length):
    """A deeper roof: its slates, deck, barge boards and ridge spread out about the ridge."""
    names = ('Shingle_', 'Roof_Deck', 'Barge', 'RidgeBeam', 'RidgeEnd', 'LanternHook0')
    for o in bpy.data.objects[root_name].children_recursive:
        top_lantern = o.type == 'EMPTY' and o.instance_collection and o.matrix_world.translation.z > 6.5
        if not (o.name.startswith(names) or top_lantern):
            continue
        t = o.matrix_world.translation - pivot
        o.matrix_world.translation = pivot + Vector((t.x * spread, t.y * length, t.z * spread))
        if o.type == 'MESH' and o.name.startswith(('Shingle_', 'Roof_Deck')):
            o.scale.y *= length
            if o.name.startswith('Roof_Deck'):
                o.scale.x *= spread


def lean(root_name, flare, tilt, sway):
    """The whole asset widening upward by `flare` per metre, leaning `tilt` per metre along x
    and bowing `sway` along y."""
    c = base_centre(root_name)

    def f(p):
        z = max(p.z, 0)
        q = c + (p - c) * (1 + flare * z)
        q.z = p.z
        q.x += tilt * z
        q.y -= sway * z * z
        return q

    deform(root_name, f)


# The tavern.
thicken('Tavern')
print('tavern plates', plates('Tavern'))
for name in ('RidgeEnd', 'RidgeEndCap'):
    bpy.data.objects[name].scale *= 2.0
for name in [o.name for o in parts('Tavern') if o.name.startswith('PostBracket')]:
    o = bpy.data.objects[name]
    o.scale.x *= 1.35
    o.scale.y *= 1.35
    o.scale.z *= 2.2
roof('Tavern', Vector((3.0, 15.0, 7.5)), 1.1, 1.15)
lean('Tavern', 0.018, 0.035, 0.0025)

# The shop.
thicken('Shack')
print('shop plates', plates('Shack'))
lean('Shack', 0.015, -0.03, 0.002)


# The cannon: its barrel tapered toward the muzzle, with rings round it and a ball at its breech.
def taper(o, x0, x1, end):
    single_user(o)
    for v in o.data.vertices:
        t = min(max((v.co.x - x0) / (x1 - x0), 0), 1)
        s = 1 - (1 - end) * t
        if v.co.x > x1:
            s = end * 1.08
        v.co.y *= s
        v.co.z *= s


barrel = bpy.data.objects['Barrel']
taper(barrel, -0.35, 1.5, 0.72)
for x, r in ((-0.3, 0.43), (0.3, 0.385), (0.95, 0.345)):
    bm = bmesh.new()
    ring = bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=r + 0.04, radius2=r + 0.04,
                                 depth=0.09)
    bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((x, 0, 0)), verts=bm.verts)
    bmesh.ops.transform(bm, matrix=barrel.matrix_world, verts=bm.verts)
    add_mesh(f'BarrelRing{x}', 'Cannon', bm, 'Cannon_IronTrim', bevel=0.015)
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.14)
bmesh.ops.translate(bm, vec=Vector((-1.0, 0, 0)), verts=bm.verts)
bmesh.ops.transform(bm, matrix=barrel.matrix_world, verts=bm.verts)
add_mesh('Cascabel', 'Cannon', bm, 'Cannon_IronTrim')

# The ship's guns longer, reaching well out of their ports.
for i in range(3):
    o = bpy.data.objects[f'GunBarrel{i}']
    o.scale.x *= 1.7
    o.scale.y *= 1.15
    o.scale.z *= 1.15


# Rocks in large flat facets with chamfered edges.
for o in bpy.data.objects:
    if o.type != 'MESH' or not any(s.material and s.material.name == 'Prop_Rock' for s in o.material_slots):
        continue
    for md in o.modifiers:
        if md.type == 'SUBSURF':
            md.levels = md.render_levels = 0
    b = o.modifiers.new('Chamfer', 'BEVEL')
    b.width = 0.025 * max(o.dimensions)
    b.segments = 2
    b.limit_method = 'ANGLE'
    b.angle_limit = math.radians(35)
    # Before the wobble.
    while o.modifiers[0] != b:
        bpy.context.view_layer.objects.active = o
        with bpy.context.temp_override(object=o):
            bpy.ops.object.modifier_move_up(modifier=b.name)
    for p in o.data.polygons:
        p.use_smooth = False


# Leaves over the bushes.
def leaves(clump, root_name, material, count, size):
    me = clump.data
    mw = clump.matrix_world
    bm = bmesh.new()
    up = Vector((0, 0, 1))
    verts = list(me.vertices)
    for _ in range(count):
        v = random.choice(verts)
        base = mw @ v.co
        normal = (mw.to_3x3() @ v.normal).normalized()
        d = (normal + up * 0.5 + Vector([random.uniform(-0.35, 0.35) for _ in range(3)])).normalized()
        side = d.cross(Vector([random.uniform(-1, 1) for _ in range(3)])).normalized()
        n = side.cross(d).normalized()
        length = size * random.uniform(0.8, 1.25)
        width = length * 0.45
        start = base - d * length * 0.3
        rows = []
        for k in range(6):
            t = k / 5
            w = width * math.sin(math.pi * t) ** 0.8
            sag = -n * (length * 0.12 * t * t)
            centre = start + d * (t * length) + sag
            rows.append([bm.verts.new(centre - side * w + n * w * 0.25),
                         bm.verts.new(centre + n * 0.0),
                         bm.verts.new(centre + side * w + n * w * 0.25)])
        for k in range(5):
            a, b = rows[k], rows[k + 1]
            for j in range(2):
                bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return add_mesh(f'{clump.name}_Leaves', root_name, bm, material)


for root_name, material in (('Bush', 'Prop_Bush'), ('RedBush', 'Prop_RedBush')):
    for clump in [o for o in parts(root_name) if 'Clump' in o.name]:
        r = max(clump.dimensions) / 2
        leaves(clump, root_name, material, 26, r * 0.85)


# Broader palm fronds.
for o in parts('PalmTree'):
    if not o.name.startswith('Palm_Frond'):
        continue
    single_user(o)
    co = [v.co for v in o.data.vertices]
    span = [max(c[i] for c in co) - min(c[i] for c in co) for i in range(3)]
    axis = sorted(range(3), key=lambda i: span[i])[1]
    mid = (max(c[axis] for c in co) + min(c[axis] for c in co)) / 2
    for v in o.data.vertices:
        v.co[axis] = mid + (v.co[axis] - mid) * 1.7

bpy.ops.wm.save_as_mainfile(filepath=out)
print('saved', out, flush=True)
