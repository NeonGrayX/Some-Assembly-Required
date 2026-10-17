"""Pushes the pirate assets toward the reference picture's look, before they are baked.

    python scripts/stylize-pirate-assets.py -- pirate.blend /tmp/pirate-styled.blend
    python scripts/bake-pirate-assets.py -- /tmp/pirate-styled.blend /tmp/pirate-assets.glb

Materials: wood with brighter painted edges and deeper grime, dark on its sides and bright on
its tops, darker still on the ground floors; cream plaster; indigo roof slates and dark brown
shop shingles; light grey hammered iron, and navy steel on the guns; warm grey rock with cream
edges and dark cracks; cream and terracotta sails with less mottling; olive and yellow-green
leaves, coral red bushes; warm yellow window and lantern glass.

Shapes: the tavern's and shop's timbers much thicker and each a little crooked, iron collars
riveted round both ends of every post and stud, each ridge beam and barge board one chamfered
timber run out past the gables (the ridge beams in iron bands), a pent roof on posts over the
balcony, more lanterns, a deeper roof, both buildings leaning and widening upward; the shop's
porthole bigger; the cannon short,
thick and flared on thicker wheels; the barrels squat and bulging with thick hoops; the ship's
sails bellied, its rigging thicker, its guns longer, two bow chasers; the rocks rebuilt as
bevelled prisms; broad notched palm leaves on a short trunk; bushes covered in small leaves;
and a new grass tuft.
"""
import bpy, bmesh, sys, math, random
from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

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
ramp(m, 'Color Ramp', [(0.15, 0.14, 0.11), (0.29, 0.275, 0.22), (0.37, 0.35, 0.28)])
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
    # A new object's place in the world is worked out from its location only on an update.
    update()
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


def thicken(root_name, factors):
    """The asset's timbers thicker across, not longer: each by the factor of the first name in
    `factors` (name: factor) that it starts with."""
    for o in parts(root_name):
        factor = next((k for name, k in factors.items() if o.name.startswith(name)), None)
        if factor is None:
            continue
        d = o.dimensions
        longest = max(d)
        for i in range(3):
            if d[i] < 0.5 * longest:
                o.scale[i] *= factor
    update()


def extend(o, toward, metres):
    """A timber run on along its own length: the end of it lying toward `toward` (a direction
    in the world) moved `metres` further out, its section and that end's shape unchanged."""
    single_user(o)
    vs = o.data.vertices
    lo = Vector([min(v.co[i] for v in vs) for i in range(3)])
    hi = Vector([max(v.co[i] for v in vs) for i in range(3)])
    k = max(range(3), key=lambda i: (hi[i] - lo[i]) * abs(o.scale[i]))
    axis = Vector((0, 0, 0))
    axis[k] = 1
    along = o.matrix_world.to_3x3() @ axis
    sign = 1 if along.dot(Vector(toward)) > 0 else -1
    mid = (lo[k] + hi[k]) / 2
    for v in vs:
        if (v.co[k] - mid) * sign > 0:
            v.co[k] += sign * metres / along.length
    update()


def chamfered(o, width):
    """A timber's edges cut off about `width` (in the world) across, so that its ends are near
    octagons, with narrow bevels along the cuts so that the softening rounds them only a
    little."""
    b = o.modifiers.new('Chamfer', 'BEVEL')
    b.width = width / max(o.scale)
    b.segments = 1
    hold = o.modifiers.new('Hold', 'BEVEL')
    hold.width = 0.012
    hold.segments = 2
    first(o, hold)
    first(o, b)


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


def box(o):
    """`o`'s bounds in the world: its lowest and highest corners."""
    cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector([min(c[i] for c in cs) for i in range(3)]), Vector([max(c[i] for c in cs) for i in range(3)])


