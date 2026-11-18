import { describe, expect, it } from "vitest";
import { SwitchyardEngine } from "../src/engine/simulation.js";
import type { MovementDriver, MovementRequest } from "../src/engine/types.js";

function createDeferredDriver(): {
  driver: MovementDriver;
  pending: { request: MovementRequest; resolve: () => void }[];
} {
  const pending: { request: MovementRequest; resolve: () => void }[] = [];
  const driver: MovementDriver = (request) =>
    new Promise<void>((resolve) => {
      pending.push({ request, resolve });
    });
  return { driver, pending };
}

describe("SwitchyardEngine", () => {
  it("runs Demo Run 1 (Platform A) and requires clearing shared + aligning switch", async () => {
    const engine = new SwitchyardEngine();

    engine.selectTrain("yellow", "manual");
    engine.pinDestination("platform-a", "manual");

    const initialScene = engine.getScenePayload();
    expect(initialScene.selectedTrainId).toBe("yellow");
    expect(initialScene.pinnedDestinationId).toBe("platform-a");

    // Yellow cannot enter shared while Blue occupies it
    const blockedByBlue = await engine.moveTrain("yellow", "platform-a", {
      origin: "webmcp",
    });
    expect(blockedByBlue.ok).toBe(false);
    if (!blockedByBlue.ok) {
      expect(blockedByBlue.code).toBe("TRACK_OCCUPIED");
      expect(blockedByBlue.blockedTrackId).toBe("shared");
      expect(blockedByBlue.retryable).toBe(true);
    }

    // Blue departs to its dedicated exit
    const blueMove = await engine.moveTrain("blue", "regional-exit", {
      origin: "webmcp",
    });
    expect(blueMove).toMatchObject({
      ok: true,
      status: "arrived",
      trainId: "blue",
      arrivedAtTrackId: "regional-exit",
    });

    // Yellow still needs main-switch aligned from regional-exit to platform-a
    const unaligned = await engine.moveTrain("yellow", "platform-a", {
      origin: "webmcp",
    });
    expect(unaligned.ok).toBe(false);
    if (!unaligned.ok) {
      expect(unaligned.code).toBe("SWITCH_NOT_ALIGNED");
      expect(unaligned.requiredBranchId).toBe("platform-a");
    }

    const switchRes = engine.setSwitch("main-switch", "platform-a", "webmcp");
    expect(switchRes).toMatchObject({
      ok: true,
      switchId: "main-switch",
      activeBranchId: "platform-a",
      changed: true,
    });

    const yellowMove = await engine.moveTrain("yellow", "platform-a", {
      origin: "webmcp",
    });
    expect(yellowMove).toMatchObject({
      ok: true,
      status: "arrived",
      trainId: "yellow",
      arrivedAtTrackId: "platform-a",
    });

    const finalSnap = engine.getSnapshot();
    expect(finalSnap.trains.yellow.trackId).toBe("platform-a");
    expect(finalSnap.tracks.entry.occupiedBy).toBeNull();
    expect(finalSnap.tracks["platform-a"].occupiedBy).toBe("yellow");
  });

  it("performs full reset between Run 1 and Run 2 and routes Yellow to Platform B", async () => {
    const engine = new SwitchyardEngine();
    engine.selectTrain("yellow", "manual");
    engine.pinDestination("platform-a", "manual");
    await engine.moveTrain("blue", "regional-exit", { origin: "webmcp" });
    engine.setSwitch("main-switch", "platform-a", "webmcp");
    await engine.moveTrain("yellow", "platform-a", { origin: "webmcp" });

    const resetSnap = engine.reset();
    expect(resetSnap.selectedTrainId).toBeNull();
    expect(resetSnap.pinnedDestinationId).toBeNull();
    expect(resetSnap.trains.yellow.trackId).toBe("entry");
    expect(resetSnap.trains.blue.trackId).toBe("shared");
    expect(resetSnap.switches["main-switch"].activeBranchId).toBe(
      "regional-exit",
    );

    engine.selectTrain("yellow", "manual");
    engine.pinDestination("platform-b", "manual");
    await engine.moveTrain("blue", "regional-exit", { origin: "webmcp" });
    engine.setSwitch("main-switch", "platform-b", "webmcp");
    const run2 = await engine.moveTrain("yellow", "platform-b", {
      origin: "webmcp",
    });

    expect(run2).toMatchObject({
      ok: true,
      status: "arrived",
      arrivedAtTrackId: "platform-b",
    });
  });

  it("allows aligning main-switch while blue is idle on shared, interlocks while moving, and forbids stopping on shared", async () => {
    const { driver, pending } = createDeferredDriver();
    const engine = new SwitchyardEngine(driver);

    // When Blue is idle at the upstream berth on shared, main-switch can align to platform-a
    const idleAlign = engine.setSwitch("main-switch", "platform-a", "webmcp");
    expect(idleAlign).toMatchObject({
      ok: true,
      switchId: "main-switch",
      activeBranchId: "platform-a",
      changed: true,
    });
    // Reset back to regional-exit before starting Blue -> regional-exit
    engine.setSwitch("main-switch", "regional-exit", "webmcp");

    // Move Blue -> regional-exit (mid-flight: switch must be locked!)
    const bluePromise = engine.moveTrain("blue", "regional-exit", {
      origin: "webmcp",
    });
    expect(pending).toHaveLength(1);
    const lockedDuringBlue = engine.setSwitch(
      "main-switch",
      "platform-a",
      "webmcp",
    );
    expect(lockedDuringBlue.ok).toBe(false);
    if (!lockedDuringBlue.ok) {
      expect(lockedDuringBlue.code).toBe("TRACK_RESERVED");
    }
    pending[0].resolve();
    await bluePromise;

    // Forbid stopping on switch throat 'shared'
    const throatStop = await engine.moveTrain("yellow", "shared", {
      origin: "webmcp",
    });
    expect(throatStop.ok).toBe(false);
    if (!throatStop.ok) {
      expect(throatStop.code).toBe("TRANSIT_ONLY_TRACK");
      expect(throatStop.blockedTrackId).toBe("shared");
    }

    // Align and start Yellow -> platform-a; switch must lock while shared is reserved
    engine.setSwitch("main-switch", "platform-a", "webmcp");
    const yellowPromise = engine.moveTrain("yellow", "platform-a", {
      origin: "webmcp",
    });
    expect(engine.getSnapshot().tracks.shared.reservedBy).toBe("yellow");
    const lockedReserved = engine.setSwitch(
      "main-switch",
      "platform-b",
      "webmcp",
    );
    expect(lockedReserved.ok).toBe(false);
    if (!lockedReserved.ok) {
      expect(lockedReserved.code).toBe("TRACK_RESERVED");
    }
    pending[1].resolve();
    await yellowPromise;
  });

  it("routes Blue Regional directly to Platform A or Platform B when selected", async () => {
    const engine = new SwitchyardEngine();
    engine.toggleAnnotation("blue");
    engine.toggleAnnotation("platform-a");

    const sw = engine.setSwitch("main-switch", "platform-a", "webmcp");
    expect(sw).toMatchObject({ ok: true, activeBranchId: "platform-a" });

    const move = await engine.moveTrain("blue", "platform-a", {
      origin: "webmcp",
    });
    expect(move).toMatchObject({
      ok: true,
      status: "arrived",
      trainId: "blue",
      arrivedAtTrackId: "platform-a",
    });
    expect(engine.getSnapshot().tracks.shared.occupiedBy).toBeNull();
    expect(engine.getSnapshot().tracks["platform-a"].occupiedBy).toBe("blue");
  });

  it("reports Branch B closure before occupancy/alignment and prevents closing an occupied branch", async () => {
    const engine = new SwitchyardEngine();
    const closeRes = engine.setTrackClosed("platform-b", true, "manual");
    expect(closeRes).toEqual({ ok: true, trackId: "platform-b", closed: true });

    // Even while Blue is still on shared, attempting to route Yellow to closed Branch B reports TRACK_CLOSED
    const blocked = await engine.moveTrain("yellow", "platform-b", {
      origin: "webmcp",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("TRACK_CLOSED");
      expect(blocked.blockedTrackId).toBe("platform-b");
      expect(blocked.retryable).toBe(false);
    }
    expect(engine.getSnapshot().trains.yellow.trackId).toBe("entry");

    // Reopen and move Yellow to platform-b; closing while occupied must fail
    engine.setTrackClosed("platform-b", false, "manual");
    await engine.moveTrain("blue", "regional-exit", { origin: "webmcp" });
    engine.setSwitch("main-switch", "platform-b", "webmcp");
    await engine.moveTrain("yellow", "platform-b", { origin: "webmcp" });

    const closeOccupied = engine.setTrackClosed("platform-b", true, "manual");
    expect(closeOccupied.ok).toBe(false);
    if (!closeOccupied.ok) {
      expect(closeOccupied.code).toBe("TRACK_IN_USE");
    }
  });

  it("prevents batched parallel Promise.all races on shared track", async () => {
    const { driver, pending } = createDeferredDriver();
    const engine = new SwitchyardEngine(driver);

    const [blueResPromise, yellowResPromise, doubleBluePromise] = [
      engine.moveTrain("blue", "regional-exit", { origin: "webmcp" }),
      engine.moveTrain("yellow", "platform-a", { origin: "webmcp" }),
      engine.moveTrain("blue", "regional-exit", { origin: "webmcp" }),
    ];

    const yellowRes = await yellowResPromise;
    const doubleBlueRes = await doubleBluePromise;

    expect(yellowRes.ok).toBe(false);
    if (!yellowRes.ok) {
      expect(yellowRes.code).toBe("TRACK_OCCUPIED");
    }
    expect(doubleBlueRes.ok).toBe(false);
    if (!doubleBlueRes.ok) {
      expect(doubleBlueRes.code).toBe("TRAIN_ALREADY_MOVING");
    }

    pending[0].resolve();
    const blueRes = await blueResPromise;
    expect(blueRes.ok).toBe(true);
  });

  it("keeps post-reset state intact when a stale mid-move animation promise finishes later", async () => {
    const { driver, pending } = createDeferredDriver();
    const engine = new SwitchyardEngine(driver);

    // Run 1: start moving Blue toward regional-exit
    const staleMovePromise = engine.moveTrain("blue", "regional-exit", {
      origin: "webmcp",
    });
    expect(pending).toHaveLength(1);
    expect(pending[0].request.signal.aborted).toBe(false);
    expect(engine.getSnapshot().tracks["regional-exit"].reservedBy).toBe(
      "blue",
    );

    // Reset mid-movement!
    const afterReset = engine.reset();
    expect(pending[0].request.signal.aborted).toBe(true);
    expect(afterReset.trains.blue.trackId).toBe("shared");
    expect(afterReset.trains.blue.status).toBe("idle");
    expect(afterReset.tracks["regional-exit"].reservedBy).toBeNull();
    expect(afterReset.selectedTrainId).toBeNull();
    expect(afterReset.pinnedDestinationId).toBeNull();

    // Start a fresh Run 2 move right after reset
    const newMovePromise = engine.moveTrain("blue", "regional-exit", {
      origin: "webmcp",
    });
    expect(pending).toHaveLength(2);
    expect(engine.getSnapshot().tracks["regional-exit"].reservedBy).toBe(
      "blue",
    );

    // Now the OLD Run 1 promise finally resolves late!
    pending[0].resolve();
    const staleResult = await staleMovePromise;
    expect(staleResult.ok).toBe(false);
    if (!staleResult.ok) {
      expect(staleResult.code).toBe("SCENARIO_RESET");
    }

    // Run 2's active reservation and state must remain completely untouched
    expect(engine.getSnapshot().trains.blue.status).toBe("moving");
    expect(engine.getSnapshot().tracks["regional-exit"].reservedBy).toBe(
      "blue",
    );
    expect(
      engine
        .getSnapshot()
        .actionLog.some((e) => e.ok && e.action === "move_train"),
    ).toBe(false);

    // Finish Run 2 cleanly
    pending[1].resolve();
    const newResult = await newMovePromise;
    expect(newResult).toMatchObject({
      ok: true,
      status: "arrived",
      arrivedAtTrackId: "regional-exit",
    });
  });

  it("supports ordered multi-annotations (#1, #2, #3...) with optional notes, re-indexing, and reset cleanup", async () => {
    const engine = new SwitchyardEngine();

    engine.toggleAnnotation("yellow", "freight consist to park");
    engine.toggleAnnotation("platform-a", "target bay");
    engine.toggleAnnotation("blue");
    engine.toggleAnnotation("main-switch", "align after blue clears");

    let snap = engine.getSnapshot();
    expect(snap.annotations).toEqual([
      {
        pin: "#1",
        order: 1,
        entityType: "train",
        entityId: "yellow",
        label: "Yellow Freight",
        locationTrackId: "entry",
        note: "freight consist to park",
      },
      {
        pin: "#2",
        order: 2,
        entityType: "platform",
        entityId: "platform-a",
        label: "Platform A (Water Tower)",
        note: "target bay",
      },
      {
        pin: "#3",
        order: 3,
        entityType: "train",
        entityId: "blue",
        label: "Blue Regional",
        locationTrackId: "shared",
        note: null,
      },
      {
        pin: "#4",
        order: 4,
        entityType: "switch",
        entityId: "main-switch",
        label: "Main Switch",
        note: "align after blue clears",
      },
    ]);

    // Update note & remove middle annotation #2 -> remaining items re-index sequentially
    engine.setAnnotationNote("blue", "dispatch first");
    engine.removeAnnotation("platform-a");

    snap = engine.getSnapshot();
    expect(snap.annotations.map((a) => [a.pin, a.entityId, a.note])).toEqual([
      ["#1", "yellow", "freight consist to park"],
      ["#2", "blue", "dispatch first"],
      ["#3", "main-switch", "align after blue clears"],
    ]);

    // Live locationTrackId updates on annotated train after move
    await engine.moveTrain("blue", "regional-exit", { origin: "webmcp" });
    const bluePin = engine
      .getScenePayload()
      .annotations.find((a) => a.entityId === "blue");
    expect(bluePin?.locationTrackId).toBe("regional-exit");

    // Reset clears all annotations
    engine.reset();
    expect(engine.getSnapshot().annotations).toEqual([]);
    expect(engine.getSnapshot().selectedTrainId).toBeNull();
    expect(engine.getSnapshot().pinnedDestinationId).toBeNull();
  });

  it("rolls back reservations cleanly when external AbortSignal aborts without reset", async () => {
    const engine = new SwitchyardEngine();
    await engine.moveTrain("blue", "regional-exit", { origin: "manual" });

    // Attach deferred driver for yellow's move
    const { driver: d2, pending: p2 } = createDeferredDriver();
    engine.setMovementDriver(d2);
    engine.setSwitch("main-switch", "platform-a", "manual");

    const controller = new AbortController();
    const movePromise = engine.moveTrain("yellow", "platform-a", {
      origin: "webmcp",
      signal: controller.signal,
    });
    expect(p2).toHaveLength(1);
    expect(engine.getSnapshot().tracks.shared.reservedBy).toBe("yellow");
    expect(engine.getSnapshot().tracks["platform-a"].reservedBy).toBe("yellow");

    controller.abort();
    p2[0].resolve();
    const result = await movePromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CANCELLED");
    }
    const snap = engine.getSnapshot();
    expect(snap.trains.yellow.trackId).toBe("entry");
    expect(snap.trains.yellow.status).toBe("idle");
    expect(snap.tracks.shared.reservedBy).toBeNull();
    expect(snap.tracks["platform-a"].reservedBy).toBeNull();
  });
});
