/** CSV export helpers for routes. */
(function (global) {
  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function downloadText(filename, text, mime = "text/csv;charset=utf-8") {
    const blob = new Blob(["\uFEFF" + text], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportRoutesCsv(ordersById, routes, deliveryDate) {
    const header = [
      "Route",
      "Stop Number",
      "Customer Name",
      "Phone",
      "Address",
      "Suburb",
      "Postcode",
      "Order",
      "Total",
      "Box Count",
      "Delivery Notes",
      "Order ID",
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const route of routes) {
      route.stopIds.forEach((id, idx) => {
        const o = ordersById.get(id);
        if (!o) return;
        lines.push(
          [
            route.name,
            idx + 1,
            o.name,
            o.phone,
            o.address,
            o.suburb,
            o.postcode,
            String(o.orderSummary || "").replace(/\n/g, " / "),
            o.total,
            o.boxCount,
            o.notes,
            o.id,
          ]
            .map(csvCell)
            .join(",")
        );
      });
    }
    const date = deliveryDate || "undated";
    downloadText(`KimchiHouse_Routes_${date}.csv`, lines.join("\n"));
  }

  function exportSingleRouteCsv(ordersById, route, deliveryDate) {
    exportRoutesCsv(ordersById, [route], `${deliveryDate || "undated"}_${route.name.replace(/\s+/g, "_")}`);
  }

  global.KHRouteExport = {
    exportRoutesCsv,
    exportSingleRouteCsv,
    downloadText,
  };
})(typeof window !== "undefined" ? window : globalThis);
