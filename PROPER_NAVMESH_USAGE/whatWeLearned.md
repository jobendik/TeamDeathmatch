# What We Learned

This document explains what went wrong, why it was so frustrating, and what finally made the navmesh integration work.

It is written as a practical retrospective, not as theory.

---

## 1. The Original Mistake: Treating Navmesh as Just a Route Generator

At the beginning, the main idea was:

- generate navmesh
- call `findPath()`
- move the agent toward the path points

That is **not enough** in YUKA.

The crucial lesson was that the navmesh is not only for pathfinding. It is also part of the actual runtime movement model.

The correct pattern is:

- store `currentRegion`
- store `previousPosition`
- store `currentPosition`
- move normally
- clamp back to navmesh every frame
- correct height from the region plane

That changed everything.

---

## 2. We Lost a Huge Amount of Time Because the Problem Looked Like One Thing but Was Actually Several Different Problems

The navigation struggle was not caused by a single bug.

It was a stack of different problems:

1. bad exports
2. invalid GLB output
3. disconnected navmesh islands
4. wrong runtime integration
5. testing tools that were not following the real YUKA showcase pattern
6. confusion between “navmesh exists” and “runtime movement is correct”

That is why it felt chaotic.

---

## 3. Some Early Navmesh Files Were Simply Wrong

At one point the exported navmesh was obviously broken:
- the GLB was tiny
- the loader failed
- the viewer complained about typed array length errors

That was not a pathfinding issue.
That was a file integrity issue.

A navmesh that does not even load correctly is not a navmesh problem in the gameplay sense. It is an asset/export problem.

This was an important distinction.

---

## 4. The Blender-Generated Scripted Navmeshes Looked Logical but Were a Poor Fit for YUKA

A big amount of effort went into custom Blender scripts that tried to generate a YUKA-friendly navmesh from rectangles, ramps, cuts, adaptive cells, and merged regions.

Some of these attempts were clever.
Some even produced plausible geometry.

But the results still failed in practice.

Why?

Because YUKA is extremely sensitive to the exact topology of the navmesh:
- shared edges must really be shared
- disconnected islands matter
- weird triangulation patterns matter
- “looks connected” is not the same as “is connected in the graph”

So even when the generated mesh looked sensible, it could still behave badly in YUKA.

This was a painful lesson.

---

## 5. The Testers Helped, But They Also Misled Us at Times

The test apps were useful because they exposed real symptoms:
- too many islands
- no movement
- click targets failing
- weird path behavior
- agent walking through walls
- movement oscillation

But some of the early diagnostics were misleading:
- some graph-node checks were not trustworthy
- some failure messages made it look like the navmesh itself was completely invalid when the real problem was runtime usage
- some click-to-move test versions were too simple compared to the actual YUKA showcase

So the testers were necessary, but not always sufficient.

Eventually the key insight was:
**the test app itself also needed to follow the YUKA showcase pattern more closely.**

---

## 6. Recast Editor Was a Better Path Than Hand-Building the Final Navmesh

Eventually the browser Recast editor turned out to be more productive than trying to hand-author the final YUKA navmesh through custom Blender scripts.

That was a major turning point.

The important working Recast-style settings ended up being conservative:
- larger cell size
- reasonable walkable radius
- moderate climb
- small islands filtered out
- very low simplification error
- triangle-friendly output

That likely helped because:
- fewer tiny details survived
- fewer disconnected garbage regions survived
- the mesh became more stable for YUKA runtime use

It did not make everything perfect, but it got the navmesh into the zone where runtime integration could finally succeed.

---

## 7. One of the Biggest Real Problems Was Disconnected Islands

This showed up repeatedly.

The navmesh could look good overall, but still include:
- tops of cover objects
- tops of walls
- little isolated platforms
- tiny unreachable walkable surfaces

These caused major confusion:
- smoke tests failed
- click-to-move failed
- the agent spawned on bad components
- some targets were unreachable even though they looked valid

Eventually the correct idea was:
- care about the **main connected component**
- reject or ignore islands for testing and runtime where appropriate
- prefer spawn points on the main walkable floor region

This cleaned up a lot of false alarms.

---

## 8. The Breakthrough Was Not Just the Navmesh Itself. It Was Understanding the YUKA Showcase Runtime Pattern

This was the real turning point.

Once the official YUKA FPS showcase code was examined carefully, the correct approach became much clearer.

The showcase does **not** simply:
- find a path
- move toward the points

Instead, it does all of this:

