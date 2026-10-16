"""Pushes the pirate assets toward the reference picture's look, before they are baked.

    python scripts/stylize-pirate-assets.py -- pirate.blend /tmp/pirate-styled.blend
    python scripts/bake-pirate-assets.py -- /tmp/pirate-styled.blend /tmp/pirate-assets.glb

Materials: wood with brighter painted edges and deeper grime, dark on its sides and bright on
its tops, darker still on the ground floors; cream plaster; indigo roof slates and dark brown
shop shingles; light grey hammered iron, and navy steel on the guns; warm grey rock with cream
edges and dark cracks; cream and terracotta sails with less mottling; olive and yellow-green
leaves, coral red bushes; warm yellow window and lantern glass.

Shapes: the tavern's and shop's timbers much thicker and each a little crooked, iron collars
riveted round both ends of every post and stud, a huge chamfered ridge-cap block in iron bands,
a pent roof on posts over the balcony, more lanterns, a deeper roof, both buildings leaning and
widening upward; the shop's porthole bigger and ridge-cap blocks on its ends; the cannon short,
thick and flared on thicker wheels; the barrels squat and bulging with thick hoops; the ship's
sails bellied, its rigging thicker, its guns longer, two bow chasers; the rocks rebuilt as
bevelled prisms; broad notched palm leaves on a short trunk; bushes covered in small leaves;
and a new grass tuft.
"""
import bpy, bmesh, sys, math, random
from mathutils import Vector, Matrix, Euler

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
src, out = args[0], args[1]
bpy.ops.wm.open_mainfile(filepath=src)
random.seed(7)
M = bpy.data.materials
O = bpy.data.objects


def update():
    bpy.context.view_layer.update()


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


def edge_gain(m, k):
    """The edge highlight `k` times as strong: the noise that scales it, raised."""
    noise = final_mix(m).inputs[0].links[0].from_node.inputs[1].links[0].from_node
    noise.inputs[1].default_value *= k
    noise.inputs[2].default_value *= k


def grime(m, darkest):
    """How dark the corners get: the ambient occlusion ramp's dark end."""
    nt = m.node_tree
    ao = next(n for n in nt.nodes if n.type == 'AMBIENT_OCCLUSION')
    ramp = next(l.to_node for l in nt.links if l.from_node == ao and l.to_node.type == 'VALTORGB')
    ramp.color_ramp.elements[0].color = (darkest, darkest, darkest, 1)


def facing(m, bottom, side, top):
    """How bright the faces looking down, sideways and up are: the ramp on the normal's Z."""
    nt = m.node_tree
    ramp = next(n for n in nt.nodes if n.type == 'VALTORGB' and n.inputs[0].is_linked
                and n.inputs[0].links[0].from_node.name == 'Math')
    for e, v in zip(ramp.color_ramp.elements, (bottom, side, top)):
        e.color = (v, v, v, 1)


def hammered(m, strength):
    """Dents over the surface: a Voronoi added into the bump's height."""
    nt = m.node_tree
    bump = next(n for n in nt.nodes if n.type == 'BUMP')
    height = bump.inputs['Height'].links[0].from_socket
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = 14
    nt.links.new(nt.nodes['Vector Math'].outputs['Vector'], vor.inputs['Vector'])
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'MULTIPLY_ADD'
    nt.links.new(vor.outputs['Distance'], add.inputs[0])
    add.inputs[1].default_value = strength
    nt.links.new(height, add.inputs[2])
    nt.links.new(add.outputs['Value'], bump.inputs['Height'])


def ramp(m, name, colours):
    for e, c in zip(m.node_tree.nodes[name].color_ramp.elements, colours):
        e.color = (*c, 1)


def mix_colour(m, name, slot, colour):
    m.node_tree.nodes[name].inputs[6 if slot == 'A' else 7].default_value = (*colour, 1)


def shine(m, metal, rough):
    p = principled(m)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough


def copy(name, new):
    m = M[name].copy()
    m.name = new
    return m


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
    grade(M[name], sat=0.8 if name == 'Prop_WoodStave' else 1.0, val=0.85)
    edges(M[name], edge, 0.95)
    edge_gain(M[name], 1.3)
    grime(M[name], 0.25)
    # Dark sides, bright tops.
    facing(M[name], 0.3, 0.65, 1.35)

