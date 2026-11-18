import * as THREE from "three";
import type {
  AnnotatableEntityId,
  BranchId,
  PlatformId,
  TrackId,
  TrainId,
} from "../engine/types.js";
import { BERTH_POSITIONS, buildTrackCurve, SWITCH_ORIGIN } from "./paths.js";

export interface PickUserData {
  readonly pickType: "entity" | "barrier";
  readonly entityId: AnnotatableEntityId | "platform-b";
  readonly hoverLabel: string;
}

export interface TrackVisual {
  readonly stripMaterial: THREE.MeshStandardMaterial;
  readonly pinAnchor: THREE.Group;
  readonly barrierPivot?: THREE.Group;
  readonly barrierLampMaterial?: THREE.MeshStandardMaterial;
}

export interface TrainVisual {
  readonly group: THREE.Group;
  readonly selectionRing: THREE.Mesh;
  readonly pinAnchor: THREE.Group;
}

export interface SwitchVisual {
  readonly bladePivot: THREE.Group;
  readonly vanePivot: THREE.Group;
  readonly lockLampMaterial: THREE.MeshStandardMaterial;
  readonly pinAnchor: THREE.Group;
}

export interface PlatformVisual {
  readonly pinAnchor: THREE.Group;
}

export function buildBoardBase(): THREE.Group {
  const group = new THREE.Group();

  // Walnut-stained wooden diorama baseboard plinth
  const plinth = new THREE.Mesh(
    new THREE.BoxGeometry(30.8, 0.96, 19.6),
    new THREE.MeshStandardMaterial({
      color: 0x3b281c,
      roughness: 0.68,
      metalness: 0.08,
    }),
  );
  plinth.position.y = -0.56;
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  group.add(plinth);

  // Brass corner trim accents
  const brassMat = new THREE.MeshStandardMaterial({
    color: 0xb45309,
    metalness: 0.72,
    roughness: 0.32,
  });
  const trim = new THREE.Mesh(
    new THREE.BoxGeometry(30.9, 0.06, 19.7),
    brassMat,
  );
  trim.position.y = -0.11;
  group.add(trim);

  // Natural mossy meadow terrain mat
  const turf = new THREE.Mesh(
    new THREE.BoxGeometry(29.8, 0.2, 18.8),
    new THREE.MeshStandardMaterial({
      color: 0x526b48,
      roughness: 0.95,
      metalness: 0.02,
    }),
  );
  turf.position.y = -0.1;
  turf.receiveShadow = true;
  group.add(turf);

  // Crushed-stone yard gravel apron
  const ballastApron = new THREE.Mesh(
    new THREE.BoxGeometry(28.0, 0.03, 14.6),
    new THREE.MeshStandardMaterial({
      color: 0x6b655c,
      roughness: 0.97,
      metalness: 0.02,
    }),
  );
  ballastApron.position.y = 0.005;
  ballastApron.receiveShadow = true;
  group.add(ballastApron);

  return group;
}

