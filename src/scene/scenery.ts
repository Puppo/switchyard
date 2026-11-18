import * as THREE from "three";

/**
 * Adds studio tabletop surroundings and stylized miniature landscape scenery
 * (conifer trees, granite boulders, mileposts) outside all railway clearance zones.
 */
export function buildDioramaScenery(): THREE.Group {
  const group = new THREE.Group();

  // Wide tabletop studio floor beneath the walnut plinth
  const tabletop = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 140),
    new THREE.MeshStandardMaterial({
      color: 0x263142,
      roughness: 0.92,
      metalness: 0.05,
    }),
  );
  tabletop.rotation.x = -Math.PI / 2;
  tabletop.position.y = -1.04;
  tabletop.receiveShadow = true;
  group.add(tabletop);

  // Stylized miniature conifers positioned strictly clear of track corridors
  const treeSpots: readonly [number, number, number][] = [
    [-12.8, -6.4, 1.05],
    [-10.4, -7.2, 0.85],
    [-7.8, -6.8, 1.15],
    [-5.4, -7.1, 0.9],
    [-12.5, 5.8, 1.1],
    [-9.6, 6.9, 0.95],
    [-6.2, 6.5, 1.05],
    [-3.1, -6.9, 0.92],
    [-1.4, 6.8, 0.88],
    [1.8, -7.2, 1.0],
    [3.8, 7.2, 1.12],
    [13.4, -2.5, 0.85],
    [13.5, 2.5, 0.9],
    [-13.5, 2.9, 0.82],
  ];

  for (const [x, z, scale] of treeSpots) {
    const tree = buildConiferTree(scale);
    tree.position.set(x, 0, z);
    group.add(tree);
  }

  // Granite rock clusters on non-track corners
  const rocks: readonly [number, number, number][] = [
    [-13.0, -4.5, 0.45],
    [-4.2, -5.8, 0.36],
    [-4.5, 5.4, 0.42],
    [1.9, 6.2, 0.38],
    [13.1, -7.4, 0.44],
  ];
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x78716c,
    roughness: 0.92,
  });
  for (const [x, z, r] of rocks) {
    const boulder = new THREE.Mesh(
      new THREE.DodecahedronGeometry(r, 0),
      rockMat,
    );
    boulder.position.set(x, r * 0.42, z);
    boulder.rotation.set(x * 0.4, z * 0.7, 0.2);
    boulder.scale.set(1.2, 0.72, 0.95);
    boulder.castShadow = true;
    boulder.receiveShadow = true;
    group.add(boulder);
  }

  // Trackside mileposts along the mainline
  for (const mx of [-7.0, -3.5, 4.0, 8.2]) {
    const post = buildMilepost();
    post.position.set(mx, 0, 1.35);
    group.add(post);
  }

  return group;
}

function buildConiferTree(scale: number): THREE.Group {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 0.55, 7),
    new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 }),
  );
  trunk.position.y = 0.27;
  trunk.castShadow = true;
  tree.add(trunk);

  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0x2f5a3a,
    roughness: 0.88,
  });
  const tiers: readonly [number, number, number][] = [
    [0.62, 0.95, 0.82],
    [0.48, 0.8, 1.32],
    [0.34, 0.68, 1.78],
  ];
  for (const [radius, height, y] of tiers) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(radius, height, 8),
      foliageMat,
    );
    cone.position.y = y;
    cone.castShadow = true;
    cone.receiveShadow = true;
    tree.add(cone);
  }

  tree.scale.setScalar(scale);
  return tree;
}

function buildMilepost(): THREE.Group {
  const post = new THREE.Group();
  const stem = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.4, 0.06),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6 }),
  );
  stem.position.y = 0.2;
  stem.castShadow = true;
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.1, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 }),
  );
  cap.position.y = 0.36;
  post.add(stem, cap);
  return post;
}