# The ground floors darker than the storeys above, and the cannon's carriage dark.
for name in ('Cannon_Wood', 'Prop_Planks'):
    grade(copy(name, f'{name}Low'), val=0.55)
grade(copy('Cannon_Wood', 'Cannon_Carriage'), val=0.6)

m = M['Prop_Plaster']
ramp(m, 'Color Ramp', [(0.55, 0.48, 0.3), (0.7, 0.62, 0.42), (0.78, 0.7, 0.5)])
edges(m, (0.86, 0.8, 0.62))
grime(m, 0.45)

m = M['Prop_RoofShingle']
ramp(m, 'Color Ramp.001', [(0.03, 0.03, 0.15), (0.05, 0.045, 0.21), (0.07, 0.06, 0.27)])
edges(m, (0.17, 0.16, 0.45), 0.9)
grime(m, 0.3)

m = M['Prop_RoofTileY']
ramp(m, 'Color Ramp.001', [(0.09, 0.045, 0.025), (0.12, 0.06, 0.035), (0.15, 0.075, 0.045)])
mix_colour(m, 'Mix.002', 'B', (0.03, 0.015, 0.008))
edges(m, (0.3, 0.16, 0.08))
grime(m, 0.3)

# Iron: light grey with lighter worn edges and hammered dents; the guns navy steel.
gun = copy('Cannon_Iron', 'Cannon_Gun')
for name in ('Cannon_Iron', 'Cannon_IronTrim'):
    m = M[name]
    ramp(m, 'Color Ramp', [(0.22, 0.22, 0.2), (0.36, 0.36, 0.33)])
    mix_colour(m, 'Mix.001', 'B', (0.45, 0.45, 0.43))
    edges(m, (0.6, 0.6, 0.58))
    edge_gain(m, 1.3)
    shine(m, 0.4, 0.4)
    hammered(m, 0.15)
ramp(gun, 'Color Ramp', [(0.02, 0.04, 0.08), (0.04, 0.075, 0.14)])
mix_colour(gun, 'Mix.001', 'B', (0.08, 0.12, 0.2))
edges(gun, (0.25, 0.32, 0.45))
shine(gun, 1.0, 0.25)
hammered(gun, 0.15)

m = M['Prop_Rock']
ramp(m, 'Color Ramp', [(0.17, 0.155, 0.12), (0.33, 0.31, 0.25), (0.42, 0.39, 0.31)])
# Thin dark cracks.
ramp(m, 'Color Ramp.002', [(0.35, 0.34, 0.3)])
mix_colour(m, 'Mix.002', 'B', (0.55, 0.52, 0.45))
edges(m, (0.78, 0.74, 0.62))
edge_gain(m, 1.4)
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
# Fewer, fainter pale patches and less mottling.
ramp(m, 'Color Ramp.001', [(0, 0, 0), (0.25, 0.25, 0.25)])
ramp(m, 'Color Ramp.002', [(0.9, 0.9, 0.9), (1.03, 1.03, 1.03)])
edges(m, (0.7, 0.6, 0.46))

m = M['Prop_Bush']
ramp(m, 'Color Ramp', [(0.1, 0.18, 0.015), (0.38, 0.52, 0.05)])
mix_colour(m, 'Mix.001', 'B', (0.45, 0.6, 0.08))
# Yellow tips.
edges(m, (0.62, 0.7, 0.12))

m = M['Prop_RedBush']
ramp(m, 'Color Ramp', [(0.25, 0.04, 0.02), (0.6, 0.12, 0.06)])
mix_colour(m, 'Mix.001', 'B', (0.8, 0.2, 0.1))
edges(m, (0.9, 0.35, 0.2))

m = M['Prop_Leaf']
ramp(m, 'Color Ramp', [(0.08, 0.12, 0.01), (0.22, 0.28, 0.025), (0.42, 0.45, 0.04)])
mix_colour(m, 'Mix', 'B', (0.45, 0.48, 0.06))
edges(m, (0.5, 0.55, 0.08))
grime(m, 0.3)

# Warm yellow glass.
for name in ('Prop_WindowGlow', 'Prop_LanternGlow'):
    ramp(M[name], 'Color Ramp', [(1.0, 0.62, 0.16), (1.0, 0.5, 0.1)])

grade(M['Prop_PalmTrunk'], sat=0.7, val=0.85)
for name in ('Prop_Rope', 'Prop_Burlap'):
    grade(M[name], sat=0.8)