export function buildTrackSegmentVisual(
  trackId: TrackId,
  colliders: THREE.Object3D[],
): {
  group: THREE.Group;
  visual: TrackVisual;
} {
  const group = new THREE.Group();
  const curve = buildTrackCurve(trackId);
  const length = curve.getLength();
  const sleeperCount = Math.max(10, Math.round(length * 2.2));

  // Raised gravel roadbed embankment under each track
  const roadbed = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 36, 0.62, 6, false),
    new THREE.MeshStandardMaterial({
      color: 0x57534e,
      roughness: 0.96,
    }),
  );
  roadbed.scale.set(1, 0.09, 1);
  roadbed.position.y = 0.02;
  roadbed.receiveShadow = true;
  group.add(roadbed);

  const sleeperGeo = new THREE.BoxGeometry(0.16, 0.055, 0.96);
  const sleeperMat = new THREE.MeshStandardMaterial({
    color: 0x453224,
    roughness: 0.88,
  });

  const up = new THREE.Vector3(0, 1, 0);
  const leftPoints: THREE.Vector3[] = [];
  const rightPoints: THREE.Vector3[] = [];
  const stripPoints: THREE.Vector3[] = [];
  const railGaugeHalf = 0.28;

  for (let i = 0; i <= sleeperCount; i += 1) {
    const t = i / sleeperCount;
    const pos = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).setY(0).normalize();
    const normal = new THREE.Vector3().crossVectors(up, tangent).normalize();

    if (i < sleeperCount) {
      const sleeper = new THREE.Mesh(sleeperGeo, sleeperMat);
      sleeper.position.copy(pos).setY(0.055);
      sleeper.quaternion.setFromUnitVectors(
        new THREE.Vector3(1, 0, 0),
        tangent,
      );
      sleeper.receiveShadow = true;
      sleeper.castShadow = true;
      group.add(sleeper);
    }

    leftPoints.push(
      pos.clone().addScaledVector(normal, railGaugeHalf).setY(0.115),
    );
    rightPoints.push(
      pos.clone().addScaledVector(normal, -railGaugeHalf).setY(0.115),
    );
    stripPoints.push(pos.clone().setY(0.045));
  }

  const railMat = new THREE.MeshStandardMaterial({
    color: 0xdbe2ea,
    roughness: 0.28,
    metalness: 0.88,
  });

  const leftRail = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(leftPoints),
      36,
      0.036,
      6,
      false,
    ),
    railMat,
  );
  const rightRail = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(rightPoints),
      36,
      0.036,
      6,
      false,
    ),
    railMat,
  );
  leftRail.castShadow = true;
  rightRail.castShadow = true;
  group.add(leftRail, rightRail);

  const stripMaterial = new THREE.MeshStandardMaterial({
    color: 0x334155,
    emissive: 0x000000,
    roughness: 0.8,
  });
  const stripMesh = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(stripPoints),
      36,
      0.14,
      6,
      false,
    ),
    stripMaterial,
  );
  stripMesh.scale.set(1, 0.22, 1);
  group.add(stripMesh);

  // Pin anchor above track midpoint for non-platform track annotations
  const pinAnchor = new THREE.Group();
  pinAnchor.position.copy(BERTH_POSITIONS[trackId]).setY(0.75);
  group.add(pinAnchor);

  // Track click collider for entry, shared, and regional-exit
  if (
    trackId === "entry" ||
    trackId === "shared" ||
    trackId === "regional-exit"
  ) {
    const hoverLabels: Record<"entry" | "shared" | "regional-exit", string> = {
      entry: "West Entry Track (entry)",
      shared: "Shared Throat (shared)",
      "regional-exit": "Regional Exit Track (regional-exit)",
    };
    const center =
      trackId === "entry"
        ? new THREE.Vector3(-9.2, 0.35, 0)
        : trackId === "shared"
          ? new THREE.Vector3(-1.8, 0.35, 0)
          : new THREE.Vector3(7.5, 0.35, 0);
    const width = trackId === "regional-exit" ? 10.2 : 6.4;
    const trackCollider = createPickCollider(width, 0.8, 1.7, center, {
      pickType: "entity",
      entityId: trackId,
      hoverLabel: `Pin ${hoverLabels[trackId]}`,
    });
    group.add(trackCollider);
    colliders.push(trackCollider);
  }

  let barrierPivot: THREE.Group | undefined;
  let barrierLampMaterial: THREE.MeshStandardMaterial | undefined;

  if (trackId === "platform-a" || trackId === "platform-b") {
    const signZ = trackId === "platform-a" ? -1 : 1;

    // Hydraulic buffer stop at dead-end of platform track
    const bufferStop = buildBufferStop();
    bufferStop.position.set(12.85, 0, signZ * 5.5);
    group.add(bufferStop);

    const barrierGroup = new THREE.Group();
    barrierGroup.position.set(6.4, 0, signZ * 3.55);

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.95, 10),
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.45,
        metalness: 0.4,
      }),
    );
    post.position.set(0, 0.47, signZ * 0.72);
    post.castShadow = true;
    barrierGroup.add(post);

    barrierLampMaterial = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x059669,
      emissiveIntensity: 0.75,
    });
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 12),
      barrierLampMaterial,
    );
    lamp.position.set(0, 1.0, signZ * 0.72);
    barrierGroup.add(lamp);

    barrierPivot = new THREE.Group();
    barrierPivot.position.set(0, 0.58, signZ * 0.72);
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.11, 1.6),
      new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.35 }),
    );
    arm.position.set(0, 0, -signZ * 0.78);
    arm.castShadow = true;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.09, 0.48),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35 }),
    );
    stripe.position.set(0, 0, -signZ * 0.78);
    barrierPivot.add(arm, stripe);
    barrierPivot.rotation.x = signZ * -1.25;
    barrierGroup.add(barrierPivot);

    if (trackId === "platform-b") {
      const gateCollider = createPickCollider(
        1.6,
        1.7,
        2.2,
        new THREE.Vector3(6.4, 0.85, 3.85),
        {
          pickType: "barrier",
          entityId: "platform-b",
          hoverLabel: "Toggle Branch B Closure Gate",
        },
      );
      group.add(gateCollider);
      colliders.push(gateCollider);
    }

    group.add(barrierGroup);
  }

  return {
    group,
    visual: {
      stripMaterial,
      pinAnchor,
      barrierPivot,
      barrierLampMaterial,
    },
  };
}

