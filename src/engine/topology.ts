import type {
  AnnotatableEntityId,
  AnnotatableEntityType,
  BranchId,
  PlatformId,
  RouteDefinition,
  StoppableTrackId,
  SwitchId,
  SwitchState,
  TrackId,
  TrackState,
  TrainId,
  TrainState,
} from "./types.js";

export const TRACK_ORDER: readonly TrackId[] = [
  "entry",
  "shared",
  "regional-exit",
  "platform-a",
  "platform-b",
];

export const SWITCH_BRANCHES: readonly BranchId[] = [
  "regional-exit",
  "platform-a",
  "platform-b",
];

export const STOPPABLE_TRACKS: readonly StoppableTrackId[] = [
  "entry",
  "regional-exit",
  "platform-a",
  "platform-b",
];

/**
 * Directed routes through the turnout.
 * Note: there are intentionally no direct edges between diverging branches
 * ("regional-exit", "platform-a", "platform-b"); trains must traverse "shared".
 */
export const ROUTES: readonly RouteDefinition[] = [
  {
    from: "shared",
    to: "regional-exit",
    via: ["shared", "regional-exit"],
    requiresSwitch: { switchId: "main-switch", branchId: "regional-exit" },
  },
  {
    from: "shared",
    to: "platform-a",
    via: ["shared", "platform-a"],
    requiresSwitch: { switchId: "main-switch", branchId: "platform-a" },
  },
  {
    from: "shared",
    to: "platform-b",
    via: ["shared", "platform-b"],
    requiresSwitch: { switchId: "main-switch", branchId: "platform-b" },
  },
  {
    from: "entry",
    to: "regional-exit",
    via: ["entry", "shared", "regional-exit"],
    requiresSwitch: { switchId: "main-switch", branchId: "regional-exit" },
  },
  {
    from: "entry",
    to: "platform-a",
    via: ["entry", "shared", "platform-a"],
    requiresSwitch: { switchId: "main-switch", branchId: "platform-a" },
  },
  {
    from: "entry",
    to: "platform-b",
    via: ["entry", "shared", "platform-b"],
    requiresSwitch: { switchId: "main-switch", branchId: "platform-b" },
  },
  {
    from: "regional-exit",
    to: "entry",
    via: ["regional-exit", "shared", "entry"],
    requiresSwitch: { switchId: "main-switch", branchId: "regional-exit" },
  },
  {
    from: "platform-a",
    to: "entry",
    via: ["platform-a", "shared", "entry"],
    requiresSwitch: { switchId: "main-switch", branchId: "platform-a" },
  },
  {
    from: "platform-b",
    to: "entry",
    via: ["platform-b", "shared", "entry"],
    requiresSwitch: { switchId: "main-switch", branchId: "platform-b" },
  },
];

export function createInitialTracks(): Record<TrackId, TrackState> {
  return {
    entry: {
      id: "entry",
      label: "West Entry",
      landmark: "Signal Box",
      canStop: true,
      closable: false,
      connectsTo: ["shared"],
      closed: false,
      occupiedBy: "yellow",
      reservedBy: null,
    },
    shared: {
      id: "shared",
      label: "Shared Throat",
      landmark: "Main Switch",
      canStop: false,
      closable: false,
      connectsTo: ["entry", "regional-exit", "platform-a", "platform-b"],
      closed: false,
      occupiedBy: "blue",
      reservedBy: null,
    },
    "regional-exit": {
      id: "regional-exit",
      label: "Regional Exit",
      landmark: "Regional Outbound Exit",
      canStop: true,
      closable: false,
      connectsTo: ["shared"],
      closed: false,
      occupiedBy: null,
      reservedBy: null,
    },
    "platform-a": {
      id: "platform-a",
      label: "Platform A",
      landmark: "Water Tower",
      canStop: true,
      closable: true,
      connectsTo: ["shared"],
      closed: false,
      occupiedBy: null,
      reservedBy: null,
    },
    "platform-b": {
      id: "platform-b",
      label: "Platform B",
      landmark: "Station Canopy",
      canStop: true,
      closable: true,
      connectsTo: ["shared"],
      closed: false,
      occupiedBy: null,
      reservedBy: null,
    },
  };
}

export function createInitialSwitches(): Record<SwitchId, SwitchState> {
  return {
    "main-switch": {
      id: "main-switch",
      label: "Main Yard Turnout",
      branches: SWITCH_BRANCHES,
      foulingTrackId: "shared",
      activeBranchId: "regional-exit",
    },
  };
}

