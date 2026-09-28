import type { Express, Router } from "express";

// Express 5 does not expose a mounted router's prefix, so mount() records it.
const prefixes = new Map<unknown, string>();

export function mount(app: Express, prefix: string, router: Router) {
  prefixes.set(router, prefix);
  app.use(prefix, router);
}

type Layer = { route?: { path: string; methods: Record<string, boolean> }; name?: string; handle: unknown };

// Every live route, read from Express itself, so a route that skipped secureRoute() still shows up.
// Same format as routeOf() and the audit log's source.route ("DELETE /invoices/:id"),
// minus the trailing slash on a router's root route ("POST /invoices", not "POST /invoices/").
export function routeInventory(app: Express): string[] {
  const out: string[] = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        const path = prefix && layer.route.path === "/" ? prefix : prefix + layer.route.path;
        for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${path}`);
      } else if (layer.name === "router") {
        const p = prefixes.get(layer.handle);
        if (p === undefined) throw new Error("router mounted without mount(); its routes cannot be inventoried");
        walk((layer.handle as { stack: Layer[] }).stack, prefix + p);
      }
    }
  };
  walk((app as unknown as { router: { stack: Layer[] } }).router.stack, "");
  return out.sort();
}
