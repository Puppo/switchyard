import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SwitchyardEngine } from "../engine/simulation.js";
import type {
  AnnotatableEntityId,
  EngineSnapshot,
  MovementRequest,
  PlatformId,
  SceneAnnotation,
  TrackId,
  TrainId,
} from "../engine/types.js";
import {
  buildAnnotationPinMesh,
  buildBoardBase,
  buildLandmarksAndPlatforms,
  buildSwitchVisual,
  buildTrackSegmentVisual,
  buildTrainVisual,
  getBranchYawAngle,
  type PickUserData,
  type PlatformVisual,
  type SwitchVisual,
  type TrackVisual,
  type TrainVisual,
} from "./geometry.js";
import { BERTH_POSITIONS, buildRouteSpline } from "./paths.js";
import { buildDioramaScenery } from "./scenery.js";

const PICK_DISTANCE_THRESHOLD_PX = 10;
const PICK_DURATION_THRESHOLD_MS = 800;
const POSITIVE_Z = new THREE.Vector3(0, 0, 1);

const PIN_COLORS = [
  0xf43f5e, // #1 crimson
  0x0ea5e9, // #2 sky blue
  0xf59e0b, // #3 amber
  0x10b981, // #4 emerald
  0xa855f7, // #5 violet
  0xec4899, // #6 rose
  0x14b8a6, // #7 teal
  0xf97316, // #8 orange
] as const;

const PIN_CSS_COLORS = [
  "#e11d48",
  "#0284c7",
  "#d97706",
  "#059669",
  "#9333ea",
  "#db2777",
  "#0d9488",
  "#ea580c",
] as const;

interface ProjectedLabel {
  readonly element: HTMLElement;
  readonly anchor: THREE.Vector3;
}

interface ActivePinEntry {
  annotation: SceneAnnotation;
  colorIndex: number;
  mesh: THREE.Group;
  readonly cardEl: HTMLDivElement;
  readonly badgeEl: HTMLSpanElement;
  readonly titleEl: HTMLSpanElement;
  readonly inputEl: HTMLInputElement;
  readonly removeBtn: HTMLButtonElement;
}

interface ActiveAnimation {
  readonly trainId: TrainId;
  readonly curve: THREE.CatmullRomCurve3;
  readonly startMs: number;
  readonly durationMs: number;
  readonly reverseOrient: boolean;
  readonly finish: () => void;
}

export interface DioramaSceneOptions {
  readonly container: HTMLElement;
  readonly overlayLayer: HTMLElement;
  readonly engine: SwitchyardEngine;
}

export class SwitchyardDiorama {
  private readonly container: HTMLElement;
  private readonly overlayLayer: HTMLElement;
  private readonly engine: SwitchyardEngine;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer | null = null;
  private readonly controls: OrbitControls | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly colliders: THREE.Object3D[] = [];
  private readonly trackVisuals: Record<TrackId, TrackVisual>;
  private readonly trainVisuals: Record<TrainId, TrainVisual>;
  private readonly platformVisuals: Record<PlatformId, PlatformVisual>;
  private readonly switchVisual: SwitchVisual;
  private readonly projectedLabels: ProjectedLabel[] = [];
  private readonly hoverTooltipEl: HTMLDivElement;
  private activePins = new Map<AnnotatableEntityId, ActivePinEntry>();

  private activePointers = new Set<number>();
  private pointerDownMeta: {
    id: number;
    x: number;
    y: number;
    time: number;
    multiTouch: boolean;
  } | null = null;

  private activeAnimation: ActiveAnimation | null = null;
  private targetSwitchAngle = 0;
  private currentSwitchAngle = 0;
  private resizeObserver: ResizeObserver | null = null;
  private rafId: number | null = null;
  private destroyed = false;
  private colorSchemeQuery: MediaQueryList | null = null;
  private readonly unsubscribe: () => void;

  readonly webglReady: boolean;

  constructor(options: DioramaSceneOptions) {
    this.container = options.container;
    this.overlayLayer = options.overlayLayer;
    this.engine = options.engine;

    const width = Math.max(1, this.container.clientWidth || 1024);
    const height = Math.max(1, this.container.clientHeight || 680);

    this.camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 180);
    this.camera.position.set(0.4, 21.5, 25.5);
    this.updateCameraFraming(width, height);