function buildBufferStop(): THREE.Group {
  const stop = new THREE.Group();
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.7,
    roughness: 0.35,
  });
  const redMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    roughness: 0.4,
  });

  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.88), redMat);
  beam.position.set(-0.08, 0.42, 0);
  beam.castShadow = true;

  for (const sz of [-0.28, 0.28]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.08, 0.09),
      steelMat,
    );
    leg.position.set(0.1, 0.24, sz);
    leg.rotation.z = -0.65;
    leg.castShadow = true;
    stop.add(leg);
  }
  stop.add(beam);
  return stop;
}

export function buildSwitchVisual(colliders: THREE.Object3D[]): {
  group: THREE.Group;
  visual: SwitchVisual;
} {
  const group = new THREE.Group();
  group.position.copy(SWITCH_ORIGIN);

  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.16, 1.32),
    new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.55,
      metalness: 0.4,
    }),
  );
  housing.position.set(0.25, 0.07, 0);
  housing.castShadow = true;
  group.add(housing);

  const bladePivot = new THREE.Group();
  bladePivot.position.set(0, 0.13, 0);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    metalness: 0.65,
    roughness: 0.3,
  });
  const bladeA = new THREE.Mesh(
    new THREE.BoxGeometry(1.42, 0.055, 0.065),
    bladeMat,
  );
  bladeA.position.set(0.7, 0, 0.24);
  const bladeB = new THREE.Mesh(
    new THREE.BoxGeometry(1.42, 0.055, 0.065),
    bladeMat,
  );
  bladeB.position.set(0.7, 0, -0.24);
  bladePivot.add(bladeA, bladeB);
  group.add(bladePivot);

  // Switch stand + rotating direction vane
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.13, 0.92, 10),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 }),
  );
  stand.position.set(-0.2, 0.46, 1.12);
  stand.castShadow = true;
  group.add(stand);

  const vanePivot = new THREE.Group();
  vanePivot.position.set(-0.2, 0.9, 1.12);
  const arrowShaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, 0.09, 0.16),
    new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0x9a3412,
      emissiveIntensity: 0.35,
    }),
  );
  arrowShaft.position.x = 0.22;
  vanePivot.add(arrowShaft);
  group.add(vanePivot);

  const lockLampMaterial = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 0.9,
  });
  const lockLamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 12),
    lockLampMaterial,
  );
  lockLamp.position.set(-0.2, 1.1, 1.12);
  group.add(lockLamp);

  const pinAnchor = new THREE.Group();
  pinAnchor.position.set(0.25, 1.45, 0.8);
  group.add(pinAnchor);

  const collider = createPickCollider(
    2.2,
    1.8,
    2.4,
    new THREE.Vector3(0.35, 0.9, 0.3),
    {
      pickType: "entity",
      entityId: "main-switch",
      hoverLabel: "Pin Main Switch (main-switch)",
    },
  );
  group.add(collider);
  colliders.push(collider);

  return {
    group,
    visual: { bladePivot, vanePivot, lockLampMaterial, pinAnchor },
  };
}

