function normalizeHashRoute() {
  const hash = window.location.hash || "#/";
  const route = hash.startsWith("#") ? hash.slice(1) : hash; // "/dashboards"
  return route.length ? route : "/";
}

export class Router {
  constructor({ outletEl, routes, onRouteChanged }) {
    this.outletEl = outletEl;
    this.routes = routes; // { "/dashboards": async()=>HTMLElement, "/404": ... }
    this.onRouteChanged = onRouteChanged;
    this._bound = () => this.render();
  }

  start() {
    window.addEventListener("hashchange", this._bound);
    this.render();
  }

  stop() {
    window.removeEventListener("hashchange", this._bound);
  }

  async render() {
    const route = normalizeHashRoute();
    const loader = this.routes[route] || this.routes["/404"];
    const viewEl = await loader({ route });

    this.outletEl.replaceChildren(viewEl);
    this.outletEl.focus?.();

    this.onRouteChanged?.(route);
  }
}