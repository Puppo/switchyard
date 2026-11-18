import {
  createInitialSwitches,
  createInitialTracks,
  createInitialTrains,
  findRoute,
  isBranchId,
  isPlatformId,
  isStoppableTrackId,
  normalizeSwitchId,
  normalizeTrackId,
  normalizeTrainId,
  resolveAnnotatableEntity,
  SWITCH_BRANCHES,
  TRACK_ORDER,
} from "./topology.js";
import type {
  ActionLogEntry,
  ActionOrigin,
  AnnotatableEntityId,
  AnnotatableEntityType,
  BranchId,
  ClosureResult,
  EngineSnapshot,
  MovementDriver,
  MoveTrainResult,
  PlatformId,
  SceneAnnotation,
  ScenePayload,
  SwitchId,
  SwitchResult,
  SwitchState,
  TrackId,
  TrackState,
  TrainId,
  TrainState,
} from "./types.js";

const DEFAULT_MOVEMENT_DRIVER: MovementDriver = async () => {};
const MAX_ANNOTATIONS = 8;
const MAX_NOTE_LENGTH = 80;

interface StoredAnnotation {
  readonly entityType: AnnotatableEntityType;
  readonly entityId: AnnotatableEntityId;
  note: string | null;
}

/**
 * Deterministic single source of truth for Switchyard topology, track occupancy,
 * reservations, closures, turnout interlocking, ordered annotations, and epoch-safe movement.
 */
export class SwitchyardEngine {
  private epoch = 0;
  private epochController = new AbortController();
  private annotations: StoredAnnotation[] = [];
  private tracks: Record<TrackId, TrackState> = createInitialTracks();
  private switches: Record<SwitchId, SwitchState> = createInitialSwitches();
  private trains: Record<TrainId, TrainState> = createInitialTrains();
  private actionLog: ActionLogEntry[] = [];
  private nextLogId = 1;
  private listeners = new Set<(snapshot: EngineSnapshot) => void>();
  private driver: MovementDriver;

  constructor(driver: MovementDriver = DEFAULT_MOVEMENT_DRIVER) {
    this.driver = driver;
  }

  /** Allows attaching or replacing the visual animation driver after engine construction. */
  setMovementDriver(driver: MovementDriver): void {
    this.driver = driver;
  }