- load navmesh separately
- keep `currentRegion`
- keep `previousPosition`
- keep `currentPosition`
- use `FollowPathBehavior`
- use `OnPathBehavior`
- update these through goals/path planner
- clamp movement every frame
- correct height from the current region plane

That is the pattern that finally made things work.

This was the key missing piece for a long time.

---

## 9. `FollowPathBehavior` Alone Was Not the Full Answer

Another important discovery was that the YUKA showcase does not rely on `FollowPathBehavior` alone.

It also uses `OnPathBehavior`.

That matters because:
- `FollowPathBehavior` gets the bot moving waypoint to waypoint
- `OnPathBehavior` helps keep the bot inside the path corridor

Without that combination, movement can feel messy:
- overshooting
- drifting
- zigzagging
- wobbling around corners

This explains why some earlier prototypes “sort of worked” but looked bad.

---

## 10. `clampMovement()` Was the Missing Runtime Constraint

This was the single biggest runtime detail.

Without `clampMovement()` every frame:
- the bot can drift
- the bot can deviate from the mesh
- path following can become visually unstable
- corners and edges behave worse
- the navmesh becomes only advisory, not authoritative

With `clampMovement()` every frame:
- the bot stays inside the walkable space
- the current region stays meaningful
- movement becomes much more robust

This was one of the biggest “why didn’t we do that from the start?” moments.

---

## 11. Height Correction From `currentRegion.plane` Was Also Essential

Even when pathfinding worked, height could look wrong:
- floating slightly
- clipping through slopes
- moving to the right XY location but wrong Y

The YUKA showcase handles this by measuring distance to the current region’s plane and correcting the entity height gradually.

That smoothing step matters.
It turns raw navmesh position into believable grounded movement.

---

## 12. The Working Test App Needed to Look Much More Like the Showcase

Eventually a showcase-style test app was created.

That version worked because it finally copied the real YUKA runtime pattern:

- `currentRegion`
- `previousPosition`
- `currentPosition`
- `FollowPathBehavior`
- `OnPathBehavior`
- `clampMovement()` every frame
- plane height correction
- click-to-move on the main component

At that point the agent finally found its way properly.

That was the moment where the problem changed from:
- “Why is nothing working?”

to:
- “Okay, this is working. Now how do we polish it?”

That is a very important transition.

---

## 13. What Still Was Not Perfect Even After It Worked

Even after the big breakthrough, a few imperfections remained:
- some disconnected islands still existed
- movement could still wiggle or over-correct in places
- the path might be slightly noisier than ideal
- the navmesh could still be cleaned further in Blender if desired

But those were **polishing problems**, not foundational problems.

That is a completely different category.

---

## 14. The Final Understanding

The final understanding is this:

### A working YUKA navmesh solution needs all of these together:
1. a valid navmesh asset
2. a mostly clean main connected component
3. pathfinding with `findPath()`
4. `FollowPathBehavior`
5. `OnPathBehavior`
6. `currentRegion`
7. `previousPosition`
8. `currentPosition`
9. `clampMovement()` every frame
10. height correction from `currentRegion.plane`

If even one of the major runtime pieces is missing, the result can look broken even when the navmesh itself is fine.

---

## 15. What Was Probably the Most Important Fix of All

If one single thing has to be named, it is this:

**We finally stopped treating navmesh as only a planning tool and started treating it as a runtime movement surface.**

That is the deep fix.

Everything else supported that:
- better export
- better recast settings
- filtering islands
- better testers
- reading the showcase properly

But that runtime mindset was the true breakthrough.

---

## 16. Practical Recommendations Going Forward

### Freeze the working navmesh
Keep the version that works.
Do not overwrite it casually.

### Keep the showcase-style runtime pattern
Do not simplify it away later.

### Clean islands only as a refinement
Do not rebuild everything again unless necessary.

### Prefer improving path-follow polish next
The next improvements should be:
- path smoothing
- arrival tuning
- cleaner click validation
- cleaner spawn validation
- removal of useless islands

---

## 17. Final Summary

What made the system finally work was not a magic export or a single setting.

It was the combination of:
- getting a navmesh that YUKA could actually use
- recognizing disconnected islands as a real issue
- switching to a more reliable navmesh generation workflow
- reading the official YUKA showcase code carefully
- copying the real runtime pattern:
  - `findPath()`
  - `FollowPathBehavior`
  - `OnPathBehavior`
  - `clampMovement()`
  - plane-based height correction

That is the complete lesson.
