// PLACEHOLDER district — replaced by the district builder.
import { makeMushroomHouse, makeSign } from '../props/index.js';
import { palette } from '../core/palette.js';

export default async function build(ctx, site) {
  const house = makeMushroomHouse({ capColor: palette.capTeal, height: 6, capRadius: 3.6, seed: site.id });
  house.position.set(0, 0, -3);
  site.group.add(house);
  site.addCollider(0, -3, house.userData.radius);
  site.addHotspot(house, { entryId: 'this-portfolio', label: site.title });
  const sign = makeSign({ text: site.title, width: 2.4 });
  sign.position.set(-2.6, 0, site.radius - 3);
  site.group.add(sign);
  return {};
}
