# 09: Prop Model Files

Every prop in the game is built in code: a level is a list of boxes, and a box tagged with a `model` (`sofa`, `table`, `bookshelf`…) is drawn as that piece of furniture, fitted to the box (`client/src/render/props.ts`). Players collide with the box, never with the model.

Props can also be saved as, and drawn from, standard model files: glTF binary (`.glb`), which Blender and most other modelling tools open and save.

## Saving a model

Run the game from source (`npm run dev`) and open the model gallery at `http://localhost:5173/models.html`. Pick a model from the list at the top and press **Save .glb**. Any model in the gallery can be saved: props, players, gear, the dog, bricks.

A saved prop is in its own frame, ready to be named by a box again:

- Units are metres.
- The origin is the middle of the bottom of the prop's box (other models: their lowest point, under their own origin).
- Its front faces +z, as glTF models do. The game's props face -z, so files are turned round on the way in and out.
- Colours are plain PBR materials (colour, roughness, metalness). The game's visual styles add their textures in the shader, so there are no texture files.
- A sofa seat and its backrest are two boxes, so they are two files. Hiding places (seat cushions, drawers, doors) are drawn separately, and are not in the file of the prop around them.

## Using a file in a level

1. Put the file in `client/src/assets/props/`, for example `couch.glb`.
2. Name it on the box with `asset`, by its file name without `.glb`:

   ```ts
   {
     pos: { x: 0, y: 0.225, z: 14.3 },
     size: { x: 3, y: 0.45, z: 0.9 },
     colour: SOFA,
     model: 'sofa',
     asset: 'couch',
   },
   ```

The game loads every file in that folder when it starts, and draws a box that names one with the file instead of its coded model: at the file's own size, its origin on the middle of the box's bottom and its front towards the box's `front`. The box still needs its `model`: it is drawn as that model if the file is missing (the console says so), and the rest of the game still treats it as that kind of furniture. Ramps keep their coded model.

A file is not stretched to its box, so a model made for a box should be that box's size. The box is what players bump into, whatever the file looks like.

## Trying a file before using it

In the gallery, show the prop the file is for and press **Open .glb…**: the file is drawn in its place, exactly as the game would draw it, with whatever stands around it. **Show coded model** goes back. Opened over a model that is not a level prop (a player, a brick), the file is shown on its own at its own size.

## Limits

- Coded props adapt to their box and level: the sofa leaves gaps for hiding-place cushions, bookshelves fill with books from a seed. A file is the same every time.
- Parts that move (doors, drawers, the electrical panel's light) are animated in code by name, so a file's parts do not move.
- Files are drawn like any prop: a plain-coloured mesh is baked in with the rest of the level, a textured one is kept separate (one draw call each).