export function createInitialTrains(): Record<TrainId, TrainState> {
  return {
    yellow: {
      id: "yellow",
      label: "Yellow Freight Train",
      color: "yellow",
      category: "freight",
      trackId: "entry",
      status: "idle",
      movingToTrackId: null,
      activeRoute: null,
    },
    blue: {
      id: "blue",
      label: "Blue Regional Train",
      color: "blue",
      category: "regional",
      trackId: "shared",
      status: "idle",
      movingToTrackId: null,
      activeRoute: null,
    },
  };
}

export function findRoute(
  from: TrackId,
  to: StoppableTrackId,
): RouteDefinition | undefined {
  return ROUTES.find((route) => route.from === from && route.to === to);
}

const TRAIN_ALIASES: Record<string, TrainId> = {
  yellow: "yellow",
  "yellow-train": "yellow",
  "yellow freight": "yellow",
  "yellow freight train": "yellow",
  giallo: "yellow",
  "treno giallo": "yellow",
  blue: "blue",
  "blue-regional": "blue",
  "blue regional": "blue",
  "blue regional train": "blue",
  blu: "blue",
  "regionale blu": "blue",
};

const TRACK_ALIASES: Record<string, TrackId> = {
  entry: "entry",
  "west-entry": "entry",
  "west entry": "entry",
  ingresso: "entry",
  shared: "shared",
  common: "shared",
  "shared-throat": "shared",
  "tratto comune": "shared",
  "regional-exit": "regional-exit",
  "regional exit": "regional-exit",
  exit: "regional-exit",
  "outbound gantry": "regional-exit",
  uscita: "regional-exit",
  "platform-a": "platform-a",
  "platform a": "platform-a",
  a: "platform-a",
  "water tower": "platform-a",
  "water-tower": "platform-a",
  "banchina a": "platform-a",
  "banchina-a": "platform-a",
  "platform-b": "platform-b",
  "platform b": "platform-b",
  b: "platform-b",
  canopy: "platform-b",
  "station canopy": "platform-b",
  "banchina b": "platform-b",
  "banchina-b": "platform-b",
};

const SWITCH_ALIASES: Record<string, SwitchId> = {
  "main-switch": "main-switch",
  main: "main-switch",
  switch: "main-switch",
  "switch-1": "main-switch",
  scambio: "main-switch",
};

export function normalizeTrainId(raw: unknown): TrainId | null {
  if (typeof raw !== "string") {
    return null;
  }
  return TRAIN_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function normalizeTrackId(raw: unknown): TrackId | null {
  if (typeof raw !== "string") {
    return null;
  }
  return TRACK_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function normalizeSwitchId(raw: unknown): SwitchId | null {
  if (typeof raw !== "string") {
    return null;
  }
  return SWITCH_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function isPlatformId(trackId: TrackId): trackId is PlatformId {
  return trackId === "platform-a" || trackId === "platform-b";
}

export function isBranchId(trackId: TrackId): trackId is BranchId {
  return (
    trackId === "regional-exit" ||
    trackId === "platform-a" ||
    trackId === "platform-b"
  );
}

export function isStoppableTrackId(
  trackId: TrackId,
): trackId is StoppableTrackId {
  return trackId !== "shared";
}

export interface EntityDescriptor {
  readonly entityType: AnnotatableEntityType;
  readonly entityId: AnnotatableEntityId;
  readonly label: string;
}

const ENTITY_CATALOG: Record<AnnotatableEntityId, EntityDescriptor> = {
  yellow: {
    entityType: "train",
    entityId: "yellow",
    label: "Yellow Freight",
  },
  blue: {
    entityType: "train",
    entityId: "blue",
    label: "Blue Regional",
  },
  entry: {
    entityType: "track",
    entityId: "entry",
    label: "West Entry",
  },
  shared: {
    entityType: "track",
    entityId: "shared",
    label: "Shared Throat",
  },
  "regional-exit": {
    entityType: "track",
    entityId: "regional-exit",
    label: "Regional Exit",
  },
  "platform-a": {
    entityType: "platform",
    entityId: "platform-a",
    label: "Platform A (Water Tower)",
  },
  "platform-b": {
    entityType: "platform",
    entityId: "platform-b",
    label: "Platform B (Canopy)",
  },
  "main-switch": {
    entityType: "switch",
    entityId: "main-switch",
    label: "Main Switch",
  },
};

export function resolveAnnotatableEntity(
  id: AnnotatableEntityId,
): EntityDescriptor {
  return ENTITY_CATALOG[id];
}
