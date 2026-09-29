export type TaskStatus = "pending" | "running" | "done" | "failed";

export interface Task {
  id: string;
  trip_id: string;
  kind: string;
  status: TaskStatus;
  progress?: string | null;
  error?: string | null;
  result_path?: string | null;
}

export interface Candidate {
  name: string;
  uid?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface Place {
  id: number;
  day: number;
  seq: number;
  name: string;
  type: string;
  source_text?: string | null;
  confirmed: boolean;
  skipped: boolean;
  poi_name?: string | null;
  poi_uid?: string | null;
  poi_address?: string | null;
  lat?: number | null;
  lng?: number | null;
  geocode_status: string;
  candidates?: Candidate[] | null;
}

export interface Trip {
  id: string;
  source_link: string;
  note_id?: string | null;
  title?: string | null;
  city?: string | null;
  status: string;
  created_at?: string | null;
}

export interface PlacesResponse {
  trip_id: string;
  status: string;
  title?: string | null;
  city?: string | null;
  places: Place[];
}

export interface RouteSegment {
  from_place: string;
  to_place: string;
  mode: string;
  distance_m: number;
  duration_s: number;
  duration_text: string;
}

export interface RouteDay {
  day: number;
  places: Place[];
  segments: RouteSegment[];
  map_url: string;
}

export interface RouteResponse {
  trip_id: string;
  days: RouteDay[];
}
