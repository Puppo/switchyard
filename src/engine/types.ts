export type TrackId =
  | "entry"
  | "shared"
  | "regional-exit"
  | "platform-a"
  | "platform-b";

export type StoppableTrackId =
  | "entry"
  | "regional-exit"
  | "platform-a"
  | "platform-b";

export type PlatformId = "platform-a" | "platform-b";

export type SwitchId = "main-switch";

export type BranchId = "regional-exit" | "platform-a" | "platform-b";

export type TrainId = "yellow" | "blue";

export type AnnotatableEntityType = "train" | "platform" | "track" | "switch";

export type AnnotatableEntityId = TrainId | TrackId | SwitchId;

export type ActionOrigin = "manual" | "webmcp" | "system";

export interface SceneAnnotation {
  readonly pin: string;
  readonly order: number;
  readonly entityType: AnnotatableEntityType;
  readonly entityId: AnnotatableEntityId;
  readonly label: string;
  readonly locationTrackId?: TrackId;
  readonly note: string | null;
}

export interface TrackState {
  readonly id: TrackId;
  readonly label: string;
  readonly landmark: string;
  readonly canStop: boolean;
  readonly closable: boolean;
  readonly connectsTo: readonly TrackId[];
  closed: boolean;
  occupiedBy: TrainId | null;
  reservedBy: TrainId | null;
}

export interface SwitchState {
  readonly id: SwitchId;
  readonly label: string;
  readonly branches: readonly BranchId[];
  readonly foulingTrackId: TrackId;
  activeBranchId: BranchId;
}

export interface TrainState {
  readonly id: TrainId;
  readonly label: string;
  readonly color: "yellow" | "blue";
  readonly category: "freight" | "regional";
  trackId: TrackId;
  status: "idle" | "moving";
  movingToTrackId: StoppableTrackId | null;
  activeRoute: readonly TrackId[] | null;
}

export interface RouteDefinition {
  readonly from: TrackId;
  readonly to: StoppableTrackId;
  readonly via: readonly TrackId[];
  readonly requiresSwitch: {
    readonly switchId: SwitchId;
    readonly branchId: BranchId;
  };
}

export interface ActionLogEntry {
  readonly id: number;
  readonly timestamp: string;
  readonly origin: ActionOrigin;
  readonly action: string;
  readonly input: Record<string, unknown>;
  readonly ok: boolean;
  readonly summary: string;
  readonly output: Record<string, unknown>;
}

export interface MovementRequest {
  readonly trainId: TrainId;
  readonly route: readonly TrackId[];
  readonly epoch: number;
  readonly signal: AbortSignal;
}

export type MovementDriver = (request: MovementRequest) => Promise<void>;

export interface EngineSnapshot {
  readonly epoch: number;
  readonly annotations: readonly SceneAnnotation[];
  readonly selectedTrainId: TrainId | null;
  readonly pinnedDestinationId: PlatformId | null;
  readonly tracks: Record<TrackId, Readonly<TrackState>>;
  readonly switches: Record<SwitchId, Readonly<SwitchState>>;
  readonly trains: Record<TrainId, Readonly<TrainState>>;
  readonly actionLog: readonly ActionLogEntry[];
}

export interface ScenePayloadAnnotation {
  readonly pin: string;
  readonly entityType: AnnotatableEntityType;
  readonly entityId: AnnotatableEntityId;
  readonly label: string;
  readonly locationTrackId?: TrackId;
  readonly note?: string;
}

export interface ScenePayload {
  readonly annotations: readonly ScenePayloadAnnotation[];
  readonly selectedTrainId: TrainId | null;
  readonly pinnedDestinationId: PlatformId | null;
  readonly trains: readonly {
    readonly id: TrainId;
    readonly label: string;
    readonly trackId: TrackId;
    readonly status: "idle" | "moving";
  }[];
  readonly tracks: readonly {
    readonly id: TrackId;
    readonly landmark: string;
    readonly canStop?: boolean;
    readonly closed?: boolean;
    readonly occupiedBy?: TrainId;
    readonly reservedBy?: TrainId;
    readonly connectsTo: readonly TrackId[];
  }[];
  readonly switches: readonly {
    readonly id: SwitchId;
    readonly activeBranchId: BranchId;
    readonly branches: readonly BranchId[];
    readonly locked: boolean;
    readonly lockedReason?: string;
  }[];
  readonly closedTrackIds: readonly TrackId[];
}

export type ToolErrorCode =
  | "INVALID_TARGET"
  | "TRAIN_ALREADY_MOVING"
  | "TRANSIT_ONLY_TRACK"
  | "NO_ROUTE"
  | "TRACK_CLOSED"
  | "TRACK_OCCUPIED"
  | "TRACK_RESERVED"
  | "TRACK_IN_USE"
  | "SWITCH_NOT_ALIGNED"
  | "SCENARIO_RESET"
  | "CANCELLED"
  | "MOVEMENT_FAILED"
  | "INTERNAL_ERROR";

export type SwitchResult =
  | {
      readonly ok: true;
      readonly switchId: SwitchId;
      readonly activeBranchId: BranchId;
      readonly changed: boolean;
    }
  | {
      readonly ok: false;
      readonly code: ToolErrorCode;
      readonly error: string;
      readonly retryable: boolean;
      readonly affectedTrackId?: TrackId;
      readonly occupyingTrainId?: TrainId | null;
      readonly reservingTrainId?: TrainId | null;
      readonly activeBranchId?: BranchId;
    };

export type MoveTrainResult =
  | {
      readonly ok: true;
      readonly status: "arrived" | "already_at_destination";
      readonly trainId: TrainId;
      readonly fromTrackId: TrackId;
      readonly arrivedAtTrackId: StoppableTrackId;
      readonly traversedTrackIds: readonly TrackId[];
    }
  | {
      readonly ok: false;
      readonly code: ToolErrorCode;
      readonly error: string;
      readonly retryable: boolean;
      readonly blockedTrackId?: TrackId;
      readonly occupyingTrainId?: TrainId | null;
      readonly reservingTrainId?: TrainId | null;
      readonly switchId?: SwitchId;
      readonly currentBranchId?: BranchId;
      readonly requiredBranchId?: BranchId;
    };

export type ClosureResult =
  | {
      readonly ok: true;
      readonly trackId: TrackId;
      readonly closed: boolean;
    }
  | {
      readonly ok: false;
      readonly code: ToolErrorCode;
      readonly error: string;
      readonly retryable: boolean;
      readonly blockedTrackId: TrackId;
    };