# Grass: dark at the root, yellow-green at the tip.
grass = M.new('Prop_Grass')
grass.use_nodes = True
nt = grass.node_tree
coords = nt.nodes.new('ShaderNodeTexCoord')
height = nt.nodes.new('ShaderNodeSeparateXYZ')
nt.links.new(coords.outputs['Generated'], height.inputs[0])
tip = nt.nodes.new('ShaderNodeValToRGB')
nt.links.new(height.outputs['Z'], tip.inputs[0])
tip.color_ramp.elements[0].color = (0.05, 0.09, 0.01, 1)
tip.color_ramp.elements[1].color = (0.45, 0.5, 0.06, 1)
tip.color_ramp.elements.new(0.5).color = (0.2, 0.3, 0.03, 1)
nt.links.new(tip.outputs['Color'], principled(grass).inputs['Base Color'])
shine(grass, 0.0, 0.7)


# ---------------------------------------------------------------- shapes

def parts(root_name, kind='MESH'):
    return [o for o in O[root_name].children_recursive if o.type == kind]


def single_user(o):
    if o.data.users > 1:
        o.data = o.data.copy()


def deform(root_name, f):
    """Moves every part of an asset through `f`, a function of a point in the world."""
    update()
    for o in O[root_name].children_recursive:
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


def link(o, root_name):
    bpy.context.scene.collection.objects.link(o)
    mw = o.matrix_world.copy()
    o.parent = O[root_name]
    o.matrix_parent_inverse = O[root_name].matrix_world.inverted()
    o.matrix_world = mw
    return o


