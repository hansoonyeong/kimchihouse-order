/** productId → new catalog unit price */
export const WALKERHILL_SET_NEW_PRICES = {
  w_set3a: 200,
  w_set3b: 185,
  w_set3c: 170,
  w_set3d: 155,
  w_set5a: 335,
  w_set5b: 305,
  w_set5c: 290,
  w_set5d: 260,
};

/** @deprecated legacy map kept for reference */
export const WALKERHILL_SET_PRICE_FIX = {
  w_set3a: { old: 195, new: 200 },
  w_set3b: { old: 180, new: 185 },
  w_set3c: { old: 165, new: 170 },
  w_set3d: { old: 150, new: 155 },
  w_set5a: { old: 320, new: 335 },
  w_set5b: { old: 295, new: 305 },
  w_set5c: { old: 280, new: 290 },
  w_set5d: { old: 250, new: 260 },
};

function itemProductId(item) {
  return String(item?.productId || item?.id || "").trim();
}

export function fixOrderSetPrices(order) {
  const changes = [];
  if (!Array.isArray(order?.items) || !order.items.length) {
    return { order, changed: false, changes };
  }

  let any = false;
  const nextItems = order.items.map((item) => {
    const pid = itemProductId(item);
    const newUnit = WALKERHILL_SET_NEW_PRICES[pid];
    if (!newUnit) return item;

    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    const linePrice = Number(item.price) || 0;
    const expectedNew = newUnit * qty;

    if (linePrice === expectedNew) return item;

    any = true;
    changes.push({
      orderId: order.id,
      productId: pid,
      name: item.name,
      qty,
      from: linePrice,
      to: expectedNew,
    });
    return { ...item, qty, price: expectedNew };
  });

  if (!any) return { order, changed: false, changes };

  const subtotal = nextItems.reduce((sum, it) => sum + (Number(it.price) || 0), 0);
  const shippingFee = Number(order.shippingFee) || 0;

  return {
    order: {
      ...order,
      items: nextItems,
      subtotal,
      total: subtotal + shippingFee,
      priceMigratedAt: new Date().toISOString(),
      priceMigrationNote: "walkerhill-set-3-5-price-fix",
    },
    changed: true,
    changes,
  };
}

export function migrateOrdersSetPrices(orders) {
  const allChanges = [];
  const nextOrders = orders.map((o) => {
    const { order, changed, changes } = fixOrderSetPrices(o);
    if (changed) allChanges.push(...changes);
    return order;
  });
  const orderIds = new Set(allChanges.map((c) => c.orderId));
  return {
    orders: nextOrders,
    updatedOrders: orderIds.size,
    itemChanges: allChanges.length,
    changes: allChanges,
  };
}