export function buildLandmarksAndPlatforms(colliders: THREE.Object3D[]): {
  group: THREE.Group;
  platforms: Record<PlatformId, PlatformVisual>;
} {
  const group = new THREE.Group();

  // Interlocking brick-and-timber signal box at West Entry
  group.add(buildSignalBox());

  // Steel truss outbound signal gantry at Regional Exit
  group.add(buildOutboundGantry());

  // Platform A (North-East, Water Tower)
  const platAGroup = buildPlatformDeck(-7.1, 0x38bdf8);
  const waterTower = buildWaterTower();
  waterTower.position.set(11.8, 0.4, -7.25);
  platAGroup.add(waterTower);

  const pinAnchorA = new THREE.Group();
  pinAnchorA.position.set(8.4, 0.92, -7.1);
  platAGroup.add(pinAnchorA);

  const colliderA = createPickCollider(
    6.4,
    3.9,
    4.3,
    new THREE.Vector3(10.0, 1.85, -6.5),
    {
      pickType: "entity",
      entityId: "platform-a",
      hoverLabel: "Pin Platform A · Water Tower",
    },
  );
  platAGroup.add(colliderA);
  colliders.push(colliderA);
  group.add(platAGroup);

  // Platform B (South-East, Station Canopy)
  const platBGroup = buildPlatformDeck(7.1, 0xf59e0b);
  const canopy = buildStationCanopy();
  canopy.position.set(10.4, 0.4, 7.15);
  platBGroup.add(canopy);

  const pinAnchorB = new THREE.Group();
  pinAnchorB.position.set(8.0, 0.92, 7.1);
  platBGroup.add(pinAnchorB);

  const colliderB = createPickCollider(
    6.4,
    3.9,
    4.3,
    new THREE.Vector3(10.0, 1.85, 6.5),
    {
      pickType: "entity",
      entityId: "platform-b",
      hoverLabel: "Pin Platform B · Station Canopy",
    },
  );
  platBGroup.add(colliderB);
  colliders.push(colliderB);
  group.add(platBGroup);

  return {
    group,
    platforms: {
      "platform-a": { pinAnchor: pinAnchorA },
      "platform-b": { pinAnchor: pinAnchorB },
    },
  };
}

function buildSignalBox(): THREE.Group {
  const box = new THREE.Group();
  box.position.set(-10.8, 0, -2.65);

  const brickMat = new THREE.MeshStandardMaterial({
    color: 0x8b3a2b,
    roughness: 0.85,
  });
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(2.15, 1.15, 1.55),
    brickMat,
  );
  base.position.y = 0.58;
  base.castShadow = true;
  base.receiveShadow = true;

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(2.05, 0.8, 1.48),
    new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.6 }),
  );
  cabin.position.y = 1.54;
  cabin.castShadow = true;

  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(1.75, 0.44, 1.51),
    new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.15,
      metalness: 0.65,
    }),
  );
  glass.position.y = 1.56;

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(1.68, 0.72, 4),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 }),
  );
  roof.position.y = 2.28;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;

  const chimney = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.55, 0.24),
    brickMat,
  );
  chimney.position.set(-0.55, 2.38, -0.3);
  chimney.castShadow = true;

  box.add(base, cabin, glass, roof, chimney);
  return box;
}

function buildOutboundGantry(): THREE.Group {
  const gantry = new THREE.Group();
  gantry.position.set(11.8, 0, 0);
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    metalness: 0.72,
    roughness: 0.34,
  });

  for (const pz of [-1.28, 1.28]) {
    const pillar = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 2.35, 0.2),
      steelMat,
    );
    pillar.position.set(0, 1.18, pz);
    pillar.castShadow = true;
    gantry.add(pillar);
  }

  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.26, 2.86),
    steelMat,
  );
  beam.position.set(0, 2.25, 0);
  beam.castShadow = true;

  const signalHousing = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.44, 0.24),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 }),
  );
  signalHousing.position.set(-0.18, 2.25, 0);

  const aspect = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0284c7,
      emissiveIntensity: 0.9,
    }),
  );
  aspect.position.set(-0.3, 2.32, 0);

  gantry.add(beam, signalHousing, aspect);
  return gantry;
}

function buildPlatformDeck(zCenter: number, stripeColor: number): THREE.Group {
  const group = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(5.8, 0.4, 2.2),
    new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.78 }),
  );
  deck.position.set(10.0, 0.2, zCenter);
  deck.receiveShadow = true;
  deck.castShadow = true;
  group.add(deck);

  const edgeSign = zCenter < 0 ? 1 : -1;
  const safetyStripe = new THREE.Mesh(
    new THREE.BoxGeometry(5.72, 0.04, 0.14),
    new THREE.MeshStandardMaterial({ color: stripeColor, roughness: 0.5 }),
  );
  safetyStripe.position.set(10.0, 0.41, zCenter + edgeSign * 0.96);
  group.add(safetyStripe);

  // Vintage platform lamp posts
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.65,
    roughness: 0.35,
  });
  const globeMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    emissive: 0xfde68a,
    emissiveIntensity: 0.85,
  });
  for (const lx of [7.9, 10.1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.055, 1.35, 8),
      postMat,
    );
    post.position.set(lx, 1.08, zCenter + edgeSign * 0.78);
    post.castShadow = true;
    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 10),
      globeMat,
    );
    globe.position.set(lx, 1.78, zCenter + edgeSign * 0.78);
    group.add(post, globe);
  }

  return group;
}

