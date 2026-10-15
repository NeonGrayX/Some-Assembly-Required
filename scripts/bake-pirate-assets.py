"""Bakes the pirate assets' procedural materials into textures and exports them as one glb.

Every top-level empty in the .blend is an asset: its meshes get one shared UV layout and one
colour and one normal texture; glowing and glass parts keep a material of their own.

    pip install bpy   # Blender as a Python module
    python scripts/bake-pirate-assets.py -- pirate.blend /tmp/pirate-assets.glb [asset ...]
    npx @gltf-transform/cli optimize /tmp/pirate-assets.glb \
        client/src/testmap/assets/pirate-assets.glb --compress meshopt --texture-compress webp \
        --simplify false --instance false --join false --flatten false --palette false
"""
import bpy, sys, math, os, time

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
src, out, only = args[0], args[1], set(args[2:])
bpy.ops.wm.open_mainfile(filepath=src)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.render.bake.margin = 6
sc.render.bake.margin_type = 'EXTEND'

SIZE = {'PirateShip': 2048, 'Tavern': 2048, 'Shack': 1024, 'Cannon': 1024, 'RopeBridge': 1024,
        'PalmTree': 1024, 'CliffRocks': 1024}
GLOW = {'Prop_WindowGlow', 'Prop_LanternGlow'}
GLASS = {'Prop_BottleGlass'}

# Collection instances (lanterns, bottles, the bell, the flag) made real, so they bake too.
bpy.ops.object.select_all(action='DESELECT')
for o in list(bpy.data.objects):
    if o.instance_type == 'COLLECTION' and o.instance_collection:
        o.select_set(True)
bpy.context.view_layer.objects.active = None
bpy.ops.object.duplicates_make_real(use_base_parent=True, use_hierarchy=True)

roots = [o for o in bpy.data.objects if o.parent is None and o.type == 'EMPTY']
if only:
    roots = [r for r in roots if r.name in only]

def meshes(root):
    out = []
    stack = list(root.children)
    while stack:
        o = stack.pop()
        stack.extend(o.children)
        if o.type == 'MESH':
            out.append(o)
    return out

def principled(m):
    return next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')

def output(m):
    return next(n for n in m.node_tree.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)

def bake_node(m):
    n = m.node_tree.nodes.get('BAKE_TARGET')
    if not n:
        n = m.node_tree.nodes.new('ShaderNodeTexImage')
        n.name = 'BAKE_TARGET'
    m.node_tree.nodes.active = n
    return n

def select_only(objs):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.hide_set(False); o.hide_render = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

# Apply the modifiers and lay out one UV map per asset.
plan = []
for root in roots:
    objs = meshes(root)
    if not objs:
        continue
    select_only(objs)
    bpy.ops.object.convert(target='MESH')
    for o in objs:
        if o.data.users > 1:
            o.data = o.data.copy()
        while o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    size = SIZE.get(root.name, 512)
    colour = bpy.data.images.new(f'{root.name}_colour', size, size, alpha=False)
    normal = bpy.data.images.new(f'{root.name}_normal', size, size, alpha=False)
    normal.colorspace_settings.name = 'Non-Color'
    plan.append((root, objs, colour, normal))
    print('unwrapped', root.name, len(objs), size, flush=True)

def materials(objs):
    return {s.material for o in objs for s in o.material_slots if s.material}

def bake(objs, image, kind):
    for m in materials(objs):
        bake_node(m).image = image
    select_only(objs)
    t = time.time()
    if kind == 'NORMAL':
        sc.cycles.samples = 4
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_clear=True)
    else:
        sc.cycles.samples = 24
        bpy.ops.object.bake(type='EMIT', use_clear=True)
    print('baked', kind, image.name, round(time.time() - t, 1), 's', flush=True)

# The normals first, through the materials as they are (their bumps).
for root, objs, colour, normal in plan:
    bake(objs, normal, 'NORMAL')

# Then the colour: each material's base colour (a glow's emission colour) sent straight out.
for m in bpy.data.materials:
    if not m.node_tree:
        continue
    p = principled(m)
    src = p.inputs['Emission Color' if m.name in GLOW else 'Base Color']
    e = m.node_tree.nodes.new('ShaderNodeEmission')
    e.inputs['Strength'].default_value = 1
    if src.is_linked:
        m.node_tree.links.new(src.links[0].from_socket, e.inputs['Color'])
    else:
        e.inputs['Color'].default_value = src.default_value
    m.node_tree.links.new(e.outputs['Emission'], output(m).inputs['Surface'])
for root, objs, colour, normal in plan:
    bake(objs, colour, 'EMIT')

# One material per asset (and its glow and glass), and one mesh per material.
def baked_material(name, colour, normal, rough, glow=False, glass=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = principled(m)
    p.inputs['Roughness'].default_value = rough
    c = nt.nodes.new('ShaderNodeTexImage'); c.image = colour
    nt.links.new(c.outputs['Color'], p.inputs['Base Color'])
    if glow:
        nt.links.new(c.outputs['Color'], p.inputs['Emission Color'])
        p.inputs['Emission Strength'].default_value = 1
    else:
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = normal
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    if glass:
        p.inputs['Alpha'].default_value = 0.75
    m.use_backface_culling = False
    return m

for root, objs, colour, normal in plan:
    rough = {}
    for m in materials(objs):
        r = principled(m).inputs['Roughness']
        rough[m.name] = 0.75 if r.is_linked else r.default_value
    base = baked_material(f'{root.name}', colour, normal, 0.8)
    glow = baked_material(f'{root.name}_glow', colour, normal, 0.5, glow=True)
    glass = baked_material(f'{root.name}_glass', colour, normal, 0.12, glass=True)
    for o in objs:
        for s in o.material_slots:
            n = s.material.name if s.material else ''
            s.material = glow if n in GLOW else glass if n in GLASS else base
    select_only(objs)
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = f'{root.name}_mesh'
    bpy.ops.object.parent_set(type='OBJECT', keep_transform=True) if False else None
    if joined.parent != root:
        mw = joined.matrix_world.copy()
        joined.parent = root
        joined.matrix_world = mw
    # Unused material slots dropped.
    bpy.ops.object.material_slot_remove_unused()
    print('joined', root.name, len(joined.data.polygons), [s.material.name for s in joined.material_slots], flush=True)

bpy.ops.object.select_all(action='DESELECT')
for root, objs, colour, normal in plan:
    root.select_set(True)
    for c in root.children_recursive:
        c.select_set(c.type in ('MESH', 'EMPTY'))
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True, export_apply=True,
    export_image_format='JPEG', export_image_quality=88, export_yup=True,
    export_lights=False, export_cameras=False, export_tangents=False,
    export_attributes=False, export_extras=False,
)
for root, objs, colour, normal in plan:
    for im in (colour, normal):
        im.filepath_raw = os.path.join(os.path.dirname(out), im.name + '.png')
        im.file_format = 'PNG'
        im.save()
print('exported', out, os.path.getsize(out), flush=True)