  subscribe(listener: (snapshot: EngineSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Side-effect-free state snapshot for UI and 3D scene synchronization.
   * Does not write to the WebMCP action log.
   */
  getSnapshot(): EngineSnapshot {
    const resolvedAnnotations = this.buildAnnotations();
    return {
      epoch: this.epoch,
      annotations: resolvedAnnotations,
      selectedTrainId: this.getDerivedSelectedTrainId(resolvedAnnotations),
      pinnedDestinationId: this.getDerivedPinnedPlatformId(resolvedAnnotations),
      tracks: {
        entry: { ...this.tracks.entry },
        shared: { ...this.tracks.shared },
        "regional-exit": { ...this.tracks["regional-exit"] },
        "platform-a": { ...this.tracks["platform-a"] },
        "platform-b": { ...this.tracks["platform-b"] },
      },
      switches: {
        "main-switch": { ...this.switches["main-switch"] },
      },
      trains: {
        yellow: {
          ...this.trains.yellow,
          activeRoute: this.trains.yellow.activeRoute
            ? [...this.trains.yellow.activeRoute]
            : null,
        },
        blue: {
          ...this.trains.blue,
          activeRoute: this.trains.blue.activeRoute
            ? [...this.trains.blue.activeRoute]
            : null,
        },
      },
      actionLog: [...this.actionLog],
    };
  }

  /**
   * Builds the compact (<= 1,500 chars) state payload for `get_scene()`.
   * Logs an entry only when invoked as an explicit tool read (`origin`).
   */
  getScenePayload(origin?: ActionOrigin): ScenePayload {
    const mainSwitch = this.switches["main-switch"];
    const lockInfo = this.getSwitchLockInfo(mainSwitch.id);
    const resolvedAnnotations = this.buildAnnotations();
    const selectedTrainId = this.getDerivedSelectedTrainId(resolvedAnnotations);
    const pinnedDestinationId =
      this.getDerivedPinnedPlatformId(resolvedAnnotations);

    const payload: ScenePayload = {
      annotations: resolvedAnnotations.map((a) => ({
        pin: a.pin,
        entityType: a.entityType,
        entityId: a.entityId,
        label: a.label,
        ...(a.locationTrackId ? { locationTrackId: a.locationTrackId } : {}),
        ...(a.note ? { note: a.note } : {}),
      })),
      selectedTrainId,
      pinnedDestinationId,
      trains: (["yellow", "blue"] as const).map((id) => {
        const train = this.trains[id];
        return {
          id: train.id,
          label: train.label,
          trackId: train.trackId,
          status: train.status,
        };
      }),
      tracks: TRACK_ORDER.map((id) => {
        const track = this.tracks[id];
        return {
          id: track.id,
          landmark: track.landmark,
          ...(track.canStop ? {} : { canStop: false }),
          ...(track.closed ? { closed: true } : {}),
          ...(track.occupiedBy ? { occupiedBy: track.occupiedBy } : {}),
          ...(track.reservedBy ? { reservedBy: track.reservedBy } : {}),
          connectsTo: track.connectsTo,
        };
      }),
      switches: [
        {
          id: mainSwitch.id,
          activeBranchId: mainSwitch.activeBranchId,
          branches: mainSwitch.branches,
          locked: lockInfo.locked,
          ...(lockInfo.locked ? { lockedReason: lockInfo.reason } : {}),
        },
      ],
      closedTrackIds: TRACK_ORDER.filter((id) => this.tracks[id].closed),
    };

    if (origin) {
      this.appendLog(
        origin,
        "get_scene",
        {},
        true,
        `pins=${resolvedAnnotations.length} (${resolvedAnnotations.map((a) => `${a.pin}:${a.entityId}`).join(", ") || "none"}), switch=${mainSwitch.activeBranchId}`,
        payload as unknown as Record<string, unknown>,
      );
      this.notify();
    }

    return payload;
  }

  /** Toggles an entity annotation pin (#1, #2, ...) or updates its note if provided. */
  toggleAnnotation(entityId: AnnotatableEntityId, note?: string | null): void {
    const existingIdx = this.annotations.findIndex(
      (a) => a.entityId === entityId,
    );
    if (existingIdx !== -1 && note === undefined) {
      this.annotations.splice(existingIdx, 1);
      this.notify();
      return;
    }
    this.addOrUpdateAnnotation(entityId, note ?? null);
  }

  addOrUpdateAnnotation(
    entityId: AnnotatableEntityId,
    note: string | null = null,
  ): void {
    const sanitizedNote = sanitizeNote(note);
    const existing = this.annotations.find((a) => a.entityId === entityId);
    if (existing) {
      existing.note = sanitizedNote;
      this.notify();
      return;
    }
    if (this.annotations.length >= MAX_ANNOTATIONS) {
      return;
    }
    const meta = resolveAnnotatableEntity(entityId);
    this.annotations.push({
      entityType: meta.entityType,
      entityId,
      note: sanitizedNote,
    });
    this.notify();
  }

  setAnnotationNote(entityId: AnnotatableEntityId, note: string | null): void {
    const existing = this.annotations.find((a) => a.entityId === entityId);
    if (!existing) {
      return;
    }
    const sanitized = sanitizeNote(note);
    if (existing.note === sanitized) {
      return;
    }
    existing.note = sanitized;
    this.notify();
  }

  removeAnnotation(entityId: AnnotatableEntityId): void {
    const next = this.annotations.filter((a) => a.entityId !== entityId);
    if (next.length === this.annotations.length) {
      return;
    }
    this.annotations = next;
    this.notify();
  }

  clearAnnotations(): void {
    if (this.annotations.length === 0) {
      return;
    }
    this.annotations = [];
    this.notify();
  }

  /**
   * Convenience helper preserving single-train selection APIs.
   * Passing `null` removes train annotations; passing an ID annotates that train.
   */
  selectTrain(trainId: TrainId | null, _origin: ActionOrigin = "manual"): void {
    if (trainId === null) {
      this.annotations = this.annotations.filter(
        (a) => a.entityType !== "train",
      );
      this.notify();
      return;
    }
    this.addOrUpdateAnnotation(trainId);
  }

  /**
   * Convenience helper preserving single-platform pin APIs.
   * Passing `null` removes platform annotations; passing an ID annotates that platform.
   */
  pinDestination(
    trackId: PlatformId | null,
    _origin: ActionOrigin = "manual",
  ): void {
    if (trackId === null) {
      this.annotations = this.annotations.filter(
        (a) => a.entityType !== "platform",
      );
      this.notify();
      return;
    }
    this.addOrUpdateAnnotation(trackId);
  }

  setTrackClosed(
    trackId: TrackId,
    closed: boolean,
    _origin: ActionOrigin = "manual",
  ): ClosureResult {
    const track = this.tracks[trackId];
    if (!track.closable) {
      return {
        ok: false,
        code: "INVALID_TARGET",
        blockedTrackId: trackId,
        retryable: false,
        error: `Track '${trackId}' cannot be closed; only platform branches ('platform-a', 'platform-b') support closure barriers.`,
      };
    }

    if (closed && (track.occupiedBy !== null || track.reservedBy !== null)) {
      const holder = track.occupiedBy ?? track.reservedBy;
      return {
        ok: false,
        code: "TRACK_IN_USE",
        blockedTrackId: trackId,
        retryable: true,
        error: `Cannot close '${trackId}' while it is in use by train '${holder}'. Wait until the track is clear.`,
      };
    }

    if (track.closed === closed) {
      return { ok: true, trackId, closed };
    }

    track.closed = closed;
    this.notify();
    return { ok: true, trackId, closed };
  }

  setSwitch(
    rawSwitchId: unknown,
    rawBranchId: unknown,
    origin: ActionOrigin = "webmcp",
  ): SwitchResult {
    const switchId = normalizeSwitchId(rawSwitchId);
    if (!switchId) {
      const result: SwitchResult = {
        ok: false,
        code: "INVALID_TARGET",
        retryable: false,
        error: `Unknown switch '${String(rawSwitchId)}'. Valid switchId: 'main-switch'.`,
      };
      this.appendLog(
        origin,
        "set_switch",
        { switchId: rawSwitchId, branchId: rawBranchId },
        false,
        result.error,
        result as unknown as Record<string, unknown>,
      );
      this.notify();
      return result;
    }

    const normalizedTrack = normalizeTrackId(rawBranchId);
    if (!normalizedTrack || !isBranchId(normalizedTrack)) {
      const result: SwitchResult = {
        ok: false,
        code: "INVALID_TARGET",
        retryable: false,
        activeBranchId: this.switches[switchId].activeBranchId,
        error: `Invalid branch '${String(rawBranchId)}' for '${switchId}'. Valid branchId values: ${SWITCH_BRANCHES.join(", ")}.`,
      };
      this.appendLog(
        origin,
        "set_switch",
        { switchId, branchId: rawBranchId },
        false,
        result.error,
        result as unknown as Record<string, unknown>,
      );
      this.notify();
      return result;
    }

    const targetBranch: BranchId = normalizedTrack;
    const sw = this.switches[switchId];

    if (sw.activeBranchId === targetBranch) {
      const result: SwitchResult = {
        ok: true,
        switchId,
        activeBranchId: sw.activeBranchId,
        changed: false,
      };
      this.appendLog(
        origin,
        "set_switch",
        { switchId, branchId: targetBranch },
        true,
        `${switchId} already aligned to ${targetBranch}`,
        result as unknown as Record<string, unknown>,
      );
      this.notify();
      return result;
    }

    // Interlocking: check fouling track ("shared") AND active reservations on turnout branches.
    const lockInfo = this.getSwitchLockInfo(switchId);
    if (lockInfo.locked) {
      const result: SwitchResult = {
        ok: false,
        code: lockInfo.code,
        affectedTrackId: lockInfo.affectedTrackId,
        occupyingTrainId: lockInfo.occupyingTrainId,
        reservingTrainId: lockInfo.reservingTrainId,
        activeBranchId: sw.activeBranchId,
        retryable: true,
        error: lockInfo.error,
      };
      this.appendLog(
        origin,
        "set_switch",
        { switchId, branchId: targetBranch },
        false,
        result.error,
        result as unknown as Record<string, unknown>,
      );
      this.notify();
      return result;
    }

    sw.activeBranchId = targetBranch;
    const result: SwitchResult = {
      ok: true,
      switchId,
      activeBranchId: targetBranch,
      changed: true,
    };
    this.appendLog(
      origin,
      "set_switch",
      { switchId, branchId: targetBranch },
      true,
      `Aligned ${switchId} -> ${targetBranch}`,
      result as unknown as Record<string, unknown>,
    );
    this.notify();
    return result;
  }

  async moveTrain(
    rawTrainId: unknown,
    rawDestinationId: unknown,
    options: { origin?: ActionOrigin; signal?: AbortSignal } = {},
  ): Promise<MoveTrainResult> {
    const origin: ActionOrigin = options.origin ?? "webmcp";
    const externalSignal = options.signal;

    const trainId = normalizeTrainId(rawTrainId);
    if (!trainId) {
      return this.failMove(origin, rawTrainId, rawDestinationId, {
        ok: false,
        code: "INVALID_TARGET",
        retryable: false,
        error: `Unknown train '${String(rawTrainId)}'. Valid trainId values: yellow, blue.`,
      });
    }

    const destinationTrack = normalizeTrackId(rawDestinationId);
    if (!destinationTrack) {
      return this.failMove(origin, trainId, rawDestinationId, {
        ok: false,
        code: "INVALID_TARGET",
        retryable: false,
        error: `Unknown destination '${String(rawDestinationId)}'. Valid destinations: regional-exit, platform-a, platform-b, entry.`,
      });
    }

    const train = this.trains[trainId];

    // 1. Prevent concurrent double-dispatch of the same train.
    if (train.status === "moving") {
      return this.failMove(origin, trainId, destinationTrack, {
        ok: false,
        code: "TRAIN_ALREADY_MOVING",
        retryable: true,
        blockedTrackId: train.movingToTrackId ?? train.trackId,
        error: `Train '${trainId}' is already moving toward '${train.movingToTrackId}'. Wait for arrival before issuing another move.`,
      });
    }

    // 2. Forbid stopping on the switch throat to prevent self-deadlock.
    if (!isStoppableTrackId(destinationTrack)) {
      return this.failMove(origin, trainId, destinationTrack, {
        ok: false,
        code: "TRANSIT_ONLY_TRACK",
        blockedTrackId: "shared",
        retryable: false,
        error:
          "Track 'shared' is a switch throat and trains cannot terminate on it. Align 'main-switch' after 'shared' is clear, then move directly to 'platform-a', 'platform-b', or 'regional-exit'.",
      });
    }

    if (train.trackId === destinationTrack) {
      const result: MoveTrainResult = {
        ok: true,
        status: "already_at_destination",
        trainId,
        fromTrackId: train.trackId,
        arrivedAtTrackId: destinationTrack,
        traversedTrackIds: [destinationTrack],
      };
      this.appendLog(
        origin,
        "move_train",
        { trainId, destinationId: destinationTrack },
        true,
        `${trainId} is already at ${destinationTrack}`,
        result as unknown as Record<string, unknown>,
      );
      this.notify();
      return result;
    }

    // 3. Structural route lookup.
    const route = findRoute(train.trackId, destinationTrack);
    if (!route) {
      return this.failMove(origin, trainId, destinationTrack, {
        ok: false,
        code: "NO_ROUTE",
        retryable: false,
        error: `No direct route from '${train.trackId}' to '${destinationTrack}' without returning through 'entry'.`,
      });
    }

    // 4. Precedence: check closed tracks FIRST so branch closures are reported explicitly
    //    even if another train currently occupies "shared" or the switch points elsewhere.
    for (const seg of route.via) {
      if (this.tracks[seg].closed) {
        return this.failMove(origin, trainId, destinationTrack, {
          ok: false,
          code: "TRACK_CLOSED",
          blockedTrackId: seg,
          retryable: false,
          error: `Track '${seg}' (${this.tracks[seg].landmark}) is closed. Keep '${trainId}' at '${train.trackId}' and inform the user about the closure.`,
        });
      }
    }

    // 5. Check occupancy and active reservations along every traversed segment.
    const downstream = route.via.slice(1);
    for (const seg of downstream) {
      const track = this.tracks[seg];
      if (track.occupiedBy !== null && track.occupiedBy !== trainId) {
        return this.failMove(origin, trainId, destinationTrack, {
          ok: false,
          code: "TRACK_OCCUPIED",
          blockedTrackId: seg,
          occupyingTrainId: track.occupiedBy,
          retryable: true,
          error: `Track '${seg}' is occupied by '${track.occupiedBy}'. Dispatch '${track.occupiedBy}' to clear '${seg}' first, then retry.`,
        });
      }
      if (track.reservedBy !== null && track.reservedBy !== trainId) {
        return this.failMove(origin, trainId, destinationTrack, {
          ok: false,
          code: "TRACK_RESERVED",
          blockedTrackId: seg,
          reservingTrainId: track.reservedBy,
          retryable: true,
          error: `Track '${seg}' is reserved by moving train '${track.reservedBy}'. Wait for arrival and retry.`,
        });
      }
    }

    // 6. Check switch alignment.
    const mainSwitch = this.switches[route.requiresSwitch.switchId];
    if (mainSwitch.activeBranchId !== route.requiresSwitch.branchId) {
      return this.failMove(origin, trainId, destinationTrack, {
        ok: false,
        code: "SWITCH_NOT_ALIGNED",
        blockedTrackId: "shared",
        switchId: mainSwitch.id,
        currentBranchId: mainSwitch.activeBranchId,
        requiredBranchId: route.requiresSwitch.branchId,
        retryable: true,
        error: `Switch '${mainSwitch.id}' is aligned to '${mainSwitch.activeBranchId}', not '${route.requiresSwitch.branchId}'. Call set_switch('${mainSwitch.id}', '${route.requiresSwitch.branchId}') first.`,
      });
    }

    if (externalSignal?.aborted) {
      return this.failMove(origin, trainId, destinationTrack, {
        ok: false,
        code: "CANCELLED",
        retryable: true,
        error: "Movement cancelled before start.",
      });
    }

    // Phase 1: Synchronous reservation commit (zero await gap before locking segments).
    const startEpoch = this.epoch;
    const originTrackId = train.trackId;
    train.status = "moving";
    train.movingToTrackId = destinationTrack;
    train.activeRoute = route.via;
    for (const seg of downstream) {
      this.tracks[seg].reservedBy = trainId;
    }
    this.notify();

    // Phase 2: Await movement driver with linked epoch + caller AbortSignals.
    const combinedController = new AbortController();
    const abortCombined = () => combinedController.abort();
    const epochSignal = this.epochController.signal;
    if (epochSignal.aborted || externalSignal?.aborted) {
      combinedController.abort();
    } else {
      epochSignal.addEventListener("abort", abortCombined, { once: true });
      externalSignal?.addEventListener("abort", abortCombined, { once: true });
    }

    try {
      await this.driver({
        trainId,
        route: route.via,
        epoch: startEpoch,
        signal: combinedController.signal,
      });
    } catch (err) {
      // If reset() happened, let Case A handle it cleanly without touching restored state.
      if (this.epoch === startEpoch && !externalSignal?.aborted) {
        this.rollbackMove(trainId, originTrackId, downstream);
        const result: MoveTrainResult = {
          ok: false,
          code: "MOVEMENT_FAILED",
          retryable: true,
          blockedTrackId: originTrackId,
          error: `Movement animation failed: ${err instanceof Error ? err.message : String(err)}`,
        };
        this.appendLog(
          origin,
          "move_train",
          { trainId, destinationId: destinationTrack },
          false,
          result.error,
          result as unknown as Record<string, unknown>,
        );
        this.notify();
        return result;
      }
    } finally {
      epochSignal.removeEventListener("abort", abortCombined);
      externalSignal?.removeEventListener("abort", abortCombined);
    }

    // Phase 3A: Reset occurred mid-flight -> leave restored state completely untouched!
    if (this.epoch !== startEpoch) {
      return {
        ok: false,
        code: "SCENARIO_RESET",
        retryable: true,
        error:
          "Scenario was reset during movement. Call get_scene() to inspect the restored state.",
      };
    }

    // Phase 3B: Caller cancelled without reset -> roll back reservations cleanly.
    if (externalSignal?.aborted) {
      this.rollbackMove(trainId, originTrackId, downstream);
      const result: MoveTrainResult = {
        ok: false,
        code: "CANCELLED",
        retryable: true,
        blockedTrackId: originTrackId,
        error: `Movement cancelled; '${trainId}' remains on '${originTrackId}'.`,
      };
      this.appendLog(
        origin,
        "move_train",
        { trainId, destinationId: destinationTrack },
        false,
        result.error,
        result as unknown as Record<string, unknown>,
      );
      this.notify();
      return result;
    }

    // Phase 3C: Commit arrival atomically.
    if (this.tracks[originTrackId].occupiedBy === trainId) {
      this.tracks[originTrackId].occupiedBy = null;
    }
    for (const seg of downstream) {
      if (this.tracks[seg].reservedBy === trainId) {
        this.tracks[seg].reservedBy = null;
      }
    }
    this.tracks[destinationTrack].occupiedBy = trainId;
    train.trackId = destinationTrack;
    train.status = "idle";
    train.movingToTrackId = null;
    train.activeRoute = null;

    const result: MoveTrainResult = {
      ok: true,
      status: "arrived",
      trainId,
      fromTrackId: originTrackId,
      arrivedAtTrackId: destinationTrack,
      traversedTrackIds: route.via,
    };
    this.appendLog(
      origin,
      "move_train",
      { trainId, destinationId: destinationTrack },
      true,
      `${trainId} arrived at ${destinationTrack} (${this.tracks[destinationTrack].landmark})`,
      result as unknown as Record<string, unknown>,
    );
    this.notify();
    return result;
  }

  reset(): EngineSnapshot {
    this.epoch += 1;
    this.epochController.abort(new Error("Scenario reset"));
    this.epochController = new AbortController();

    this.annotations = [];
    this.tracks = createInitialTracks();
    this.switches = createInitialSwitches();
    this.trains = createInitialTrains();
    this.notify();
    return this.getSnapshot();
  }

  clearLog(): void {
    this.actionLog = [];
    this.notify();
  }

  /** Helper used by UI/scene click handlers. */
  handlePlatformClick(trackId: TrackId): void {
    if (isPlatformId(trackId)) {
      this.toggleAnnotation(trackId);
    }
  }

  private buildAnnotations(): SceneAnnotation[] {
    return this.annotations.map((item, idx) => {
      const meta = resolveAnnotatableEntity(item.entityId);
      const order = idx + 1;
      return {
        pin: `#${order}`,
        order,
        entityType: item.entityType,
        entityId: item.entityId,
        label: meta.label,
        ...(item.entityType === "train"
          ? { locationTrackId: this.trains[item.entityId as TrainId].trackId }
          : {}),
        note: item.note,
      };
    });
  }

  private getDerivedSelectedTrainId(
    annotations: readonly SceneAnnotation[],
  ): TrainId | null {
    const firstTrain = annotations.find((a) => a.entityType === "train");
    return firstTrain ? (firstTrain.entityId as TrainId) : null;
  }

  private getDerivedPinnedPlatformId(
    annotations: readonly SceneAnnotation[],
  ): PlatformId | null {
    const firstPlatform = annotations.find((a) => a.entityType === "platform");
    return firstPlatform ? (firstPlatform.entityId as PlatformId) : null;
  }

  private getSwitchLockInfo(switchId: SwitchId):
    | { readonly locked: false; readonly reason: null }
    | {
        readonly locked: true;
        readonly code: "TRACK_OCCUPIED" | "TRACK_RESERVED";
        readonly affectedTrackId: TrackId;
        readonly occupyingTrainId: TrainId | null;
        readonly reservingTrainId: TrainId | null;
        readonly reason: string;
        readonly error: string;
      } {
    const sw = this.switches[switchId];
    const shared = this.tracks[sw.foulingTrackId];

    // An idle train parked at the upstream berth on "shared" sits clear of the switch blades,
    // so main-switch can be aligned for it (e.g. blue -> platform-a) unless a move is active.
    if (shared.reservedBy !== null) {
      return {
        locked: true,
        code: "TRACK_RESERVED",
        affectedTrackId: shared.id,
        occupyingTrainId: shared.occupiedBy,
        reservingTrainId: shared.reservedBy,
        reason: `reserved by ${shared.reservedBy} on ${shared.id}`,
        error: `Cannot throw '${switchId}' while '${shared.id}' is reserved by moving train '${shared.reservedBy}'. Wait for arrival.`,
      };
    }

    if (
      shared.occupiedBy !== null &&
      this.trains[shared.occupiedBy].status === "moving"
    ) {
      return {
        locked: true,
        code: "TRACK_RESERVED",
        affectedTrackId: shared.id,
        occupyingTrainId: shared.occupiedBy,
        reservingTrainId: shared.occupiedBy,
        reason: `in transit through ${shared.id} by ${shared.occupiedBy}`,
        error: `Cannot throw '${switchId}' while '${shared.occupiedBy}' is moving through '${shared.id}'. Wait for arrival.`,
      };
    }

    // Guard against throwing the switch while a train is still finishing arrival onto its active branch.
    const activeBranchTrack = this.tracks[sw.activeBranchId];
    if (activeBranchTrack.reservedBy !== null) {
      return {
        locked: true,
        code: "TRACK_RESERVED",
        affectedTrackId: activeBranchTrack.id,
        occupyingTrainId: null,
        reservingTrainId: activeBranchTrack.reservedBy,
        reason: `reserved by ${activeBranchTrack.reservedBy} on ${activeBranchTrack.id}`,
        error: `Cannot throw '${switchId}' while '${activeBranchTrack.id}' is reserved by moving train '${activeBranchTrack.reservedBy}'. Wait for arrival.`,
      };
    }

    return { locked: false, reason: null };
  }

  private rollbackMove(
    trainId: TrainId,
    originTrackId: TrackId,
    downstream: readonly TrackId[],
  ): void {
    for (const seg of downstream) {
      if (this.tracks[seg].reservedBy === trainId) {
        this.tracks[seg].reservedBy = null;
      }
    }
    this.tracks[originTrackId].occupiedBy = trainId;
    const train = this.trains[trainId];
    train.trackId = originTrackId;
    train.status = "idle";
    train.movingToTrackId = null;
    train.activeRoute = null;
  }

  private failMove(
    origin: ActionOrigin,
    trainId: unknown,
    destinationId: unknown,
    result: Extract<MoveTrainResult, { readonly ok: false }>,
  ): MoveTrainResult {
    this.appendLog(
      origin,
      "move_train",
      { trainId, destinationId },
      false,
      result.error,
      result as unknown as Record<string, unknown>,
    );
    this.notify();
    return result;
  }

  private appendLog(
    origin: ActionOrigin,
    action: string,
    input: Record<string, unknown>,
    ok: boolean,
    summary: string,
    output: Record<string, unknown>,
  ): void {
    const entry: ActionLogEntry = {
      id: this.nextLogId++,
      timestamp: new Date().toLocaleTimeString("en-GB", { hour12: false }),
      origin,
      action,
      input,
      ok,
      summary,
      output,
    };
    this.actionLog.unshift(entry);
    if (this.actionLog.length > 100) {
      this.actionLog.length = 100;
    }
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function sanitizeNote(note: string | null | undefined): string | null {
  if (typeof note !== "string") {
    return null;
  }
  const trimmed = note.trim().slice(0, MAX_NOTE_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}