function buildWaterTower(): THREE.Group {
  const tower = new THREE.Group();
  const timberMat = new THREE.MeshStandardMaterial({
    color: 0x57534e,
    roughness: 0.72,
  });
  for (const [lx, lz] of [
    [-0.45, -0.45],
    [0.45, -0.45],
    [-0.45, 0.45],
    [0.45, 0.45],
  ]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 1.8, 8),
      timberMat,
    );
    leg.position.set(lx, 0.9, lz);
    leg.castShadow = true;
    tower.add(leg);
  }

  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.84, 0.84, 1.35, 20),
    new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.72 }),
  );
  tank.position.y = 2.45;
  tank.castShadow = true;
  tower.add(tank);

  const hoopMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.75,
    roughness: 0.35,
  });
  for (const hy of [2.05, 2.45, 2.85]) {
    const hoop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.86, 0.86, 0.055, 20),
      hoopMat,
    );
    hoop.position.y = hy;
    tower.add(hoop);
  }

  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(0.98, 0.68, 20),
    new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 }),
  );
  roof.position.y = 3.46;
  roof.castShadow = true;
  tower.add(roof);

  const spout = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 0.95, 8),
    timberMat,
  );
  spout.position.set(0, 1.95, 0.8);
  spout.rotation.x = Math.PI / 3;
  tower.add(spout);

  return tower;
}

function buildStationCanopy(): THREE.Group {
  const canopy = new THREE.Group();
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.68,
    roughness: 0.32,
  });

  for (const px of [-1.75, 0, 1.75]) {
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, 1.55, 8),
      steelMat,
    );
    col.position.set(px, 0.78, 0);
    col.castShadow = true;
    canopy.add(col);
  }

  const roofMat = new THREE.MeshStandardMaterial({
    color: 0xb45309,
    roughness: 0.52,
  });
  // Butterfly roof halves
  const roofNorth = new THREE.Mesh(
    new THREE.BoxGeometry(4.55, 0.09, 0.95),
    roofMat,
  );
  roofNorth.position.set(0, 1.66, -0.44);
  roofNorth.rotation.x = -0.14;
  roofNorth.castShadow = true;

  const roofSouth = new THREE.Mesh(
    new THREE.BoxGeometry(4.55, 0.09, 0.95),
    roofMat,
  );
  roofSouth.position.set(0, 1.66, 0.44);
  roofSouth.rotation.x = 0.14;
  roofSouth.castShadow = true;

  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.26, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 }),
  );
  bench.position.set(-0.7, 0.13, 0.35);
  canopy.add(roofNorth, roofSouth, bench);

  return canopy;
}