    this.applyAtmosphere();
    this.setupLighting();

    this.scene.add(buildBoardBase(), buildDioramaScenery());

    const trackIds: readonly TrackId[] = [
      "entry",
      "shared",
      "regional-exit",
      "platform-a",
      "platform-b",
    ];
    const visuals = {} as Record<TrackId, TrackVisual>;
    for (const id of trackIds) {
      const built = buildTrackSegmentVisual(id, this.colliders);
      this.scene.add(built.group);
      visuals[id] = built.visual;
    }
    this.trackVisuals = visuals;

    const builtSwitch = buildSwitchVisual(this.colliders);
    this.scene.add(builtSwitch.group);
    this.switchVisual = builtSwitch.visual;

    const builtLandmarks = buildLandmarksAndPlatforms(this.colliders);
    this.scene.add(builtLandmarks.group);
    this.platformVisuals = builtLandmarks.platforms;

    this.trainVisuals = {
      yellow: buildTrainVisual("yellow", this.colliders),
      blue: buildTrainVisual("blue", this.colliders),
    };
    this.scene.add(
      this.trainVisuals.yellow.group,
      this.trainVisuals.blue.group,
    );

    // Non-interactive floating landmark labels & hover tooltip
    this.projectedLabels.push(
      {
        element: this.createBadge("Platform A · Water Tower", "badge-landmark"),
        anchor: new THREE.Vector3(11.8, 4.35, -7.25),
      },
      {
        element: this.createBadge("Platform B · Canopy", "badge-landmark"),
        anchor: new THREE.Vector3(10.8, 2.55, 7.15),
      },
      {
        element: this.createBadge("Regional Exit", "badge-landmark"),
        anchor: new THREE.Vector3(11.8, 2.8, 0),
      },
    );

    this.hoverTooltipEl = this.createBadge("", "badge-hover");
    this.hoverTooltipEl.hidden = true;

    try {
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.domElement.className = "viewport-canvas";
      renderer.domElement.setAttribute(
        "aria-label",
        "Interactive 3D railway switchyard diorama",
      );
      this.container.appendChild(renderer.domElement);
      this.renderer = renderer;

      const controls = new OrbitControls(this.camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0.4, 0.25, 0);
      controls.minDistance = 11;
      controls.maxDistance = 56;
      controls.maxPolarAngle = Math.PI * 0.45;
      controls.update();
      this.controls = controls;

      this.bindPointerInteractions(renderer.domElement);
      this.observeResize();
      this.webglReady = true;
      this.startLoop();
    } catch {
      this.webglReady = false;
      this.overlayLayer.hidden = true;
      this.renderWebGlFallback();
    }

