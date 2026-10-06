// ─────────────────────────────────────────────────────────────────────────────
// Transport — the Schneckenpost (snail post). A yellow-saddled riding snail
// waits at every station; click one to pick a destination and ride there.
// BASELINE: teleports. The systems builder turns this into real rides along
// the paths (rider mounted on the snail, camera following, PostAuto horn).
//
//   ctx.transport.travelTo(areaId)   → Promise resolved on arrival
//   ctx.transport.stations           → [{ areaId, x, z, snail }]
// ─────────────────────────────────────────────────────────────────────────────
import { AREAS, PLAZA } from '../world/layout.js';
import { getHeight } from '../world/ground.js';

export function createTransport(ctx) {
  const stations = [];
  for (const area of AREAS) {
    const pos = area.station ?? PLAZA.station;
    const snail = ctx.props.makeSnail({ post: true, saddle: true, seed: `post-${area.id}` });
    snail.group.position.set(pos.x, getHeight(pos.x, pos.z), pos.z);
    // face along the path towards the plaza (or outwards for the plaza stop)
    snail.group.rotation.y = area.id === 'plaza' ? Math.atan2(pos.x, pos.z) : area.facing;
    ctx.scene.add(snail.group);
    ctx.colliders.addCircle(pos.x, pos.z, 1.0, 'station');
    const station = { areaId: area.id, x: pos.x, z: pos.z, snail };
    stations.push(station);
    ctx.interactions.add(snail.group, {
      label: 'Schneckenpost — ride a snail',
      area: area.id,
      onActivate: () => ctx.ui?.showDestinations?.(area.id),
    });
    ctx.engine.addUpdate((dt) => snail.update(dt), 20);
  }

  const transport = {
    stations,
    busy: false,
    async travelTo(areaId) {
      const dest = stations.find((s) => s.areaId === areaId);
      if (!dest || transport.busy) return;
      const area = AREAS.find((a) => a.id === areaId);
      // stand a little in front of the destination snail, towards the clearing centre
      const dx = area.center.x - dest.x, dz = area.center.z - dest.z;
      const l = Math.hypot(dx, dz) || 1;
      ctx.player.teleport(dest.x + (dx / l) * 2, dest.z + (dz / l) * 2, Math.atan2(dx, dz));
      ctx.cameraRig.snap();
    },
  };
  return transport;
}