export function buildTrainVisual(
  trainId: TrainId,
  colliders: THREE.Object3D[],
): TrainVisual {
  const group = new THREE.Group();

  const selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(1.05, 1.38, 32),
    new THREE.MeshBasicMaterial({
      color: trainId === "yellow" ? 0xfacc15 : 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
    }),
  );
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.position.y = 0.05;
  selectionRing.visible = false;
  group.add(selectionRing);

  const chassisMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.58,
    metalness: 0.55,
  });
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.85,
    roughness: 0.25,
  });

  if (trainId === "yellow") {
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      roughness: 0.35,
      metalness: 0.22,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.45,
    });

    // Lead diesel-electric locomotive (centered forward toward +Z)
    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.22, 2.35),
      chassisMat,
    );
    chassis.position.set(0, 0.28, 0.32);
    chassis.castShadow = true;
    group.add(chassis);

    addBogieWheels(group, [-0.4, 1.05], wheelMat);

    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(0.76, 0.56, 1.32),
      bodyMat,
    );
    hood.position.set(0, 0.66, 0.78);
    hood.castShadow = true;
    group.add(hood);

    const exhaust = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.08, 0.26, 8),
      darkMat,
    );
    exhaust.position.set(0, 1.04, 0.85);
    group.add(exhaust);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.84, 0.78), bodyMat);
    cab.position.set(0, 0.8, -0.32);
    cab.castShadow = true;
    group.add(cab);

    const cabGlass = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.3, 0.64),
      darkMat,
    );
    cabGlass.position.set(0, 0.94, -0.32);
    group.add(cabGlass);

    const cabRoof = new THREE.Mesh(
      new THREE.BoxGeometry(0.96, 0.09, 0.86),
      darkMat,
    );
    cabRoof.position.set(0, 1.25, -0.32);
    group.add(cabRoof);

    // Twin warm headlights
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xfde047,
      emissiveIntensity: 0.95,
    });
    for (const hx of [-0.22, 0.22]) {
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 10, 10),
        lightMat,
      );
      lamp.position.set(hx, 0.68, 1.46);
      group.add(lamp);
    }

    // Coupled freight flatbed wagon carrying timber cargo behind locomotive (-Z)
    const coupler = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.08, 0.45),
      chassisMat,
    );
    coupler.position.set(0, 0.28, -1.02);
    group.add(coupler);

    const wagonDeck = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.16, 1.55),
      chassisMat,
    );
    wagonDeck.position.set(0, 0.28, -1.88);
    wagonDeck.castShadow = true;
    group.add(wagonDeck);
    addBogieWheels(group, [-2.35, -1.4], wheelMat);

    const cargoWood = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.36, 1.18),
      new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.78 }),
    );
    cargoWood.position.set(0, 0.54, -1.88);
    cargoWood.castShadow = true;
    group.add(cargoWood);
  } else {
    const blueMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb,
      roughness: 0.28,
      metalness: 0.28,
    });
    const silverMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.32,
      metalness: 0.45,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.15,
      metalness: 0.7,
    });

    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(0.92, 0.22, 2.85),
      chassisMat,
    );
    chassis.position.y = 0.26;
    chassis.castShadow = true;
    group.add(chassis);

    addBogieWheels(group, [-0.95, 0.95], wheelMat);

    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(0.88, 0.76, 2.72),
      blueMat,
    );
    shell.position.y = 0.74;
    shell.castShadow = true;
    group.add(shell);

    const skirt = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.12, 2.74),
      silverMat,
    );
    skirt.position.y = 0.42;
    group.add(skirt);

    const windowBand = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.26, 2.38),
      glassMat,
    );
    windowBand.position.y = 0.84;
    group.add(windowBand);

    const noseGlass = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.28, 0.1),
      glassMat,
    );
    noseGlass.position.set(0, 0.86, 1.36);
    group.add(noseGlass);

    // Rooftop pantograph frame
    const pantoMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.8,
      roughness: 0.25,
    });
    const pantoArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.22, 0.48),
      pantoMat,
    );
    pantoArm.position.set(0, 1.24, -0.45);
    group.add(pantoArm);
  }

  const pinAnchor = new THREE.Group();
  pinAnchor.position.set(0, 1.48, 0);
  group.add(pinAnchor);

  const collider = createPickCollider(
    1.85,
    2.25,
    trainId === "yellow" ? 4.35 : 3.4,
    new THREE.Vector3(0, 0.9, trainId === "yellow" ? -0.5 : 0),
    {
      pickType: "entity",
      entityId: trainId,
      hoverLabel:
        trainId === "yellow"
          ? "Pin Yellow Freight Train (yellow)"
          : "Pin Blue Regional Train (blue)",
    },
  );
  group.add(collider);
  colliders.push(collider);

  return { group, selectionRing, pinAnchor };
}

function addBogieWheels(
  parent: THREE.Group,
  zOffsets: readonly number[],
  wheelMat: THREE.MeshStandardMaterial,
): void {
  const wheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.96, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const z of zOffsets) {
    const axle = new THREE.Mesh(wheelGeo, wheelMat);
    axle.position.set(0, 0.17, z);
    parent.add(axle);
  }
}

export function buildAnnotationPinMesh(colorHex: number): THREE.Group {
  const pinGroup = new THREE.Group();

  const pinMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.25,
    roughness: 0.28,
  });

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 18), pinMat);
  head.position.y = 0.95;
  head.castShadow = true;

  const stem = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.68, 16), pinMat);
  stem.rotation.x = Math.PI;
  stem.position.y = 0.45;
  stem.castShadow = true;

  const groundHalo = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.48, 28),
    new THREE.MeshBasicMaterial({
      color: colorHex,
      side: THREE.DoubleSide,
    }),
  );
  groundHalo.rotation.x = -Math.PI / 2;
  groundHalo.position.y = -0.35;

  pinGroup.add(head, stem, groundHalo);
  return pinGroup;
}

export function getBranchYawAngle(branchId: BranchId): number {
  if (branchId === "platform-a") {
    return 0.42;
  }
  if (branchId === "platform-b") {
    return -0.42;
  }
  return 0;
}

function createPickCollider(
  width: number,
  height: number,
  depth: number,
  position: THREE.Vector3,
  userData: PickUserData,
): THREE.Mesh {
  const collider = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  collider.position.copy(position);
  collider.userData = userData;
  return collider;
}