    this.syncFromSnapshot(this.engine.getSnapshot());
    this.unsubscribe = this.engine.subscribe((snapshot) => {
      this.syncFromSnapshot(snapshot);
    });
    this.engine.setMovementDriver((req) => this.animateMovement(req));
  }

  /**
   * Background-safe MovementDriver: interpolates along the route spline in rAF
   * using wall-clock time while guaranteeing completion via setTimeout if the tab
   * is backgrounded or throttled.
   */
  animateMovement(req: MovementRequest): Promise<void> {
    const durationMs = this.resolveDurationMs(req.route.length);
    if (durationMs <= 0 || req.signal.aborted) {
      return Promise.resolve();
    }

    const curve = buildRouteSpline(req.route);
    const reverseOrient = req.route[req.route.length - 1] === "entry";

    return new Promise<void>((resolve) => {
      let settled = false;
      let timerId: ReturnType<typeof setTimeout> | null = null;

      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
        req.signal.removeEventListener("abort", finish);
        if (this.activeAnimation?.finish === finish) {
          this.activeAnimation = null;
        }
        resolve();
      };

      this.activeAnimation = {
        trainId: req.trainId,
        curve,
        startMs: performance.now(),
        durationMs,
        reverseOrient,
        finish,
      };

      req.signal.addEventListener("abort", finish, { once: true });
      timerId = setTimeout(finish, durationMs + 40);
    });
  }

  dispose(): void {
    this.destroyed = true;
    this.unsubscribe();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.resizeObserver?.disconnect();
    this.colorSchemeQuery?.removeEventListener("change", this.onThemeChange);
    this.controls?.dispose();
    this.renderer?.dispose();
  }

  private readonly onThemeChange = () => {
    this.applyAtmosphere();
  };

  private applyAtmosphere(): void {
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const skyColor = prefersDark ? 0x162032 : 0xdce7f2;
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.FogExp2(skyColor, 0.0085);

    if (
      !this.colorSchemeQuery &&
      typeof window !== "undefined" &&
      window.matchMedia
    ) {
      this.colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
      this.colorSchemeQuery.addEventListener("change", this.onThemeChange);
    }
  }

  private updateCameraFraming(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    this.camera.aspect = aspect;
    if (aspect < 1.35) {
      const targetHalfHorizontalRad = THREE.MathUtils.degToRad(27.5);
      const computedFov = THREE.MathUtils.radToDeg(
        2 *
          Math.atan(Math.tan(targetHalfHorizontalRad) / Math.max(0.45, aspect)),
      );
      this.camera.fov = Math.min(76, Math.max(44, computedFov));
    } else {
      this.camera.fov = 44;
    }
    this.camera.updateProjectionMatrix();
  }

  private resolveDurationMs(segmentCount: number): number {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const override = new URLSearchParams(search).get("moveMs");
    if (override !== null) {
      const parsed = Number(override);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return 240;
    }
    return segmentCount >= 3 ? 1500 : 1050;
  }

  private setupLighting(): void {
    const hemi = new THREE.HemisphereLight(0xf8fafc, 0x334155, 1.15);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff7e6, 2.05);
    sun.position.set(12, 22, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 62;
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 15;
    sun.shadow.camera.bottom = -15;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0xbfdbfe, 0.45);
    rim.position.set(-14, 10, -12);
    this.scene.add(rim);
  }

  private createBadge(text: string, extraClass: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = `scene-badge ${extraClass}`;
    el.textContent = text;
    el.setAttribute("aria-hidden", "true");
    this.overlayLayer.appendChild(el);
    return el;
  }

  private bindPointerInteractions(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointerdown", (e) => {
      this.activePointers.add(e.pointerId);
      if (e.button !== 0 || this.activePointers.size > 1) {
        if (this.pointerDownMeta) {
          this.pointerDownMeta.multiTouch = true;
        }
        return;
      }
      this.pointerDownMeta = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        time: performance.now(),
        multiTouch: false,
      };
    });

    canvas.addEventListener("pointermove", (e) => {
      if (this.activePointers.size > 0) {
        this.hoverTooltipEl.hidden = true;
        return;
      }
      this.updateHoverTooltip(canvas, e.clientX, e.clientY);
    });

    canvas.addEventListener("pointerleave", () => {
      this.hoverTooltipEl.hidden = true;
      canvas.style.cursor = "grab";
    });

    canvas.addEventListener("pointercancel", (e) => {
      this.activePointers.delete(e.pointerId);
      if (this.pointerDownMeta?.id === e.pointerId) {
        this.pointerDownMeta = null;
      }
    });

    canvas.addEventListener("pointerup", (e) => {
      this.activePointers.delete(e.pointerId);
      const down = this.pointerDownMeta;
      if (!down || down.id !== e.pointerId) {
        return;
      }
      this.pointerDownMeta = null;

      if (down.multiTouch || e.button !== 0) {
        return;
      }

      const dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const elapsed = performance.now() - down.time;
      if (
        dist > PICK_DISTANCE_THRESHOLD_PX ||
        elapsed > PICK_DURATION_THRESHOLD_MS
      ) {
        return;
      }

      this.pickAtClientPoint(canvas, e.clientX, e.clientY);
    });
  }

  private raycastAtClientPoint(
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ): PickUserData | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.colliders, false);
    if (hits.length === 0) {
      return null;
    }
    return hits[0].object.userData as PickUserData;
  }

  private updateHoverTooltip(
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ): void {
    const hit = this.raycastAtClientPoint(canvas, clientX, clientY);
    if (!hit) {
      canvas.style.cursor = "grab";
      this.hoverTooltipEl.hidden = true;
      return;
    }

    canvas.style.cursor = "pointer";
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top - 14;
    this.hoverTooltipEl.textContent = hit.hoverLabel;
    this.hoverTooltipEl.hidden = false;
    this.hoverTooltipEl.style.opacity = "1";
    this.hoverTooltipEl.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }

  private pickAtClientPoint(
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ): void {
    const hit = this.raycastAtClientPoint(canvas, clientX, clientY);
    if (!hit) {
      return;
    }

    if (hit.pickType === "barrier") {
      const currentlyClosed =
        this.engine.getSnapshot().tracks["platform-b"].closed;
      this.engine.setTrackClosed("platform-b", !currentlyClosed, "manual");
      return;
    }

    this.engine.toggleAnnotation(hit.entityId);
  }

  private observeResize(): void {
    this.resizeObserver = new ResizeObserver((entries) => {
      if (!this.renderer || entries.length === 0) {
        return;
      }
      const { width, height } = entries[0].contentRect;
      if (width <= 0 || height <= 0) {
        return;
      }
      this.updateCameraFraming(width, height);
      this.renderer.setSize(width, height, false);
    });
    this.resizeObserver.observe(this.container);
  }

  private getEntityAnchor(entityId: AnnotatableEntityId): THREE.Object3D {
    if (entityId === "yellow" || entityId === "blue") {
      return this.trainVisuals[entityId].pinAnchor;
    }
    if (entityId === "platform-a" || entityId === "platform-b") {
      return this.platformVisuals[entityId].pinAnchor;
    }
    if (entityId === "main-switch") {
      return this.switchVisual.pinAnchor;
    }
    return this.trackVisuals[entityId].pinAnchor;
  }

  /**
   * Reconciles active 3D pin meshes and interactive DOM pin cards in place
   * so typing in a pin's inline note input never loses focus or cursor position.
   */
  private reconcilePins(annotations: readonly SceneAnnotation[]): void {
    const nextIds = new Set(annotations.map((a) => a.entityId));

    for (const [id, entry] of this.activePins.entries()) {
      if (!nextIds.has(id)) {
        entry.mesh.parent?.remove(entry.mesh);
        entry.cardEl.remove();
        this.activePins.delete(id);
      }
    }

    for (const ann of annotations) {
      const colorIdx = (ann.order - 1) % PIN_COLORS.length;
      const cssColor = PIN_CSS_COLORS[colorIdx];
      const existing = this.activePins.get(ann.entityId);

      if (existing) {
        existing.annotation = ann;
        if (existing.colorIndex !== colorIdx) {
          existing.colorIndex = colorIdx;
          const parent = existing.mesh.parent;
          parent?.remove(existing.mesh);
          const nextMesh = buildAnnotationPinMesh(PIN_COLORS[colorIdx]);
          parent?.add(nextMesh);
          existing.mesh = nextMesh;
        }
        existing.badgeEl.textContent = ann.pin;
        existing.badgeEl.style.backgroundColor = cssColor;
        existing.cardEl.style.borderColor = cssColor;
        existing.removeBtn.setAttribute(
          "aria-label",
          `Remove ${ann.pin} ${ann.label}`,
        );
        existing.inputEl.setAttribute(
          "aria-label",
          `Note for ${ann.pin} ${ann.label}`,
        );
        if (document.activeElement !== existing.inputEl) {
          existing.inputEl.value = ann.note ?? "";
        }
        continue;
      }

      const mesh = buildAnnotationPinMesh(PIN_COLORS[colorIdx]);
      this.getEntityAnchor(ann.entityId).add(mesh);

      const entry = this.createInteractivePinCard(
        ann,
        colorIdx,
        cssColor,
        mesh,
      );
      this.overlayLayer.appendChild(entry.cardEl);
      this.activePins.set(ann.entityId, entry);
    }
  }

  private createInteractivePinCard(
    ann: SceneAnnotation,
    colorIndex: number,
    cssColor: string,
    mesh: THREE.Group,
  ): ActivePinEntry {
    const cardEl = document.createElement("div");
    cardEl.className = "pin-card";
    cardEl.dataset.entityId = ann.entityId;
    cardEl.style.borderColor = cssColor;

    // Isolate pointer/keyboard/wheel events so interacting with a pin card never
    // orbits the 3D camera or triggers canvas picking underneath.
    for (const evt of [
      "pointerdown",
      "pointerup",
      "pointermove",
      "click",
      "dblclick",
      "wheel",
      "keydown",
    ] as const) {
      cardEl.addEventListener(evt, (e) => e.stopPropagation());
    }

    const header = document.createElement("div");
    header.className = "pin-card-header";

    const badgeEl = document.createElement("span");
    badgeEl.className = "pin-badge mono";
    badgeEl.textContent = ann.pin;
    badgeEl.style.backgroundColor = cssColor;

    const titleEl = document.createElement("span");
    titleEl.className = "pin-card-title";
    titleEl.textContent = ann.label;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "pin-card-remove";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove ${ann.pin} ${ann.label}`);
    removeBtn.addEventListener("click", () => {
      this.engine.removeAnnotation(ann.entityId);
    });

    header.append(badgeEl, titleEl, removeBtn);

    const inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.className = "pin-card-input";
    inputEl.maxLength = 80;
    inputEl.placeholder = "Add note…";
    inputEl.value = ann.note ?? "";
    inputEl.setAttribute("aria-label", `Note for ${ann.pin} ${ann.label}`);
    inputEl.addEventListener("input", () => {
      this.engine.setAnnotationNote(ann.entityId, inputEl.value);
    });

    cardEl.append(header, inputEl);

    return {
      annotation: ann,
      colorIndex,
      mesh,
      cardEl,
      badgeEl,
      titleEl,
      inputEl,
      removeBtn,
    };
  }

  private syncFromSnapshot(snapshot: EngineSnapshot): void {
    const annotatedIds = new Set(snapshot.annotations.map((a) => a.entityId));

    // 1. Trains: snap idle trains to logical berths, toggle selection halos.
    for (const trainId of ["yellow", "blue"] as const) {
      const state = snapshot.trains[trainId];
      const visual = this.trainVisuals[trainId];
      visual.selectionRing.visible = annotatedIds.has(trainId);

      if (state.status === "idle") {
        if (this.activeAnimation?.trainId === trainId) {
          this.activeAnimation = null;
        }
        visual.group.position.copy(BERTH_POSITIONS[state.trackId]);
        visual.group.quaternion.setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          Math.PI / 2,
        );
      }
    }

    // 2. Numbered multi-annotation 3D pins + interactive inline cards
    this.reconcilePins(snapshot.annotations);

    // 3. Switch lock lamp reflects active movement/reservation only (idle blue allows aligning).
    const mainSwitch = snapshot.switches["main-switch"];
    this.targetSwitchAngle = getBranchYawAngle(mainSwitch.activeBranchId);
    const shared = snapshot.tracks.shared;
    const isLocked =
      shared.reservedBy !== null ||
      (shared.occupiedBy !== null &&
        snapshot.trains[shared.occupiedBy].status === "moving") ||
      snapshot.tracks[mainSwitch.activeBranchId].reservedBy !== null;
    this.switchVisual.lockLampMaterial.color.setHex(
      isLocked ? 0xef4444 : 0x10b981,
    );
    this.switchVisual.lockLampMaterial.emissive.setHex(
      isLocked ? 0xdc2626 : 0x059669,
    );

    // 4. Track occupation, reservation, and closure states.
    for (const id of [
      "entry",
      "shared",
      "regional-exit",
      "platform-a",
      "platform-b",
    ] as const) {
      const track = snapshot.tracks[id];
      const visual = this.trackVisuals[id];
      if (track.closed) {
        visual.stripMaterial.color.setHex(0xef4444);
        visual.stripMaterial.emissive.setHex(0x7f1d1d);
      } else if (track.reservedBy !== null) {
        visual.stripMaterial.color.setHex(0xf59e0b);
        visual.stripMaterial.emissive.setHex(0x78350f);
      } else if (track.occupiedBy !== null) {
        visual.stripMaterial.color.setHex(
          track.occupiedBy === "yellow" ? 0xeab308 : 0x3b82f6,
        );
        visual.stripMaterial.emissive.setHex(0x1e293b);
      } else if (annotatedIds.has(id)) {
        visual.stripMaterial.color.setHex(0x38bdf8);
        visual.stripMaterial.emissive.setHex(0x0369a1);
      } else {
        visual.stripMaterial.color.setHex(0x475569);
        visual.stripMaterial.emissive.setHex(0x000000);
      }

      if (visual.barrierPivot) {
        const signZ = id === "platform-a" ? -1 : 1;
        visual.barrierPivot.rotation.x = track.closed ? 0 : signZ * -1.25;
      }
      if (visual.barrierLampMaterial) {
        visual.barrierLampMaterial.color.setHex(
          track.closed ? 0xef4444 : 0x10b981,
        );
        visual.barrierLampMaterial.emissive.setHex(
          track.closed ? 0xdc2626 : 0x059669,
        );
      }
    }

    if (this.webglReady) {
      this.scene.updateMatrixWorld(true);
      this.updateOverlayLabels();
    }
  }

  private startLoop(): void {
    const tick = (frameTime: number) => {
      if (this.destroyed) {
        return;
      }
      this.rafId = requestAnimationFrame(tick);

      // Smoothly damp switch blades & indicator vane toward active branch.
      this.currentSwitchAngle +=
        (this.targetSwitchAngle - this.currentSwitchAngle) * 0.2;
      this.switchVisual.bladePivot.rotation.y = this.currentSwitchAngle * 0.45;
      this.switchVisual.vanePivot.rotation.y = this.currentSwitchAngle;

      // Subtle bob on every active 3D annotation pin.
      for (const pin of this.activePins.values()) {
        pin.mesh.position.y =
          Math.sin(frameTime * 0.004 + pin.annotation.order * 0.8) * 0.09;
      }

      // Advance active train movement along route spline on wall-clock basis.
      if (this.activeAnimation) {
        const anim = this.activeAnimation;
        const rawT = Math.min(
          1,
          Math.max(0, (performance.now() - anim.startMs) / anim.durationMs),
        );
        const eased =
          rawT < 0.5 ? 2 * rawT * rawT : 1 - (-2 * rawT + 2) ** 2 / 2;
        const pos = anim.curve.getPointAt(eased);
        const tangent = anim.curve.getTangentAt(eased).setY(0).normalize();
        const heading = anim.reverseOrient ? tangent.negate() : tangent;

        const visual = this.trainVisuals[anim.trainId];
        visual.group.position.copy(pos);
        visual.group.quaternion.setFromUnitVectors(POSITIVE_Z, heading);

        if (rawT >= 1) {
          anim.finish();
        }
      }

      this.controls?.update();
      this.renderer?.render(this.scene, this.camera);
      this.updateOverlayLabels();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private updateOverlayLabels(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }

    for (const item of this.projectedLabels) {
      this.projectElementToWorld(
        item.element,
        item.anchor,
        width,
        height,
        false,
      );
    }

    const worldPos = new THREE.Vector3();
    for (const pin of this.activePins.values()) {
      pin.mesh.getWorldPosition(worldPos);
      worldPos.y += 1.48;
      this.projectElementToWorld(pin.cardEl, worldPos, width, height, true);
    }
  }

  private projectElementToWorld(
    el: HTMLElement,
    worldPos: THREE.Vector3,
    width: number,
    height: number,
    interactive: boolean,
  ): void {
    const ndc = worldPos.clone().project(this.camera);
    const visible = ndc.z >= -1 && ndc.z <= 1;
    if (!visible) {
      el.style.opacity = "0";
      if (interactive) {
        el.style.visibility = "hidden";
        el.style.pointerEvents = "none";
      }
      return;
    }
    const x = Math.round((ndc.x * 0.5 + 0.5) * width * 2) / 2;
    const y = Math.round((-ndc.y * 0.5 + 0.5) * height * 2) / 2;
    el.style.opacity = "1";
    if (interactive) {
      el.style.visibility = "visible";
      el.style.pointerEvents = "auto";
    }
    el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
  }

  private renderWebGlFallback(): void {
    const note = document.createElement("div");
    note.className = "webgl-fallback";
    const title = document.createElement("strong");
    title.textContent =
      "3D WebGL viewport unavailable in this browser context.";
    const body = document.createElement("p");
    body.textContent =
      "WebMCP tools (get_scene, set_switch, move_train) remain active for your browser AI agent.";
    note.append(title, body);
    this.container.appendChild(note);
  }
}
