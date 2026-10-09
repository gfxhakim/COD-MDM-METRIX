import { wilayaName } from "@/domain/wilayas";
import { db } from "@/server/db";

/**
 * Renames wilayas stored before every wilaya had one Arabic name (French from Shopify exports,
 * Arabic from MDM, both mixed) to that name. It reads each distinct stored name once, so it is
 * cheap enough to run on every sync and every server start; with nothing to rename it writes nothing.
 */
export async function tidyWilayas(workspaceId?: string) {
  const scope = workspaceId ? { workspaceId } : {};
  const [orders, parcels] = await Promise.all([
    db.order.groupBy({ by: ["wilaya"], where: { ...scope, wilaya: { not: null } } }),
    db.parcel.groupBy({ by: ["wilaya"], where: { ...scope, wilaya: { not: null } } }),
  ]);
  let renamed = 0;
  for (const { wilaya } of orders) {
    const name = wilayaName(wilaya);
    if (wilaya && name !== wilaya) renamed += (await db.order.updateMany({ where: { ...scope, wilaya }, data: { wilaya: name } })).count;
  }
  for (const { wilaya } of parcels) {
    const name = wilayaName(wilaya);
    if (wilaya && name !== wilaya) renamed += (await db.parcel.updateMany({ where: { ...scope, wilaya }, data: { wilaya: name } })).count;
  }
  return renamed;
}
