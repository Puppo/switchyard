import * as THREE from "three";
import type { BranchId, TrackId } from "../engine/types.js";

export const BERTH_POSITIONS: Record<TrackId, THREE.Vector3> = {
  entry: new THREE.Vector3(-9.5, 0, 0),
  shared: new THREE.Vector3(-1.8, 0, 0),
  "regional-exit": new THREE.Vector3(9.2, 0, 0),
  "platform-a": new THREE.Vector3(10.0, 0, -5.5),
  "platform-b": new THREE.Vector3(10.0, 0, 5.5),
};

export const SWITCH_ORIGIN = new THREE.Vector3(1.5, 0, 0);

export const TRACK_WAYPOINTS: Record<TrackId, readonly THREE.Vector3[]> = {
  entry: [new THREE.Vector3(-13.2, 0, 0), new THREE.Vector3(-5.0, 0, 0)],
  shared: [new THREE.Vector3(-5.0, 0, 0), new THREE.Vector3(1.5, 0, 0)],
  "regional-exit": [
    new THREE.Vector3(1.5, 0, 0),
    new THREE.Vector3(7.0, 0, 0),
    new THREE.Vector3(13.2, 0, 0),
  ],
  "platform-a": [
    new THREE.Vector3(1.5, 0, 0),
    new THREE.Vector3(4.3, 0, -1.0),
    new THREE.Vector3(7.2, 0, -4.3),
    new THREE.Vector3(10.0, 0, -5.5),
    new THREE.Vector3(13.2, 0, -5.5),
  ],
  "platform-b": [
    new THREE.Vector3(1.5, 0, 0),
    new THREE.Vector3(4.3, 0, 1.0),
    new THREE.Vector3(7.2, 0, 4.3),
    new THREE.Vector3(10.0, 0, 5.5),
    new THREE.Vector3(13.2, 0, 5.5),
  ],
};

export const SWITCH_BRANCH_ANGLES: Record<BranchId, number> = {
  "regional-exit": 0,
  "platform-a": Math.PI * 0.24,
  "platform-b": -Math.PI * 0.24,
};

/**
 * Builds a continuous spline from the origin train's exact berth to the
 * destination track's exact berth so animation start/end match static rests.
 */
export function buildRouteSpline(
  route: readonly TrackId[],
): THREE.CatmullRomCurve3 {
  const from = route[0];
  const to = route[route.length - 1];
  const points: THREE.Vector3[] = [BERTH_POSITIONS[from].clone()];

  const isReverseToEntry = to === "entry";

  if (!isReverseToEntry) {
    if (from === "entry") {
      points.push(new THREE.Vector3(-5.0, 0, 0));
    }
    points.push(SWITCH_ORIGIN.clone());
    if (to === "platform-a") {
      points.push(new THREE.Vector3(4.3, 0, -1.0));
      points.push(new THREE.Vector3(7.2, 0, -4.3));
    } else if (to === "platform-b") {
      points.push(new THREE.Vector3(4.3, 0, 1.0));
      points.push(new THREE.Vector3(7.2, 0, 4.3));
    } else if (to === "regional-exit") {
      points.push(new THREE.Vector3(5.6, 0, 0));
    }
  } else {
    if (from === "platform-a") {
      points.push(new THREE.Vector3(7.2, 0, -4.3));
      points.push(new THREE.Vector3(4.3, 0, -1.0));
    } else if (from === "platform-b") {
      points.push(new THREE.Vector3(7.2, 0, 4.3));
      points.push(new THREE.Vector3(4.3, 0, 1.0));
    } else if (from === "regional-exit") {
      points.push(new THREE.Vector3(5.6, 0, 0));
    }
    points.push(SWITCH_ORIGIN.clone());
    points.push(new THREE.Vector3(-5.0, 0, 0));
  }

  points.push(BERTH_POSITIONS[to].clone());

  return new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.25);
}

export function buildTrackCurve(trackId: TrackId): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(
    TRACK_WAYPOINTS[trackId].map((pt) => pt.clone()),
    false,
    "catmullrom",
    0.25,
  );
}