def add_mesh(name, root_name, bm, material, bevel=0.0, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = link(bpy.data.objects.new(name, me), root_name)
    o.data.materials.append(M[material])
    for p in me.polygons:
        p.use_smooth = smooth
    if bevel:
        b = o.modifiers.new('Bevel', 'BEVEL')
        b.width = bevel
        b.segments = 2
    return o


def clone(name, new, root_name):
    o = O[name].copy()
    o.data = o.data.copy()
    o.name = new
    for c in list(o.users_collection):
        c.objects.unlink(o)
    return link(o, root_name)


def first(o, md):
    """Moves a modifier to the top of the stack, before the clay softening and wobble."""
    bpy.context.view_layer.objects.active = o
    with bpy.context.temp_override(object=o):
        bpy.ops.object.modifier_move_to_index(modifier=md.name, index=0)


def edge_layer(bm):
    return bm.verts.layers.float.get('Edge') or bm.verts.layers.float.new('Edge')


def framed(bm, faces, depth, value=0.85):
    """The `Edge` highlight on the rim of every face and none in its middle: each face inset by
    `depth`, its rim marked `value` and its middle 0. Returns the middles."""
    layer = edge_layer(bm)
    for v in bm.verts:
        v[layer] = value
    bmesh.ops.inset_individual(bm, faces=faces, thickness=depth, use_even_offset=True)
    for f in faces:
        for v in f.verts:
            v[layer] = 0.0
    return faces


BEAMS = ('Post_', 'Stud_', 'Brace', 'Barge_', 'Gable_King', 'Gable_Collar', 'TopBeam',
         'JettyBeam', 'DoorFrame', 'DoorJamb', 'DoorLintel', 'RidgeBeam', 'Ridge', 'Joist')
HEAVY = ('Post_', 'Barge_', 'TopBeam', 'JettyBeam', 'RidgeBeam', 'Ridge')


def thicken(root_name, heavy, light, names=BEAMS):
    """The asset's timbers thicker across, not longer: posts and the big beams by `heavy`, the
    rest by `light`."""
    for o in parts(root_name):
        if not o.name.startswith(names):
            continue
        factor = heavy if o.name.startswith(HEAVY) else light
        d = o.dimensions
        longest = max(d)
        for i in range(3):
            if d[i] < 0.5 * longest:
                o.scale[i] *= factor
    update()


def collar(name, root_name, frame, half, height, t=0.04):
    """An iron collar round a timber: a riveted box `t` proud of a timber `half` wide across,
    `height` along it. `frame` puts it in the world, its Z along the timber."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=Vector((2 * (half.x + t), 2 * (half.y + t), height)), verts=bm.verts)
    framed(bm, list(bm.faces), min(0.05, height * 0.2))
    layer = edge_layer(bm)
    r = 0.025 + 0.06 * min(half.x, half.y)
    for axis, size in ((0, half.y), (1, half.x)):
        for side in (-1, 1):
            for s in (-1, 1):
                bolt = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=r)
                at = Vector((0, 0, 0))
                at[axis] = side * ((half.x if axis == 0 else half.y) + t)
                at[1 - axis] = s * size * 0.55
                bmesh.ops.translate(bm, vec=at, verts=bolt['verts'])
                for v in bolt['verts']:
                    v[layer] = 0.9
    bmesh.ops.transform(bm, matrix=frame, verts=bm.verts)
    return add_mesh(name, root_name, bm, 'Cannon_IronTrim', bevel=0.012)


def collars(root_name):
    """Iron collars round both ends of every upright post and stud, and round each post where
    the upper floor sits on it. Returns each timber with its collars."""
    update()
    made = {}
    for o in parts(root_name):
        if not o.name.startswith(('Stud_', 'Post_')):
            continue
        d = o.dimensions
        if d.z < 1.0 or abs(o.rotation_euler.x) + abs(o.rotation_euler.y) > 0.01:
            continue
        p = o.matrix_world.translation
        half = Vector((d.x / 2, d.y / 2))
        height = max(0.22, 0.6 * max(d.x, d.y))
        bottom, top = p.z - d.z / 2, p.z + d.z / 2
        at = [top - height / 2 - 0.12, bottom + height / 2 + 0.12]
        if bottom < 2.2 < top - 1:
            at.append(2.3)
        rot = Matrix.Rotation(o.matrix_world.to_euler().z, 4, 'Z')
        made[o] = [collar(f'Collar_{o.name}_{i}', root_name,
                          Matrix.Translation((p.x, p.y, z)) @ rot, half, height)
                   for i, z in enumerate(at)]
    return made


def crooked(made, angle):
    """Each timber, with its collars, tilted a little and differently about its middle."""
    update()
    for o, rings in made.items():
        p = o.matrix_world.translation.copy()
        turn = (Matrix.Translation(p)
                @ Euler((random.uniform(-angle, angle), random.uniform(-angle, angle), 0)).to_matrix().to_4x4()
                @ Matrix.Translation(-p))
        for x in [o] + rings:
            x.matrix_world = turn @ x.matrix_world
    update()


def roof(root_name, pivot, spread, length):
    """A deeper roof: its slates, deck, barge boards and ridge spread out about the ridge."""
    names = ('Shingle_', 'Roof_Deck', 'Barge', 'RidgeBeam', 'RidgeEnd', 'LanternHook0')
    for o in O[root_name].children_recursive:
        top_lantern = o.type == 'EMPTY' and o.instance_collection and o.matrix_world.translation.z > 6.5
        if not (o.name.startswith(names) or top_lantern):
            continue
        t = o.matrix_world.translation - pivot
        o.matrix_world.translation = pivot + Vector((t.x * spread, t.y * length, t.z * spread))
        if o.type == 'MESH' and o.name.startswith(('Shingle_', 'Roof_Deck')):
            o.scale.y *= length
            if o.name.startswith('Roof_Deck'):
                o.scale.x *= spread
    update()


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


def low(root_name, top):
    """Wood whose parts all sit below `top` (the ground floor) in the darker wood."""
    update()
    for o in parts(root_name):
        if max((o.matrix_world @ Vector(c)).z for c in o.bound_box) > top:
            continue
        for s in o.material_slots:
            if s.material and s.material.name in ('Cannon_Wood', 'Prop_Planks'):
                s.material = M[s.material.name + 'Low']


def lantern(name, root_name, like, at):
    e = bpy.data.objects.new(name, None)
    e.instance_type = 'COLLECTION'
    e.instance_collection = O[like].instance_collection
    e.scale = O[like].scale
    e.location = at
    return link(e, root_name)


# The tavern: timbers ×2.1 (the posts and big beams) and ×1.6 (the rest) of the original.
thicken('Tavern', 2.1, 1.6)
ridge_cap = O['RidgeEnd']
ridge_cap.scale *= 2.8
O['RidgeEndCap'].scale *= 2.0
b = ridge_cap.modifiers.new('Chamfer', 'BEVEL')
b.width = 0.1
b.segments = 1
first(ridge_cap, b)
for o in parts('Tavern'):
    if o.name.startswith('PostBracket'):
        o.scale.x *= 1.35
        o.scale.y *= 1.35
        o.scale.z *= 2.2
    elif o.name.startswith(('BargeEnd', 'BargeCap')):
        o.scale *= 1.6

# A pent roof of thick boards over the balcony, on two posts.
for i in range(5):
    board = clone('Balcony_Floor', f'PentRoof{i}', 'Tavern')
    y = 13.55 + 0.72 * i
    board.matrix_world = (Matrix.Translation((5.3, y, 4.35 + random.uniform(-0.03, 0.03)))
                          @ Matrix.Rotation(0.3 + random.uniform(-0.04, 0.04), 4, 'Y')
                          @ Matrix.Rotation(random.uniform(-0.03, 0.03), 4, 'Z')
                          @ Matrix.Diagonal((1.75, 0.27, 1.8, 1)))
update()
for i, y in enumerate((13.75, 16.25)):
    post = clone('Post_11', f'Post_Pent{i}', 'Tavern')
    post.scale.z *= 1.4 / O['Post_11'].dimensions.z
    post.matrix_world.translation = Vector((5.6, y, 3.45))

# More lanterns: at the front corners, under the pent roof, at the back.
for i, at in enumerate([(5.35, 12.8, 3.72), (5.95, 13.9, 3.75), (0.65, 17.2, 3.72)]):
    lantern(f'Lantern_more{i}', 'Tavern', 'Lantern_inst1', at)
update()

low('Tavern', 2.6)
crooked(collars('Tavern'), 0.045)
roof('Tavern', Vector((3.0, 15.0, 7.5)), 1.1, 1.15)
# Two iron bands round the ridge-cap block.
size = ridge_cap.dimensions.x / 2
c = ridge_cap.matrix_world.translation
for i, s in enumerate((-0.32, 0.32)):
    collar(f'RidgeBand{i}', 'Tavern',
           Matrix.Translation(c + Vector((0, s * 2 * size, 0))) @ Matrix.Rotation(math.pi / 2, 4, 'X'),
           Vector((size, size)), 0.22, t=0.06)
lean('Tavern', 0.018, 0.035, 0.0025)

# The shop: thicker timbers, a darker ground floor, collars, a bigger porthole, heavier door
# straps, ridge-cap blocks, and its walls flaring out toward the top.
thicken('Shack', 1.9, 1.5)
low('Shack', 2.6)
crooked(collars('Shack'), 0.035)
ring = O['Porthole_Ring'].matrix_world.translation.copy()
for o in parts('Shack'):
    if o.name.startswith('Porthole_'):
        o.matrix_world.translation = ring + (o.matrix_world.translation - ring) * 1.6
        o.scale *= 1.6
        if o.name == 'Porthole_Ring':
            o.scale.z *= 1.5
    elif o.name.startswith('DoorStrap'):
        d = o.dimensions
        for i in sorted(range(3), key=lambda i: d[i])[:2]:
            o.scale[i] *= 1.6
for i, x in enumerate((6.75, 11.25)):
    block = clone('RidgeEnd', f'RidgeBlock{i}', 'Shack')
    block.scale = (1.4, 1.4, 1.4)
    block.matrix_world.translation = Vector((x, 15.0, 4.6))
lean('Shack', 0.04, -0.01, 0.002)


# The cannon: short and thick, tapered to a flared muzzle, with rings round it and a ball at its
# breech, on thicker wheels with big hubs.
def taper(o, x0, x1, end, lip):
    single_user(o)
    for v in o.data.vertices:
        t = min(max((v.co.x - x0) / (x1 - x0), 0), 1)
        s = 1 - (1 - end) * t
        if v.co.x > x1:
            s = end * lip
        v.co.y *= s
        v.co.z *= s


O['Barrel_Pivot'].location.z += 0.08
barrel = O['Barrel']
barrel.scale = (0.75, 1.2, 1.2)
for s in barrel.material_slots:
    if s.material.name == 'Cannon_Iron':
        s.material = gun
update()
taper(barrel, -0.35, 1.5, 0.8, 1.35)
for x, r in ((-0.3, 0.43), (0.3, 0.39), (0.95, 0.36), (1.45, 0.35)):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=r + 0.05, radius2=r + 0.05, depth=0.12)
    bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((x, 0, 0)), verts=bm.verts)
    bmesh.ops.transform(bm, matrix=barrel.matrix_world, verts=bm.verts)
    add_mesh(f'BarrelRing{x}', 'Cannon', bm, 'Cannon_Gun', bevel=0.025)
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.14)
bmesh.ops.scale(bm, vec=Vector((1.6, 1, 1)), verts=bm.verts)
bmesh.ops.translate(bm, vec=Vector((-1.0, 0, 0)), verts=bm.verts)
bmesh.ops.transform(bm, matrix=barrel.matrix_world, verts=bm.verts)
add_mesh('Cascabel', 'Cannon', bm, 'Cannon_Gun')
for o in parts('Cannon'):
    if o.name.startswith('Wheel_'):
        o.scale.y *= 1.3
    elif o.name.startswith(('Hub_', 'HubCap_')):
        o.scale *= 1.5
    for s in o.material_slots:
        if s.material and s.material.name == 'Cannon_Wood':
            s.material = M['Cannon_Carriage']

# The ship: longer guns reaching well out of their ports, two long bow chasers pointing up and
# forward, thicker rigging, and bellied sails.
for i in range(3):
    o = O[f'GunBarrel{i}']
    o.scale.x *= 1.7
    o.scale.y *= 1.15
    o.scale.z *= 1.15
    for s in o.material_slots:
        if s.material.name == 'Cannon_Iron':
            s.material = gun
update()
for i, y in enumerate((16.6, 17.4)):
    o = clone('GunBarrel0', f'BowChaser{i}', 'PirateShip')
    o.matrix_world = (Matrix.Translation((-12.4, y, 3.45)) @ Euler((0, -0.44, math.pi)).to_matrix().to_4x4()
                      @ Matrix.Diagonal((1.25, 0.65, 0.65, 1)))
thicken('PirateShip', 2.0, 2.0, ('Rig', 'Stay', 'Forestay'))

for o in parts('PirateShip'):
    if not o.name.startswith('Sail'):
        continue
    single_user(o)
    co = [v.co for v in o.data.vertices]
    y0, y1 = min(c.y for c in co), max(c.y for c in co)
    z0, z1 = min(c.z for c in co), max(c.z for c in co)
    width, mid = y1 - y0, (y0 + y1) / 2
    for v in o.data.vertices:
        u, h = (v.co.y - y0) / width, (v.co.z - z0) / (z1 - z0)
        # Bellied toward the bow, the lower corners pulled in toward the middle.
        v.co.x -= 0.12 * width * math.sin(math.pi * u) * math.sin(math.pi * (0.1 + 0.8 * h))
        v.co.y = mid + (v.co.y - mid) * (1 - 0.1 * (1 - h) ** 2)


# Rocks rebuilt as prisms: a few big flat faces, a tilted or peaked top, bevelled edges that
# catch a cream highlight.
def prism(bm, centre, radius, z0, z1, sides, tilt, peak, taper=0.85):
    """A prism standing from `z0` to about `z1`, its top tilted by `tilt` toward a random side
    and raised in the middle by `peak`."""
    turn, toward = random.uniform(0, math.tau), random.uniform(0, math.tau)
    base, top = [], []
    for i in range(sides):
        a = turn + math.tau * (i + random.uniform(-0.2, 0.2)) / sides
        k = random.uniform(0.88, 1.12)
        x, y = math.cos(a) * radius.x * k, math.sin(a) * radius.y * k
        base.append(bm.verts.new((centre.x + x, centre.y + y, z0)))
        z = z1 - (z1 - z0) * tilt * (1 - math.cos(a - toward)) / 2
        top.append(bm.verts.new((centre.x + x * taper, centre.y + y * taper, z)))
    sides_ = [bm.faces.new((base[i], base[(i + 1) % sides], top[(i + 1) % sides], top[i]))
              for i in range(sides)]
    cap = bm.faces.new(top)
    bm.faces.new(list(reversed(base)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    rims = [e for f in sides_ + [cap] for e in f.edges if not all(v in base for v in e.verts)]
    return sides_, cap, list(set(rims)), max(radius.x, radius.y, (z1 - z0) / 2)


def rock(o, shapes):
    """Replaces a rock's mesh with prisms, each (centre, radius, height, sides, tilt, peak) in
    fractions of the old mesh's bounds."""
    co = [v.co for v in o.data.vertices]
    lo = Vector([min(c[i] for c in co) for i in range(3)])
    hi = Vector([max(c[i] for c in co) for i in range(3)])
    mid, half = (lo + hi) / 2, (hi - lo) / 2
    bm = bmesh.new()
    for (cx, cy), (rx, ry), h, sides, tilt, peak in shapes:
        layer = edge_layer(bm)
        before = set(bm.verts)
        faces, cap, rims, size = prism(bm, Vector((mid.x + cx * half.x, mid.y + cy * half.y)),
                                       Vector((rx * half.x, ry * half.y)), lo.z - 0.1,
                                       lo.z + h * (hi.z - lo.z), sides, tilt, peak)
        bevel = 0.04 * size
        for v in bm.verts:
            if v not in before:
                v[layer] = 0.85
        bmesh.ops.inset_individual(bm, faces=faces + [cap], thickness=bevel * 2.5, use_even_offset=True)
        inner = {v for f in faces + [cap] for v in f.verts}
        for v in inner:
            v[layer] = 0.0
        if peak:
            centre = bmesh.ops.poke(bm, faces=[cap])['verts'][0]
            centre.co.z += peak * size
            centre[layer] = 0.0
            inner.add(centre)
        bmesh.ops.bevel(bm, geom=rims, offset=bevel, offset_type='OFFSET', segments=2, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
        for v in bm.verts:
            if v not in before and v not in inner:
                v[layer] = 0.85
    me = bpy.data.meshes.new(o.name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M['Prop_Rock'])
    for p in me.polygons:
        p.use_smooth = False
    o.data = me
    o.modifiers.clear()


ROCKS = {
    # A tall prism at the back with two shorter ones in front of it.
    'Cliff_Big': [((0.15, 0.25), (0.55, 0.6), 1.35, 6, 0.25, 0.0),
                  ((-0.45, -0.3), (0.45, 0.45), 0.8, 5, 0.3, 0.12),
                  ((0.55, -0.45), (0.35, 0.4), 0.5, 6, 0.35, 0.0)],
    'Cliff_Mid': [((0, 0.1), (0.75, 0.7), 1.2, 6, 0.3, 0.0),
                  ((0.55, -0.5), (0.35, 0.35), 0.55, 5, 0.3, 0.1)],
    'Cliff_Small': [((0, 0), (0.85, 0.85), 1.05, 5, 0.35, 0.12)],
    'Cliff_Pebble': [((0, 0), (0.9, 0.9), 1.0, 6, 0.3, 0.2)],
    'Boulder_Mesh': [((0, 0), (0.85, 0.85), 1.0, 7, 0.35, 0.15)],
    'Boulder_Small': [((0, 0), (0.9, 0.9), 1.0, 6, 0.3, 0.2)],
    'Rock_Mesh': [((0, 0), (0.9, 0.9), 1.0, 5, 0.3, 0.25)],
}
for name, shapes in ROCKS.items():
    rock(O[name], shapes)


# Small leaves all over the bushes, yellow toward their tips.
def leaves(clump, root_name, material, count, size):
    me = clump.data
    mw = clump.matrix_world
    bm = bmesh.new()
    layer = edge_layer(bm)
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
            row = [bm.verts.new(centre - side * w + n * w * 0.25),
                   bm.verts.new(centre + n * 0.0),
                   bm.verts.new(centre + side * w + n * w * 0.25)]
            for x in row:
                x[layer] = 0.9 * t * t
            rows.append(row)
        for k in range(5):
            a, b = rows[k], rows[k + 1]
            for j in range(2):
                bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return add_mesh(f'{clump.name}_Leaves', root_name, bm, material)


for root_name, material, size in (('Bush', 'Prop_Bush', 0.14), ('RedBush', 'Prop_RedBush', 0.1)):
    for clump in [o for o in parts(root_name) if 'Clump' in o.name]:
        leaves(clump, root_name, material, 24, size)


# Palms: broad drooping leaves, notched along their edges, on a trunk half as tall.
def leaf(length, width):
    """A leaf along +X from the origin, rising and then drooping, its edges raised and notched."""
    bm = bmesh.new()
    layer = edge_layer(bm)
    rows, x, z = [], 0.0, 0.0
    n = 20
    for k in range(n + 1):
        t = k / n
        a = 0.5 - 1.9 * t
        if k:
            x += math.cos(a) * length / n
            z += math.sin(a) * length / n
        half = max(width / 2 * math.sin(math.pi * t) ** 0.6, 0.02 * (1 - t))
        row = []
        for c in (-1, -0.5, 0, 0.5, 1):
            w = half * c
            if abs(c) == 1 and k % 3 == 1 and 0.15 < t < 0.95:
                w *= 0.6
            lift = 0.15 * half * c * c
            v = bm.verts.new((x - math.sin(a) * lift, w, z + math.cos(a) * lift))
            v[layer] = (0.0, 0.3, 0.75)[int(abs(c) * 2)]
            row.append(v)
        rows.append(row)
    for k in range(n):
        for j in range(4):
            bm.faces.new((rows[k][j], rows[k][j + 1], rows[k + 1][j + 1], rows[k + 1][j]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    me = bpy.data.meshes.new('PalmLeaf')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M['Prop_Leaf'])
    for p in me.polygons:
        p.use_smooth = True
    return me


update()
trunk = sorted((o for o in parts('PalmTree') if o.name.startswith('Palm_Trunk')),
               key=lambda o: o.matrix_world.translation.z)
foot = trunk[0].matrix_world.translation.copy()
old_top = trunk[-1].matrix_world.translation.copy()
for o in trunk:
    p = o.matrix_world.translation
    o.matrix_world.translation = Vector((foot.x + (p.x - foot.x) * 0.7, p.y, foot.z + (p.z - foot.z) * 0.5))
    o.scale.z *= 0.5
update()
drop = trunk[-1].matrix_world.translation - old_top
fronds = [o for o in parts('PalmTree') if o.name.startswith('Palm_Frond')]
while len(fronds) < 11:
    fronds.append(clone(fronds[0].name, f'Palm_Frond{len(fronds)}', 'PalmTree'))
for i, o in enumerate(fronds):
    o.data = leaf(random.uniform(1.4, 1.65), random.uniform(0.45, 0.55))
    o.modifiers.clear()
    o.rotation_euler = (random.uniform(-0.1, 0.1), random.uniform(-0.2, 0.1),
                        math.tau * i / len(fronds) + random.uniform(-0.2, 0.2))
for o in parts('PalmTree'):
    if o.name.startswith(('Palm_Frond', 'Palm_Coconut')):
        o.location += drop
update()


# The barrels squat and bulging, with thick hoops standing proud of the staves.
for o in parts('Barrel.001'):
    if o.name.startswith('Barrel_Band'):
        single_user(o)
        for s in o.material_slots:
            s.material = M['Cannon_IronTrim']
        zs = [v.co.z for v in o.data.vertices]
        zc = (min(zs) + max(zs)) / 2
        for v in o.data.vertices:
            v.co.z = zc + (v.co.z - zc) * 2
            v.co.x *= 1.05
            v.co.y *= 1.05
c = O['Barrel.001'].matrix_world.translation.copy()


def squat(p):
    t = min(max((p.z - c.z) / 0.9, 0), 1)
    k = 1 + 0.12 * math.sin(math.pi * t)
    return Vector((c.x + (p.x - c.x) * k, c.y + (p.y - c.y) * k, c.z + (p.z - c.z) * 0.85))


deform('Barrel.001', squat)


# A grass tuft: blades leaning out and bending over.
grass_root = bpy.data.objects.new('GrassTuft', None)
bpy.context.scene.collection.objects.link(grass_root)
grass_root.location = (16.0, 6.0, 0.0)
update()
bm = bmesh.new()
for i in range(9):
    a = math.tau * i / 9 + random.uniform(-0.3, 0.3)
    outward = Vector((math.cos(a), math.sin(a), 0))
    side = Vector((0, 0, 1)).cross(outward)
    lean_ = random.uniform(0.2, 0.5)
    h = random.uniform(0.22, 0.4)
    start = Vector(grass_root.location) + outward * random.uniform(0, 0.05)
    row = None
    for k in range(5):
        t = k / 4
        centre = start + outward * (math.sin(lean_) * h * t + 0.12 * h * t * t) + Vector((0, 0, h * t * math.cos(lean_)))
        w = 0.035 * (1 - t)
        new = [bm.verts.new(centre - side * w), bm.verts.new(centre + side * w)] if k < 4 else [bm.verts.new(centre)]
        if row:
            bm.faces.new(row + list(reversed(new)) if len(new) == 2 else row + new)
        row = new
add_mesh('GrassTuft_Blades', 'GrassTuft', bm, 'Prop_Grass')

update()
bpy.ops.wm.save_as_mainfile(filepath=out)
print('saved', out, flush=True)
