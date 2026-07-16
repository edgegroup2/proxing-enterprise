import routeManifest from "../generated/routeManifest.json";

export type GeneratedRouteItem = {
  method: string;
  localPath?: string;
  fullPath: string;
  file?: string;
  mountBase?: string;
};

export const GENERATED_ROUTE_LIST: GeneratedRouteItem[] =
  (routeManifest as GeneratedRouteItem[]) || [];

export function hasGeneratedRoute(method: string, fullPath: string): boolean {
  return GENERATED_ROUTE_LIST.some(
    (route) =>
      route.method.toUpperCase() === method.toUpperCase() &&
      route.fullPath === fullPath
  );
}
