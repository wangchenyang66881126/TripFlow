import BMapLoader from "@baidumap/jsapi-loader";
import { BAIDU_MAP_SERVICE } from "./config";

export interface MapPoint { lng: number; lat: number }
export interface MapLabel {
  setStyle: (style: Record<string, string>) => void;
  addEventListener: (event: string, callback: () => void) => void;
}
export interface BaiduMap {
  centerAndZoom: (point: MapPoint, zoom: number) => void;
  enableScrollWheelZoom: (enabled: boolean) => void;
  addOverlay: (overlay: unknown) => void;
  clearOverlays: () => void;
  setViewport: (points: MapPoint[], options?: Record<string, unknown>) => void;
  openInfoWindow: (window: unknown, point: MapPoint) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  checkResize?: () => void;
  destroy?: () => void;
}
export interface MapApi {
  Map: new (element: HTMLElement) => BaiduMap;
  Point: new (lng: number, lat: number) => MapPoint;
  Polyline: new (points: MapPoint[], options: Record<string, unknown>) => unknown;
  Label: new (text: string, options: Record<string, unknown>) => MapLabel;
  InfoWindow: new (text: string, options?: Record<string, unknown>) => unknown;
  Size: new (width: number, height: number) => unknown;
}

export function loadBaiduMap(): Promise<MapApi> {
  // 官方加载器共享一个 Promise；两天路线和侧栏可以各自创建独立地图。
  return BMapLoader.load({
    version: "gl",
    serviceHost: new URL(BAIDU_MAP_SERVICE, window.location.origin).href,
    timeout: 25000,
  });
}