def collars(root_name, skip=(), floor=-1e9):
    """Iron collars round every upright post: round its foot (clear above `floor`, the top of
    the plinth it stands in), and hugging it just below and just above each beam that crosses it
    (just below one that it holds up). Returns each post with its collars."""
    update()
    beams = [box(o) for o in parts(root_name) if o.name.startswith(('TopBeam', 'JettyBeam'))]
    made = {}
    for o in parts(root_name):
        if not o.name.startswith('Post_') or o.name.startswith(skip):
            continue
        d = o.dimensions
        if d.z < 1.0 or abs(o.rotation_euler.x) + abs(o.rotation_euler.y) > 0.01:
            continue
        p = o.matrix_world.translation
        half = Vector((d.x / 2, d.y / 2))
        height = max(0.22, 0.9 * max(d.x, d.y))
        bottom, top = p.z - d.z / 2, p.z + d.z / 2
        at = [max(bottom + 0.12, floor + 0.03) + height / 2]
        for lo, hi in beams:
            if not (lo.x <= p.x <= hi.x and lo.y <= p.y <= hi.y and bottom < lo.z < top):
                continue
            at.append(lo.z - height / 2)
            if hi.z + height < top:
                at.append(hi.z + height / 2)
        rot = Matrix.Rotation(o.matrix_world.to_euler().z, 4, 'Z')
        made[o] = [collar(f'Collar_{o.name}_{i}', root_name,
                          Matrix.Translation((p.x, p.y, z)) @ rot, half, height, t=0.05)
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
    names = ('Shingle_', 'Roof_Deck', 'Barge', 'RidgeBeam', 'LanternHook0')
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


def points(o):
    """`o`'s surface in the world, after its modifiers: its points and faces. A collection
    instance (a lantern) counts as the objects it shows."""
    dg = bpy.context.evaluated_depsgraph_get()
    if o.type == 'EMPTY' and o.instance_collection:
        coll = o.instance_collection
        place = o.matrix_world @ Matrix.Translation(-coll.instance_offset)
        verts, faces = [], []
        for c in coll.all_objects:
            if c.type == 'MESH':
                e = c.evaluated_get(dg)
                n = len(verts)
                verts += [place @ e.matrix_world @ v.co for v in e.data.vertices]
                faces += [[n + i for i in p.vertices] for p in e.data.polygons]
        return verts, faces
    if o.type != 'MESH':
        return [], []
    e = o.evaluated_get(dg)
    me = e.to_mesh()
    verts = [e.matrix_world @ v.co for v in me.vertices]
    faces = [list(p.vertices) for p in me.polygons]
    e.to_mesh_clear()
    return verts, faces


def surface(objs):
    """The objects' surfaces as one tree to cast rays at, and their points."""
    update()
    verts, faces = [], []
    for o in objs:
        v, f = points(o)
        faces += [[len(verts) + i for i in p] for p in f]
        verts += v
    return BVHTree.FromPolygons(verts, faces), verts


def settle(objs, onto, direction=None, embed=0.015, reach=1.5):
    """Moves `objs` together until they rest on (or hang from, or lean on) `onto`, sunk `embed`
    into it: along `direction`, or else straight toward the nearest point of `onto`."""
    _, pts = surface(objs)
    tree, _ = surface(onto)
    if direction is None:
        hits = [(h[3], h[0] - p) for p in pts for h in [tree.find_nearest(p, reach)] if h[0] is not None]
        if not hits:
            print('settle: nothing near', objs[0].name)
            return
        direction = min(hits, key=lambda h: h[0])[1]
        if direction.length < 1e-6:
            return
    d = Vector(direction).normalized()
    hits = [h[3] for p in pts for h in [tree.ray_cast(p, d, reach)] if h[0] is not None]
    if not hits:
        print('settle: nothing within reach of', objs[0].name)
        return
    shift = d * (min(hits) + embed)
    for o in objs:
        if o.parent not in objs:
            o.matrix_world.translation = o.matrix_world.translation + shift
    update()


def hanging(root_name, gap=0.01):
    """The asset's groups of parts that touch one another but neither the ground (its origin's
    height) nor the asset's main body: each group's objects."""
    update()
    objs = [o for o in O[root_name].children_recursive
            if o.type == 'MESH' or (o.type == 'EMPTY' and o.instance_collection)]
    data = []
    for o in objs:
        v, f = points(o)
        if v and f:
            lo = Vector([min(p[i] for p in v) for i in range(3)])
            hi = Vector([max(p[i] for p in v) for i in range(3)])
            data.append((o, BVHTree.FromPolygons(v, f), v[::max(1, len(v) // 150)], lo, hi))
    parent = list(range(len(data)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, (_, ta, va, la, ha) in enumerate(data):
        for j in range(i + 1, len(data)):
            _, tb, vb, lb, hb = data[j]
            if any(la[k] - gap > hb[k] or lb[k] - gap > ha[k] for k in range(3)):
                continue
            if ta.overlap(tb) or any(tb.find_nearest(p, gap)[0] is not None for p in va):
                parent[find(i)] = find(j)
    groups = {}
    for i in range(len(data)):
        groups.setdefault(find(i), []).append(i)
    floor = O[root_name].matrix_world.translation.z
    main = max(groups, key=lambda g: len(groups[g]))
    return [[data[i][0] for i in ms] for g, ms in groups.items()
            if g != main and not any(data[i][3].z <= floor + gap for i in ms)]


def rope(o, thick=1.0, reach=0.6, embed=0.05):
    """A rope (a thin tube between two rings of points): `thick` times as thick about its own
    line, and each end run on `embed` into whatever is within `reach` of it along that line (or
    else nearest it)."""
    single_user(o)
    # Softened, a tube of two rings would shrink to a spindle with needle points, its ends short
    # of what it is tied to.
    for m in list(o.modifiers):
        if m.type == 'SUBSURF':
            o.modifiers.remove(m)
    vs = o.data.vertices
    far = max(vs, key=lambda v: (v.co - vs[0].co).length)
    axis = (far.co - vs[0].co).normalized()
    order = sorted(vs, key=lambda v: v.co.dot(axis))
    half = len(order) // 2
    a = sum((v.co for v in order[:half]), Vector()) / half
    b = sum((v.co for v in order[half:]), Vector()) / (len(order) - half)
    u = (b - a).normalized()
    for v in vs:
        p = v.co - a
        along = p.dot(u)
        v.co = a + u * along + (p - u * along) * thick
    update()
    others = [x for x in O[o.parent.name].children_recursive if x.type == 'MESH' and x != o]
    tree, _ = surface(others)
    mw = o.matrix_world
    for end, ring, sign in ((a, order[:half], -1), (b, order[half:], 1)):
        d = (mw.to_3x3() @ (u * sign)).normalized()
        start = mw @ end
        near = tree.find_nearest(start, reach)
        hit = tree.ray_cast(start, d, reach)
        if near[0] is None or (hit[0] is not None and hit[1].dot(d) > 0):
            # Nothing near, or already in what it is tied to (the line runs on out of it).
            continue
        if hit[0] is not None:
            move = d * (hit[3] + embed)
        else:
            # What it ends beside rather than ahead of, such as the rail under a shroud's foot.
            if (start - near[0]).dot(near[1]) <= 0:
                continue
            move = (near[0] - start) * (1 + embed / max((near[0] - start).length, 1e-6))
        step = mw.inverted().to_3x3() @ move
        for v in ring:
            v.co += step
    update()


# The tavern: timbers as stout as the picture's: the corner posts and the top beam about an
# eighth of the front's width, the floor beam, studs and braces a little less, and the barge
# boards as modelled (thicker, they were the heaviest timbers on the house, twice the picture's).
thicken('Tavern', {'Post_': 1.35, 'Barge_': 1.0, 'TopBeam': 1.5, 'JettyBeam': 1.2,
                   'RidgeBeam': 1.6, 'Stud_': 1.3, 'Brace': 1.6, 'Gable_King': 1.5,
                   'Gable_Collar': 1.5, 'DoorFrame': 1.3, 'DoorJamb': 1.3, 'DoorLintel': 1.3,
                   'Joist': 1.4})
for o in parts('Tavern'):
    # The iron collars (below) wrap the posts where these brackets did; the outermost joists
    # ran out through the corner posts. The block on the ridge's end and those on the barge
    # boards' feet (with their iron caps) were each a lump stuck on a timber's end: the ridge
    # beam and the barge boards run on in one piece in their place (below), as in the picture.
    if o.name.startswith(('PostBracket', 'RidgeEnd', 'BargeEnd', 'BargeCap', 'Joist_F-3', 'Joist_F3',
                          'Joist_B-3', 'Joist_B3')):
        bpy.data.objects.remove(o)
    elif o.name.startswith('Barge_'):
        extend(o, (0, 0, -1), 0.5)
# The ridge beam about half as thick again as a barge board, out past the gables, its front end
# well out over the front's, and its edges cut off so that its ends are near octagons.
ridge = O['RidgeBeam']
extend(ridge, (0, -1, 0), 0.5)
extend(ridge, (0, 1, 0), 0.75)
chamfered(ridge, 0.12)
update()
# A plinth reaching down into the sand, for the slope the tavern stands on.
for v in O['Base'].data.vertices:
    if v.co.z < 0:
        v.co.z -= 0.25 / O['Base'].scale.z

# A pent roof over the balcony: one thick board across the whole of it, on two slim posts
# standing on the balcony's floor.
board = clone('Balcony_Floor', 'PentRoof', 'Tavern')
board.matrix_world = (Matrix.Translation((5.3, 15.0, 4.3)) @ Matrix.Rotation(0.3, 4, 'Y')
                      @ Matrix.Diagonal((1.75, 1.35, 1.8, 1)))
update()
like = O['Balcony_Strut0']
for i, y in enumerate((13.85, 16.15)):
    post = clone('Balcony_Strut0', f'PentPost{i}', 'Tavern')
    scale = like.scale.copy()
    scale.x *= 0.26 / like.dimensions.x
    scale.y *= 0.26 / like.dimensions.y
    scale.z *= 1.26 / like.dimensions.z
    post.matrix_world = Matrix.LocRotScale(Vector((5.72, y, 3.44)), like.rotation_euler, scale)

# More lanterns, hung (below) under the pent roof's edge and the back barge board's end.
for i, at in enumerate([(6.05, 14.4, 3.25), (6.05, 15.6, 3.25), (0.65, 17.2, 3.72)]):
    lantern(f'Lantern_more{i}', 'Tavern', 'Lantern_inst1', at)
update()

low('Tavern', 2.6)
crooked(collars('Tavern', floor=box(O['Base'])[1].z), 0.025)
roof('Tavern', Vector((3.0, 15.0, 7.5)), 1.1, 1.15)
# An iron band round the ridge beam's front end, between the lantern's hook and the gable.
lo, hi = box(ridge)
front = min(box(o)[0].y for o in parts('Tavern') if o.name.startswith(('Barge_LF', 'Barge_RF')))
y = (O['LanternHook0'].matrix_world.translation.y + front) / 2
collar('RidgeBand', 'Tavern',
       Matrix.Translation(((lo.x + hi.x) / 2, y, (lo.z + hi.z) / 2)) @ Matrix.Rotation(math.pi / 2, 4, 'X'),
       Vector(((hi.x - lo.x) / 2, (hi.z - lo.z) / 2)), 0.2, t=0.04)
# The ridge's lantern hung under the beam's end, not inside it.
ridge_lantern = [O['Lantern_inst0'], O['LanternHook0']]
for o in ridge_lantern:
    o.matrix_world.translation = o.matrix_world.translation - Vector((0, 0, 1.2))
settle(ridge_lantern, [ridge], (0, 0, 1), embed=0.03)
lean('Tavern', 0.018, 0.035, 0.0025)


def faces_at(o, z):
    """Where an upright timber (a box, leaning and flared with the house) has its faces at
    height `z`: its least and greatest x, and its least and greatest y."""
    ps, _ = points(o)
    bottom, top = min(p.z for p in ps), max(p.z for p in ps)
    foot = [p for p in ps if p.z < bottom + 0.3]
    head = [p for p in ps if p.z > top - 0.3]
    t = (z - bottom) / (top - bottom)
    return [(min(p[i] for p in foot) + t * (min(p[i] for p in head) - min(p[i] for p in foot)),
             max(p[i] for p in foot) + t * (max(p[i] for p in head) - max(p[i] for p in foot)))
            for i in (0, 1)]


def ends(o):
    """The middles of a timber's two ends, along its longest side, in the world: lowest first."""
    vs = o.data.vertices
    lo = Vector([min(v.co[i] for v in vs) for i in range(3)])
    hi = Vector([max(v.co[i] for v in vs) for i in range(3)])
    k = max(range(3), key=lambda i: hi[i] - lo[i])
    out = []
    for value in (lo[k], hi[k]):
        p = (lo + hi) / 2
        p[k] = value
        out.append(o.matrix_world @ p)
    return sorted(out, key=lambda p: p.z)


def aim(o, target):
    """Turns and stretches a timber about its upper end so that its lower end comes to `target`
    (in the world)."""
    single_user(o)
    bottom, top = ends(o)
    old, new = bottom - top, target - top
    turn = old.rotation_difference(new).to_matrix()
    along = new.normalized()
    stretch = new.length / old.length - 1
    mw = o.matrix_world
    inv = mw.inverted()
    for v in o.data.vertices:
        w = turn @ (mw @ v.co - top)
        v.co = inv @ (top + w + along * w.dot(along) * stretch)
    update()


def push(o, by):
    o.matrix_world = Matrix.Translation(by) @ o.matrix_world


# The corner posts each one timber from sill to eaves, as in the picture. The floor beam ran
# across in front of them, so that with a collar above it and one below each post read as two
# stubs: it is set back behind their faces, and the upper storey's studs and braces, which stand
# on it, are set back with it.
update()
jetty = O['JettyBeam']
single_user(jetty)
j_lo, j_hi = box(jetty)
posts = [o for o in parts('Tavern') if o.name.startswith('Post_') and o.dimensions.z > 3]
faces = [faces_at(o, (j_lo.z + j_hi.z) / 2) for o in posts]
mw = jetty.matrix_world
inv = mw.inverted()
middle = (j_lo + j_hi) / 2
for i in (0, 1):
    # Behind the face of the post that stands least far out on each side.
    least = max(f[i][0] for o, f in zip(posts, faces) if o.matrix_world.translation[i] < middle[i]) + 0.08
    most = min(f[i][1] for o, f in zip(posts, faces) if o.matrix_world.translation[i] > middle[i]) - 0.08
    # Each side of it moved whole, its outer and inner faces together.
    for v in jetty.data.vertices:
        w = mw @ v.co
        w[i] += max(0, least - j_lo[i]) if w[i] < middle[i] else min(0, most - j_hi[i])
        v.co = inv @ w
update()
house = O['Tavern'].matrix_world.to_3x3()
inward = {'F': (0, 1, 0), 'B': (0, -1, 0), 'L': (1, 0, 0), 'R': (-1, 0, 0)}
for o in parts('Tavern'):
    side = (o.name[5] if o.name.startswith('Stud_') else o.name[6] if o.name.startswith('Brace_')
            else None)
    if side in inward and box(o)[0].z > j_hi.z - 0.1:
        # The braces, thicker, behind the posts' faces too.
        push(o, house @ Vector(inward[side]) * (0.12 if o.name.startswith('Brace_') else 0.08))
update()
# The studs beside the upper window out from under its open shutters, which cut into them.
for shutter in [o for o in parts('Tavern') if o.name.startswith('Shutter_')]:
    s_lo, s_hi = box(shutter)
    for o in parts('Tavern'):
        lo, hi = box(o)
        if o.name.startswith('Stud_F') and lo.x < s_hi.x and hi.x > s_lo.x:
            dx = s_lo.x - 0.01 - hi.x if lo.x + hi.x < s_lo.x + s_hi.x else s_hi.x + 0.01 - lo.x
            push(o, Vector((dx, 0, 0)))
            update()
# The braces on the back, which ran down over the corner posts into their collars, butting
# instead into the post's side between the collar over the floor beam and the one under the top
# beam. The front's, which the picture does not have, gone: there the studs beside the window
# stand where they ran.
for o in parts('Tavern'):
    if o.name.startswith('Brace_F'):
        bpy.data.objects.remove(o)
update()
for o in parts('Tavern'):
    if not o.name.startswith('Brace_B'):
        continue
    bottom, top = ends(o)
    post = min(posts, key=lambda p: (p.matrix_world.translation - bottom).xy.length)
    rings = sorted((box(x) for x in parts('Tavern') if x.name.startswith(f'Collar_{post.name}_')),
                   key=lambda b: b[0].z)
    above = [b for b in rings if b[0].z > j_hi.z - 0.05]
    z = (above[0][1].z + above[1][0].z) / 2
    (x0, x1), _ = faces_at(post, z)
    x = x1 - 0.03 if top.x > bottom.x else x0 + 0.03
    aim(o, Vector((x, bottom.y, z)))

# The balcony's struts: clear of the posts' collars beside them, and down to the wall over the
# window under the balcony, not onto its frame.
rings = [box(x) for x in parts('Tavern') if x.name.startswith('Collar_Post_')]
window = max(box(x)[1].z for x in parts('Tavern') if x.name.startswith('GF_Win'))
struts = [o for o in parts('Tavern') if o.name.startswith('Balcony_Strut')]
for o in struts:
    lo, hi = box(o)
    for r_lo, r_hi in rings:
        if r_hi.z < lo.z or r_lo.z > hi.z or r_hi.x < lo.x or r_lo.x > hi.x:
            continue
        if r_hi.y + 0.08 > lo.y and r_lo.y - 0.08 < hi.y:
            dy = r_hi.y + 0.08 - lo.y if r_lo.y + r_hi.y < lo.y + hi.y else r_lo.y - 0.08 - hi.y
            push(o, Vector((0, dy, 0)))
            lo, hi = box(o)
update()
tree, _ = surface([x for x in parts('Tavern') if x not in struts])
for o in struts:
    bottom, top = ends(o)
    d = Vector((bottom.x - top.x, bottom.y - top.y, 0)).normalized()
    start = Vector((top.x, bottom.y, window + 0.13))
    hit = tree.ray_cast(start, d, 3.0)
    if hit[0] is not None:
        aim(o, hit[0] + d * 0.03)

# The shop: thicker timbers, a darker ground floor, collars, a bigger porthole, heavier door
# straps, a ridge beam run out past the gables in iron bands, and its walls flaring out toward
# the top.
thicken('Shack', {'Post_': 1.2, 'Barge_': 1.15, 'TopBeam': 1.15, 'Ridge': 1.55, 'Stud_': 1.3,
                  'Brace': 1.3, 'DoorFrame': 1.2, 'DoorJamb': 1.2, 'DoorLintel': 1.2})
low('Shack', 2.6)
crooked(collars('Shack', floor=box(O['Base.001'])[1].z), 0.025)
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
update()
# The porthole, too big now for the wall over the door, up in the right gable as in the picture.
move = (Matrix.Translation((10.7, 15.2, 3.35)) @ Matrix.Rotation(math.pi / 2, 4, 'Z')
        @ Matrix.Translation(-ring))
for o in parts('Shack'):
    if o.name.startswith('Porthole_'):
        o.matrix_world = move @ o.matrix_world
# A plinth reaching down into the sand, for the slope the shop stands on.
for v in O['Base.001'].data.vertices:
    if v.co.z < 0:
        v.co.z -= 0.45 / O['Base.001'].scale.z
# The ridge one timber out past both gables, as in the picture, where it had a block stuck on
# each end and iron plates on its own ends inside them; an iron band round it outside each gable.
for o in parts('Shack'):
    if o.name.startswith('RidgeCap'):
        bpy.data.objects.remove(o)
ridge = O['Ridge']
for side in (-1, 1):
    extend(ridge, (side, 0, 0), 0.35)
chamfered(ridge, 0.1)
lo, hi = box(ridge)
for side, x in ((-1, lo.x), (1, hi.x)):
    collar(f'RidgeBand{side}', 'Shack',
           Matrix.Translation((x - side * 0.2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2))
           @ Matrix.Rotation(math.pi / 2, 4, 'Y'),
           Vector(((hi.z - lo.z) / 2, (hi.y - lo.y) / 2)), 0.16, t=0.035)
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


barrel = O['Barrel']
barrel.scale = (0.75, 0.9, 0.9)
for s in barrel.material_slots:
    if s.material.name == 'Cannon_Iron':
        s.material = gun
update()
taper(barrel, -0.35, 1.5, 0.8, 1.35)
update()
# Each ring a raised band tight round the barrel as tapered (and softened by its modifiers)
# where it sits: round the middle of the barrel's cross-section there, just clear of its
# widest point.
shell = barrel.evaluated_get(bpy.context.evaluated_depsgraph_get())
loops = {}
for v in shell.data.vertices:
    loops.setdefault(round(v.co.x, 2), []).append(Vector((0, v.co.y, v.co.z)))


def section(x):
    """The middle and the radius of the barrel's loop of points at `x`."""
    centre = sum(loops[x], Vector()) / len(loops[x])
    return centre, max((c - centre).length for c in loops[x])


for x in (-0.3, 0.3, 0.95, 1.45):
    # Between the loops either side of it.
    a, b = max(k for k in loops if k <= x), min(k for k in loops if k >= x)
    (ca, ra), (cb, rb) = section(a), section(b)
    t = (x - a) / (b - a) if b > a else 0
    centre, r = ca.lerp(cb, t), ra + (rb - ra) * t + 0.005
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=r, radius2=r, depth=0.12)
    bmesh.ops.rotate(bm, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((x, centre.y, centre.z)), verts=bm.verts)
    bmesh.ops.transform(bm, matrix=barrel.matrix_world, verts=bm.verts)
    ring = add_mesh(f'BarrelRing{x}', 'Cannon', bm, 'Cannon_Gun', bevel=0.012)
    band = ring.modifiers.new('Band', 'SOLIDIFY')
    band.thickness = 0.03
    band.offset = 1.0
    band.use_even_offset = True
    first(ring, band)
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

# The ship: slim guns that fit their ports, two long bow chasers pointing up and forward,
# thicker rigging, and bellied sails.
for i in range(3):
    o = O[f'GunBarrel{i}']
    o.scale.y *= 0.6
    o.scale.z *= 0.6
    for s in o.material_slots:
        if s.material.name == 'Cannon_Iron':
            s.material = gun
update()
for i, y in enumerate((16.6, 17.4)):
    o = clone('GunBarrel0', f'BowChaser{i}', 'PirateShip')
    o.matrix_world = (Matrix.Translation((-12.4, y, 3.38)) @ Euler((0, -0.5, math.pi)).to_matrix().to_4x4()
                      @ Matrix.Diagonal((1.3, 0.35, 0.35, 1)))
update()
# Each chaser's breech on a wooden chock standing on the deck (its muzzle rests on the rail).
deck = surface([O['Deck']])[0]
for i in range(2):
    pts = points(O[f'BowChaser{i}'])[0]
    back = max(p.x for p in pts)
    breech = [p for p in pts if p.x > back - 0.35]
    at = sum(breech, Vector()) / len(breech)
    top = min(p.z for p in breech) + 0.03
    hit = deck.ray_cast(Vector((at.x, at.y, top)), Vector((0, 0, -1)), 3.0)
    bottom = (hit[0].z if hit[0] is not None else top - 1.0) - 0.03
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=Vector((0.3, 0.3, top - bottom)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((at.x, at.y, (top + bottom) / 2)), verts=bm.verts)
    add_mesh(f'BowChock{i}', 'PirateShip', bm, 'Cannon_WoodDark', bevel=0.02, smooth=False)
# The yards across the fronts of their masts, not through them.
ship = O['PirateShip'].matrix_world
ahead = -(ship.to_3x3() @ Vector((1, 0, 0))).normalized()
for o in parts('PirateShip'):
    if not o.name.startswith('Yard'):
        continue
    mast, _ = surface([O['Mast' + o.name[4]]])
    lo, hi = box(o)
    c = (lo + hi) / 2
    front = mast.ray_cast(c + ahead * 2, -ahead, 3.0)
    if front[0] is not None:
        half = abs((hi - lo).dot(ahead)) / 2
        push(o, ahead * ((front[0] - c).dot(ahead) + half - 0.03))
update()

# The wales along the hull standing a little proud of its planks all along: toward the bow,
# where the hull curves in, they sank into it and showed only as slivers.
hull, _ = surface([O['Hull']])
along = ship.inverted()
for o in parts('PirateShip'):
    if not o.name.startswith(('WaleHi_', 'WaleLo_')):
        continue
    single_user(o)
    # How far its outermost point stands off the planks, in quarter-metre steps along the ship.
    proud = {}
    for w in points(o)[0]:
        p, n, _, _ = hull.find_nearest(w)
        k = round((along @ w).x * 4)
        proud[k] = max(proud.get(k, -1.0), (w - p).dot(n))
    mw = o.matrix_world
    inv = mw.inverted()
    for v in o.data.vertices:
        w = mw @ v.co
        p, n, _, _ = hull.find_nearest(w)
        lift = 0.035 - proud.get(round((along @ w).x * 4), 0.035)
        if lift > 0:
            v.co = inv @ (w + n * lift)
update()

# The ropes thin lines about their own lines, as in the picture (each is modelled round the
# ship's origin, so scaling the object would throw it across the ship), and run on to the mast,
# yard or rail they end short of.
for o in parts('PirateShip'):
    if o.name.startswith(('Rig', 'Stay', 'Forestay')):
        rope(o, 0.7)

for o in parts('PirateShip'):
    if not o.name.startswith('Sail'):
        continue
    single_user(o)
    mw = o.matrix_world
    inv = mw.inverted()
    # The yards it is bent to (as modelled its head and foot curve forward, off them): the
    # front of each, and the top of the lower one and the underside of the upper.
    lo_top, hi_top = box(O[f'Yard{o.name[4:]}Top'])
    lo_bot, hi_bot = box(O[f'Yard{o.name[4:]}Bot'])
    front = (lo_top.x + lo_bot.x) / 2
    co = [mw @ v.co for v in o.data.vertices]
    y0, y1 = min(c.y for c in co), max(c.y for c in co)
    z0, z1 = min(c.z for c in co), max(c.z for c in co)
    # Softened, its foot draws up and its head down a little: so far past the yards that,
    # softened, they still run into them.
    shown = [p.z for p in points(o)[0]]
    zt = lo_top.z + 0.04 + (z1 - max(shown))
    zb = hi_bot.z - 0.04 - (min(shown) - z0)
    width, mid = y1 - y0, (y0 + y1) / 2
    for v, p in zip(o.data.vertices, co):
        u, h = (p.y - y0) / width, (p.z - z0) / (z1 - z0)
        # Bellied toward the bow, as much as modelled and more, falling to nothing at the yards;
        # the lower corners pulled in toward the middle.
        belly = (front - p.x) + 0.12 * width * math.sin(math.pi * u)
        q = Vector((front - belly * math.sin(math.pi * h) ** 0.5,
                    mid + (p.y - mid) * (1 - 0.1 * (1 - h) ** 2),
                    zb + h * (zt - zb)))
        v.co = inv @ q
update()
# The bell at the main masthead out of the mast: hung from a short arm off the topmast, over
# the crow's nest.
bpy.data.objects.remove(O['Bell_inst'])
mast = O['Mast1'].matrix_world.translation
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1)
bmesh.ops.scale(bm, vec=Vector((0.11, 0.62, 0.11)), verts=bm.verts)
bmesh.ops.translate(bm, vec=Vector((mast.x, mast.y - 0.31, 13.0)), verts=bm.verts)
add_mesh('BellArm', 'PirateShip', bm, 'Cannon_WoodDark', bevel=0.015, smooth=False)
bell = O['ShipBell'].matrix_world.translation
for name in ('Bell_Body', 'Bell_Crown'):
    part = clone(name, f'Mast{name}', 'PirateShip')
    part.matrix_world.translation = part.matrix_world.translation - bell + Vector((mast.x, mast.y - 0.42, 13.0 - 0.055 - 0.67))


# The stern's outer windows back against its curve.
outer = [o for o in parts('PirateShip') if o.name.startswith(('Stern_Win0_', 'Stern_Win2_'))]
for o in outer:
    if o.parent not in outer:
        o.matrix_world.translation = o.matrix_world.translation - Vector((0.04, 0, 0))
update()


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


def rock(o, shapes, floor=None):
    """Replaces a rock's mesh with prisms, each (centre, radius, height, sides, tilt, peak) in
    fractions of the old mesh's bounds, running on down to `floor` below the asset's origin if
    given (so that a cliff on a slope stays in the ground all round)."""
    co = [v.co for v in o.data.vertices]
    lo = Vector([min(c[i] for c in co) for i in range(3)])
    hi = Vector([max(c[i] for c in co) for i in range(3)])
    mid, half = (lo + hi) / 2, (hi - lo) / 2
    z0 = lo.z - 0.1
    if floor is not None:
        # Tilted a little, so a little lower again under its centre.
        down = o.matrix_world.translation.copy()
        root = o
        while root.parent:
            root = root.parent
        down.z = root.matrix_world.translation.z - floor
        z0 = min(z0, (o.matrix_world.inverted() @ down).z - 0.3)
    bm = bmesh.new()
    for (cx, cy), (rx, ry), h, sides, tilt, peak in shapes:
        layer = edge_layer(bm)
        before = set(bm.verts)
        faces, cap, rims, size = prism(bm, Vector((mid.x + cx * half.x, mid.y + cy * half.y)),
                                       Vector((rx * half.x, ry * half.y)),
                                       z0,
                                       lo.z + h * (hi.z - lo.z), sides, tilt, peak)
        bevel = 0.04 * size
        for v in bm.verts:
            if v not in before:
                v[layer] = 0.6
        bmesh.ops.inset_individual(bm, faces=faces + [cap], thickness=bevel * 1.5, use_even_offset=True)
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
                v[layer] = 0.6
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
    rock(O[name], shapes, 1.3 if name.startswith('Cliff_') else None)


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
        leaves(clump, root_name, material, 36, size)
        # The clump inside them smaller, so the leaves hide it.
        clump.scale *= 0.6


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
# The crown down onto the shortened trunk, and the whole palm down onto the ground (halving
# each trunk segment's height lifted the lowest off it).
crown = [o for o in parts('PalmTree') if o.name.startswith(('Palm_Frond', 'Palm_Coconut'))]
settle(crown, trunk, (0, 0, -1), embed=0.04)
lowest = min(p.z for p in surface(trunk)[1])
for o in trunk + crown:
    o.matrix_world.translation = o.matrix_world.translation - Vector((0, 0, lowest + 0.04))
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


# The bell's clapper on its axis just inside its mouth, on a rod down from its crown.
clapper = O['Bell_Clapper']
clapper.location = (0, 0, 0.35)
update()
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.01, radius2=0.01, depth=0.28)
bmesh.ops.translate(bm, vec=O['ShipBell'].matrix_world.translation + Vector((0, 0, 0.5)), verts=bm.verts)
add_mesh('Bell_Rod', 'ShipBell', bm, clapper.material_slots[0].material.name)
# The rope bridge's hangers tied on at both ends, to its hand rope and its deck.
for o in parts('RopeBridge'):
    if o.name.startswith('Hanger_'):
        rope(o, embed=0.02)

# Whatever still hangs in the air, apart from the rest of its asset, moved onto it: lanterns
# (with their hooks) up to the beam they hang from, the shop's roof down onto its walls, and the
# rest (window bars, sails) toward whatever is nearest.
for root_name in ('Tavern', 'Shack', 'PirateShip', 'Cannon', 'RopeBridge', 'PalmTree'):
    groups = hanging(root_name)
    loose = {o for g in groups for o in g}
    body = [o for o in O[root_name].children_recursive
            if o not in loose and (o.type == 'MESH' or o.instance_collection)]
    for group in groups:
        names = [o.name for o in group]
        if any(o.instance_collection or 'Hook' in o.name for o in group):
            direction = (0, 0, 1)
        elif any(n.startswith(('Ridge', 'RoofDeck', 'Roof_Deck')) for n in names):
            direction = (0, 0, -1)
        else:
            direction = None
        settle(group, body, direction)


# The rope bridge's planks turned less out of line: turned as modelled, neighbours' corners met,
# and on the gangway's slope they crossed.
bridge = O['RopeBridge'].matrix_world
for o in parts('RopeBridge'):
    if o.name.startswith('Plank'):
        m = bridge.inverted() @ o.matrix_world
        c = m.translation.copy()
        turn = Matrix.Rotation(-0.6 * m.to_euler().z, 4, 'Z')
        o.matrix_world = bridge @ Matrix.Translation(c) @ turn @ Matrix.Translation(-c) @ m
update()


# Two assets made from parts of others, for where one run meets another (each asset is drawn as
# one mesh, so its parts cannot be hidden in the map): the rope bridge's planks on their ropes
# alone, for the gangway's run inboard of the gunwale, where the run up from the beach has its
# posts; and the rope fence without its first post, for each run after the first, whose first
# post is the last post of the run before.
def variant(root_name, new, keep):
    root = bpy.data.objects.new(new, None)
    bpy.context.scene.collection.objects.link(root)
    shift = Vector((0, -3.0, 0))
    root.location = O[root_name].matrix_world.translation + shift
    update()
    for o in parts(root_name):
        if keep(o.name):
            c = clone(o.name, f'{new}_{o.name}', new)
            c.matrix_world.translation = c.matrix_world.translation + shift
    update()


variant('RopeBridge', 'Gangplank', lambda n: n.startswith(('Plank', 'DeckRope')))
variant('RopeFence', 'FenceRun', lambda n: not n.startswith(('Fence_Post0', 'Fence_PostCap0', 'Fence_Wrap0')))


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
