import * as THREE from 'three';
import {
  TABLE_WIDTH,
  TABLE_LENGTH,
  BALL_RADIUS,
  POCKET_RADIUS,
} from '../game/constants.js';

const BALL_COLORS = [
  '#f4f0dc', '#e7bd22', '#245fbd', '#c83932', '#75489c', '#df7928', '#24734d', '#7b1f2b',
  '#171a1c', '#e7bd22', '#245fbd', '#c83932', '#75489c', '#df7928', '#24734d', '#7b1f2b',
];

const SNOOKER_COLORS = {
  cue: '#f4f0dc',
  red: '#b91f2e',
  yellow: '#e7bd22',
  green: '#176b45',
  brown: '#75452e',
  blue: '#245fbd',
  pink: '#e58ca5',
  black: '#171a1c',
};

const clamp = THREE.MathUtils.clamp;

export function createTableScene(container, game) {
  if (!container) throw new Error('createTableScene requires a container');

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.style.outline = 'none';
  canvas.setAttribute('aria-label', '三维台球桌，右键拖动旋转，滚轮缩放');
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#081312');
  scene.fog = new THREE.Fog('#081312', 13, 28);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
  const cameraTarget = new THREE.Vector3(0, -0.08, 0);
  let viewWidth = 1;
  let viewHeight = 1;
  let disposed = false;
  let elapsed = 0;
  let userMovedCamera = false;

  const defaultDistance = () => {
    const aspect = Math.max(0.35, viewWidth / Math.max(1, viewHeight));
    return aspect < 1 ? Math.min(13.2, 7.4 / aspect) : 7.85;
  };
  const distanceLimits = () => {
    const fit = defaultDistance();
    return { min: Math.max(4.1, fit * 0.62), max: Math.max(11.5, fit * 1.55) };
  };

  const cameraGoal = { theta: 0, phi: 0.64, radius: 7.85 };
  const cameraNow = { ...cameraGoal };
  const aimPointer = new THREE.Vector2();
  const aimRaycaster = new THREE.Raycaster();
  const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const aimPoint = new THREE.Vector3();

  const hemi = new THREE.HemisphereLight('#c9e7df', '#20130e', 1.55);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight('#fff0d2', 3.15);
  keyLight.position.set(-3.8, 7.5, 4.6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -4.8;
  keyLight.shadow.camera.right = 4.8;
  keyLight.shadow.camera.top = 5.2;
  keyLight.shadow.camera.bottom = -5.2;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 18;
  keyLight.shadow.bias = -0.00015;
  keyLight.shadow.normalBias = 0.018;
  keyLight.shadow.radius = 4;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight('#8fc6d8', 0.8);
  fillLight.position.set(4, 3.5, -4);
  scene.add(fillLight);

  const warmLight = new THREE.SpotLight('#ffc786', 52, 18, 0.72, 1, 1.4);
  warmLight.position.set(3.8, 5.5, -2.5);
  warmLight.target.position.set(0, 0, 0);
  scene.add(warmLight, warmLight.target);

  function canvasTexture(width, height, paint) {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    const context = surface.getContext('2d');
    paint(context, width, height);
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  let randomSeed = 7319;
  const random = () => {
    randomSeed = (randomSeed * 16807) % 2147483647;
    return (randomSeed - 1) / 2147483646;
  };

  const woodTexture = canvasTexture(1024, 256, (ctx, width, height) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#6f3520');
    gradient.addColorStop(0.45, '#4a2115');
    gradient.addColorStop(1, '#2c130e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 150; i += 1) {
      const y = random() * height;
      const amplitude = 1 + random() * 5;
      const frequency = 0.006 + random() * 0.018;
      ctx.beginPath();
      for (let x = -10; x <= width + 10; x += 8) {
        const yy = y + Math.sin(x * frequency + i) * amplitude;
        if (x < 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.strokeStyle = random() > 0.45
        ? `rgba(20,5,2,${0.025 + random() * 0.11})`
        : `rgba(235,145,75,${0.018 + random() * 0.055})`;
      ctx.lineWidth = 0.5 + random() * 1.8;
      ctx.stroke();
    }
    for (let i = 0; i < 14; i += 1) {
      const x = random() * width;
      const y = random() * height;
      ctx.strokeStyle = 'rgba(22,7,3,0.13)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, y, 18 + random() * 45, 3 + random() * 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  woodTexture.wrapS = woodTexture.wrapT = THREE.RepeatWrapping;
  woodTexture.repeat.set(2.5, 1);

  const feltTexture = canvasTexture(256, 256, (ctx, width, height) => {
    ctx.fillStyle = '#176b50';
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 13000; i += 1) {
      const light = random() > 0.52;
      ctx.fillStyle = light ? 'rgba(160,215,175,0.055)' : 'rgba(0,30,21,0.065)';
      ctx.fillRect(random() * width, random() * height, 0.6 + random(), 0.6 + random());
    }
  });
  feltTexture.wrapS = feltTexture.wrapT = THREE.RepeatWrapping;
  feltTexture.repeat.set(4, 8);

  const woodMaterial = new THREE.MeshPhysicalMaterial({
    map: woodTexture,
    color: '#c99a80',
    roughness: 0.32,
    metalness: 0.02,
    clearcoat: 0.42,
    clearcoatRoughness: 0.25,
  });
  const darkWoodMaterial = new THREE.MeshStandardMaterial({
    map: woodTexture,
    color: '#795247',
    roughness: 0.48,
  });
  const cushionMaterial = new THREE.MeshStandardMaterial({
    color: '#105c45',
    roughness: 0.88,
  });
  const clothMaterial = new THREE.MeshStandardMaterial({
    map: feltTexture,
    bumpMap: feltTexture,
    bumpScale: 0.0035,
    color: '#b8d8c8',
    roughness: 0.96,
  });
  const brassMaterial = new THREE.MeshStandardMaterial({
    color: '#bfa16a',
    metalness: 0.72,
    roughness: 0.3,
  });
  const pocketMaterial = new THREE.MeshStandardMaterial({
    color: '#030605',
    roughness: 0.98,
  });
  const leatherMaterial = new THREE.MeshStandardMaterial({
    color: '#15110f',
    roughness: 0.77,
  });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: '#111a19', roughness: 0.94, metalness: 0.03 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.85;
  floor.receiveShadow = true;
  scene.add(floor);

  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(7.8, 9.4),
    new THREE.MeshStandardMaterial({ color: '#10241f', roughness: 1 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = -0.846;
  rug.receiveShadow = true;
  scene.add(rug);

  const table = new THREE.Group();
  scene.add(table);

  function addBox(width, height, depth, x, y, z, material, parent = table) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  addBox(TABLE_WIDTH + 0.34, 0.13, TABLE_LENGTH + 0.34, 0, -0.065, 0, darkWoodMaterial);
  addBox(TABLE_WIDTH + 0.55, 0.3, 0.15, 0, -0.23, TABLE_LENGTH / 2 + 0.18, darkWoodMaterial);
  addBox(TABLE_WIDTH + 0.55, 0.3, 0.15, 0, -0.23, -TABLE_LENGTH / 2 - 0.18, darkWoodMaterial);
  addBox(0.15, 0.3, TABLE_LENGTH + 0.25, TABLE_WIDTH / 2 + 0.18, -0.23, 0, darkWoodMaterial);
  addBox(0.15, 0.3, TABLE_LENGTH + 0.25, -TABLE_WIDTH / 2 - 0.18, -0.23, 0, darkWoodMaterial);

  const bed = addBox(TABLE_WIDTH, 0.08, TABLE_LENGTH, 0, -0.04, 0, cushionMaterial);
  bed.castShadow = false;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(TABLE_WIDTH, TABLE_LENGTH), clothMaterial);
  cloth.rotation.x = -Math.PI / 2;
  cloth.position.y = 0.002;
  cloth.receiveShadow = true;
  table.add(cloth);

  const snookerMarkings = new THREE.Group();
  snookerMarkings.visible = false;
  table.add(snookerMarkings);
  const markingMaterial = new THREE.LineBasicMaterial({
    color: '#d8e6d8',
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
  });
  const baulkZ = TABLE_LENGTH * 0.32;
  const baulkLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-TABLE_WIDTH / 2, 0.007, baulkZ),
      new THREE.Vector3(TABLE_WIDTH / 2, 0.007, baulkZ),
    ]),
    markingMaterial,
  );
  snookerMarkings.add(baulkLine);
  const dRadius = TABLE_WIDTH * 0.18;
  const dPoints = [];
  for (let i = 0; i <= 48; i += 1) {
    const angle = (i / 48) * Math.PI;
    dPoints.push(new THREE.Vector3(
      Math.cos(angle) * dRadius,
      0.007,
      baulkZ + Math.sin(angle) * dRadius,
    ));
  }
  const dLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(dPoints), markingMaterial);
  snookerMarkings.add(dLine);

  const railWidth = 0.25;
  const railHeight = 0.24;
  const railY = 0.065;
  const railOffset = TABLE_WIDTH / 2 + 0.25;
  const endRailOffset = TABLE_LENGTH / 2 + 0.25;
  addBox(railWidth, railHeight, TABLE_LENGTH + 0.75, railOffset, railY, 0, woodMaterial);
  addBox(railWidth, railHeight, TABLE_LENGTH + 0.75, -railOffset, railY, 0, woodMaterial);
  addBox(TABLE_WIDTH + 0.25, railHeight, railWidth, 0, railY, endRailOffset, woodMaterial);
  addBox(TABLE_WIDTH + 0.25, railHeight, railWidth, 0, railY, -endRailOffset, woodMaterial);

  const trimY = railY + railHeight / 2 + 0.003;
  addBox(0.018, 0.007, TABLE_LENGTH + 0.48, railOffset + 0.082, trimY, 0, brassMaterial);
  addBox(0.018, 0.007, TABLE_LENGTH + 0.48, -railOffset - 0.082, trimY, 0, brassMaterial);
  addBox(TABLE_WIDTH + 0.12, 0.007, 0.018, 0, trimY, endRailOffset + 0.082, brassMaterial);
  addBox(TABLE_WIDTH + 0.12, 0.007, 0.018, 0, trimY, -endRailOffset - 0.082, brassMaterial);

  const cushionWidth = 0.15;
  const cushionHeight = 0.17;
  const cornerGap = POCKET_RADIUS * 1.42;
  const sideGap = POCKET_RADIUS * 1.27;
  const longSegment = (TABLE_LENGTH - 2 * cornerGap - 2 * sideGap) / 2;
  const longCenter = sideGap + longSegment / 2;
  for (const side of [-1, 1]) {
    const x = side * (TABLE_WIDTH / 2 + cushionWidth / 2);
    addBox(cushionWidth, cushionHeight, longSegment, x, cushionHeight / 2, longCenter, cushionMaterial);
    addBox(cushionWidth, cushionHeight, longSegment, x, cushionHeight / 2, -longCenter, cushionMaterial);
  }
  for (const end of [-1, 1]) {
    addBox(
      TABLE_WIDTH - 2 * cornerGap,
      cushionHeight,
      cushionWidth,
      0,
      cushionHeight / 2,
      end * (TABLE_LENGTH / 2 + cushionWidth / 2),
      cushionMaterial,
    );
  }

  const pocketPositions = [
    [-TABLE_WIDTH / 2, -TABLE_LENGTH / 2],
    [TABLE_WIDTH / 2, -TABLE_LENGTH / 2],
    [-TABLE_WIDTH / 2, 0],
    [TABLE_WIDTH / 2, 0],
    [-TABLE_WIDTH / 2, TABLE_LENGTH / 2],
    [TABLE_WIDTH / 2, TABLE_LENGTH / 2],
  ];
  const pocketGeometry = new THREE.CylinderGeometry(POCKET_RADIUS * 0.94, POCKET_RADIUS * 0.82, 0.25, 48);
  const pocketRimGeometry = new THREE.TorusGeometry(POCKET_RADIUS, 0.017, 10, 48);
  for (const [x, z] of pocketPositions) {
    const pocket = new THREE.Mesh(pocketGeometry, pocketMaterial);
    pocket.position.set(x, 0.061, z);
    pocket.receiveShadow = true;
    table.add(pocket);
    const rim = new THREE.Mesh(pocketRimGeometry, leatherMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, 0.188, z);
    rim.castShadow = true;
    table.add(rim);
  }

  const sightGeometry = new THREE.CylinderGeometry(0.021, 0.021, 0.006, 16);
  const sightMaterial = new THREE.MeshStandardMaterial({ color: '#e5d9b7', roughness: 0.3, metalness: 0.15 });
  const addSight = (x, z) => {
    const sight = new THREE.Mesh(sightGeometry, sightMaterial);
    sight.position.set(x, trimY + 0.005, z);
    table.add(sight);
  };
  for (const side of [-1, 1]) {
    for (const z of [-1.8, -1.2, -0.6, 0.6, 1.2, 1.8]) {
      addSight(side * railOffset, z);
    }
    for (const x of [-0.8, -0.4, 0.4, 0.8]) {
      addSight(x, side * endRailOffset);
    }
  }

  const legGeometry = new THREE.CylinderGeometry(0.12, 0.17, 0.62, 8);
  const footGeometry = new THREE.CylinderGeometry(0.16, 0.17, 0.065, 16);
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const leg = new THREE.Mesh(legGeometry, darkWoodMaterial);
      leg.position.set(x * (TABLE_WIDTH / 2 + 0.03), -0.52, z * (TABLE_LENGTH / 2 - 0.42));
      leg.castShadow = true;
      table.add(leg);
      const foot = new THREE.Mesh(footGeometry, brassMaterial);
      foot.position.set(leg.position.x, -0.81, leg.position.z);
      foot.castShadow = true;
      table.add(foot);
    }
  }

  const ballGeometry = new THREE.SphereGeometry(1, 40, 28);
  const ballVisuals = new Map();
  const rollAxis = new THREE.Vector3();
  let ballRadius = BALL_RADIUS;

  function makeBallTexture(number, kind, variant) {
    return canvasTexture(1024, 512, (ctx, width, height) => {
      const color = (variant === 'snooker' ? SNOOKER_COLORS[kind] : BALL_COLORS[number]) || '#dddddd';
      const striped = variant !== 'snooker' && (kind === 'stripe' || (variant === 'nineball' && number === 9));
      ctx.fillStyle = striped ? '#eee9d8' : color;
      ctx.fillRect(0, 0, width, height);
      if (striped) {
        const stripe = ctx.createLinearGradient(0, height * 0.25, 0, height * 0.75);
        stripe.addColorStop(0, color);
        stripe.addColorStop(0.5, color);
        stripe.addColorStop(1, color);
        ctx.fillStyle = stripe;
        ctx.fillRect(0, height * 0.25, width, height * 0.5);
      }
      if (kind === 'cue') {
        ctx.fillStyle = 'rgba(157,40,31,0.8)';
        for (const x of [width * 0.2, width * 0.7]) {
          ctx.beginPath();
          ctx.arc(x, height * 0.48, 10, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      if (variant === 'snooker') return;
      for (const [u, v] of [[0.25, 0.36], [0.75, 0.36], [0.25, 0.64], [0.75, 0.64]]) {
        const x = u * width;
        const y = v * height;
        const radius = height * 0.105;
        ctx.fillStyle = '#f4f0df';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(30,25,20,0.15)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#141716';
        ctx.font = `700 ${number > 9 ? 67 : 76}px Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(number), x, y + 3);
      }
    });
  }

  function createBallVisual(ball, variant, radius) {
    const root = new THREE.Group();
    const rolling = new THREE.Group();
    root.add(rolling);
    const texture = makeBallTexture(ball.number, ball.kind, variant);
    const material = new THREE.MeshPhysicalMaterial({
      map: texture,
      roughness: 0.2,
      metalness: 0.015,
      clearcoat: 0.62,
      clearcoatRoughness: 0.14,
    });
    const sphere = new THREE.Mesh(ballGeometry, material);
    sphere.scale.setScalar(radius);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    rolling.add(sphere);
    if (ball.kind !== 'cue') {
      const number = Number.isFinite(ball.number) ? ball.number : 0;
      rolling.rotation.set(number * 0.17, number * 0.71, number * 0.09);
    }
    root.position.set(
      Number.isFinite(ball.x) ? ball.x : 0,
      radius,
      Number.isFinite(ball.z) ? ball.z : 0,
    );
    scene.add(root);
    const visual = {
      root,
      rolling,
      sphere,
      number: ball.number,
      kind: ball.kind,
      variant,
      spinDot: null,
    };
    if (ball.kind === 'cue') {
      const spinMaterial = new THREE.MeshBasicMaterial({
        color: '#b94438',
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const spinDot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 24), spinMaterial);
      spinDot.scale.setScalar(radius / BALL_RADIUS);
      spinDot.visible = false;
      root.add(spinDot);
      visual.spinDot = spinDot;
    }
    ballVisuals.set(ball.id, visual);
    return visual;
  }

  function disposeBallVisual(visual) {
    scene.remove(visual.root);
    visual.sphere.material.map?.dispose();
    visual.sphere.material.dispose();
    if (visual.spinDot) {
      visual.spinDot.geometry.dispose();
      visual.spinDot.material.dispose();
    }
  }

  const aimGroup = new THREE.Group();
  aimGroup.visible = false;
  scene.add(aimGroup);

  const aimLineGeometry = new THREE.BufferGeometry();
  aimLineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const aimLineMaterial = new THREE.LineDashedMaterial({
    color: '#e5fff1',
    transparent: true,
    opacity: 0.92,
    dashSize: 0.1,
    gapSize: 0.065,
    depthWrite: false,
  });
  const aimLine = new THREE.Line(aimLineGeometry, aimLineMaterial);
  aimLine.frustumCulled = false;
  aimGroup.add(aimLine);

  const aimGlowMaterial = new THREE.MeshBasicMaterial({
    color: '#9de7c3',
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  const aimGlow = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.002, 1), aimGlowMaterial);
  aimGroup.add(aimGlow);

  const ghostMaterial = new THREE.MeshBasicMaterial({
    color: '#e9fff5',
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ghostRing = new THREE.Mesh(
    new THREE.RingGeometry(BALL_RADIUS * 0.88, BALL_RADIUS * 1.06, 48),
    ghostMaterial,
  );
  ghostRing.rotation.x = -Math.PI / 2;
  ghostRing.visible = false;
  scene.add(ghostRing);

  const objectRing = new THREE.Mesh(
    new THREE.RingGeometry(BALL_RADIUS * 1.18, BALL_RADIUS * 1.32, 48),
    new THREE.MeshBasicMaterial({
      color: '#f3cb73',
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  objectRing.rotation.x = -Math.PI / 2;
  objectRing.visible = false;
  scene.add(objectRing);

  const powerRing = new THREE.Mesh(
    new THREE.RingGeometry(BALL_RADIUS * 1.23, BALL_RADIUS * 1.4, 48),
    new THREE.MeshBasicMaterial({
      color: '#8fe1b5',
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  powerRing.rotation.x = -Math.PI / 2;
  powerRing.position.y = 0.013;
  aimGroup.add(powerRing);

  const cueGroup = new THREE.Group();
  aimGroup.add(cueGroup);
  const cueLength = 1.58;
  const cueWoodMaterial = new THREE.MeshPhysicalMaterial({
    color: '#b88047',
    roughness: 0.3,
    clearcoat: 0.5,
    clearcoatRoughness: 0.2,
  });
  const cueShaftGeometry = new THREE.CylinderGeometry(0.0135, 0.025, cueLength, 20);
  cueShaftGeometry.rotateX(Math.PI / 2);
  const cueShaft = new THREE.Mesh(cueShaftGeometry, cueWoodMaterial);
  cueShaft.position.set(0, BALL_RADIUS * 1.08, -(BALL_RADIUS + 0.07 + cueLength / 2));
  cueShaft.castShadow = true;
  cueGroup.add(cueShaft);

  const cueTipGeometry = new THREE.CylinderGeometry(0.0137, 0.0137, 0.065, 20);
  cueTipGeometry.rotateX(Math.PI / 2);
  const cueTip = new THREE.Mesh(
    cueTipGeometry,
    new THREE.MeshStandardMaterial({ color: '#326f70', roughness: 0.8 }),
  );
  cueTip.position.set(0, BALL_RADIUS * 1.08, -(BALL_RADIUS + 0.07 + 0.0325));
  cueGroup.add(cueTip);

  const gripGeometry = new THREE.CylinderGeometry(0.023, 0.027, 0.4, 20);
  gripGeometry.rotateX(Math.PI / 2);
  const grip = new THREE.Mesh(gripGeometry, leatherMaterial);
  grip.position.set(0, BALL_RADIUS * 1.08, -(BALL_RADIUS + 0.07 + cueLength - 0.2));
  grip.castShadow = true;
  cueGroup.add(grip);
  let cuePull = 0;

  const rayDirection = new THREE.Vector2();
  const toBall = new THREE.Vector2();

  function updateBalls(dt) {
    const state = game.state || {};
    const variant = state.variant === 'nineball' || state.variant === 'snooker' ? state.variant : 'eightball';
    const balls = Array.isArray(state.balls) ? state.balls : [];
    ballRadius = Number.isFinite(state.ballRadius) && state.ballRadius > 0 ? state.ballRadius : BALL_RADIUS;
    snookerMarkings.visible = variant === 'snooker';
    const liveIds = new Set();
    for (const ball of balls) {
      liveIds.add(ball.id);
      let visual = ballVisuals.get(ball.id);
      if (visual && (visual.number !== ball.number || visual.kind !== ball.kind || visual.variant !== variant)) {
        disposeBallVisual(visual);
        ballVisuals.delete(ball.id);
        visual = null;
      }
      visual = visual || createBallVisual(ball, variant, ballRadius);
      visual.sphere.scale.setScalar(ballRadius);
      visual.spinDot?.scale.setScalar(ballRadius / BALL_RADIUS);
      const active = ball.active !== false && !ball.pocketed;
      visual.root.visible = active;

      const targetX = Number.isFinite(ball.x) ? ball.x : 0;
      const targetZ = Number.isFinite(ball.z) ? ball.z : 0;
      if (!active) {
        visual.root.position.set(targetX, ballRadius, targetZ);
        continue;
      }

      const follow = 1 - Math.exp(-Math.max(0.001, dt) * 32);
      const oldX = visual.root.position.x;
      const oldZ = visual.root.position.z;
      if (Math.hypot(targetX - oldX, targetZ - oldZ) > ballRadius * 8) {
        visual.root.position.x = targetX;
        visual.root.position.z = targetZ;
      } else {
        visual.root.position.x += (targetX - oldX) * follow;
        visual.root.position.z += (targetZ - oldZ) * follow;
      }
      visual.root.position.y = ballRadius;

      const dx = visual.root.position.x - oldX;
      const dz = visual.root.position.z - oldZ;
      const distance = Math.hypot(dx, dz);
      if (distance > 0.000001 && distance < ballRadius * 4) {
        rollAxis.set(dz, 0, -dx).normalize();
        visual.rolling.rotateOnWorldAxis(rollAxis, distance / ballRadius);
      }
    }
    for (const [id, visual] of ballVisuals) {
      if (!liveIds.has(id)) {
        disposeBallVisual(visual);
        ballVisuals.delete(id);
      }
    }
  }

  function firstAimContact(cue, balls, dx, dz) {
    let distance = 12;
    let hitBall = null;
    const xLimit = TABLE_WIDTH / 2 - ballRadius;
    const zLimit = TABLE_LENGTH / 2 - ballRadius;
    if (dx > 0.00001) distance = Math.min(distance, (xLimit - cue.x) / dx);
    if (dx < -0.00001) distance = Math.min(distance, (-xLimit - cue.x) / dx);
    if (dz > 0.00001) distance = Math.min(distance, (zLimit - cue.z) / dz);
    if (dz < -0.00001) distance = Math.min(distance, (-zLimit - cue.z) / dz);
    distance = Math.max(ballRadius, distance);

    rayDirection.set(dx, dz);
    for (const ball of balls) {
      if (ball.id === cue.id || ball.active === false || ball.pocketed) continue;
      toBall.set(ball.x - cue.x, ball.z - cue.z);
      const projection = toBall.dot(rayDirection);
      if (projection <= 0 || projection >= distance) continue;
      const perpendicularSq = toBall.lengthSq() - projection * projection;
      const contactRadius = ballRadius * 2.04;
      if (perpendicularSq > contactRadius * contactRadius) continue;
      const contactDistance = projection - Math.sqrt(Math.max(0, contactRadius * contactRadius - perpendicularSq));
      if (contactDistance > 0 && contactDistance < distance) {
        distance = contactDistance;
        hitBall = ball;
      }
    }
    return { distance, hitBall };
  }

  function updateAim(dt) {
    const state = game.state || {};
    const balls = Array.isArray(state.balls) ? state.balls : [];
    const cue = balls.find((ball) => ball.kind === 'cue' || ball.number === 0);
    const aiming = state.phase === 'aiming' && cue && cue.active !== false && !cue.pocketed;
    const cueVisual = cue ? ballVisuals.get(cue.id) : null;
    const radiusRatio = ballRadius / BALL_RADIUS;
    aimGroup.visible = Boolean(aiming);
    ghostRing.visible = false;
    objectRing.visible = false;
    ghostRing.scale.setScalar(radiusRatio);
    objectRing.scale.setScalar(radiusRatio);
    if (!aiming) {
      if (cueVisual?.spinDot) cueVisual.spinDot.visible = false;
      return;
    }

    const angle = Number.isFinite(state.aimAngle) ? state.aimAngle : 0;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    const power = clamp(Number.isFinite(state.power) ? state.power : 0.5, 0, 1);
    const charging = Boolean(state.charging);
    const follow = 1 - Math.exp(-Math.max(0.001, dt) * 18);
    cuePull += ((charging ? 0.06 + power * 0.48 : 0) - cuePull) * follow;

    aimGroup.position.set(cue.x, 0, cue.z);
    aimGroup.rotation.y = Math.atan2(dx, dz);
    cueGroup.position.z = -cuePull;
    cueShaft.position.set(0, ballRadius * 1.08, -(ballRadius + 0.07 + cueLength / 2));
    cueTip.position.set(0, ballRadius * 1.08, -(ballRadius + 0.07 + 0.0325));
    grip.position.set(0, ballRadius * 1.08, -(ballRadius + 0.07 + cueLength - 0.2));

    const contact = firstAimContact(cue, balls, dx, dz);
    const start = ballRadius * 1.18;
    const end = Math.max(start + 0.01, contact.distance - (contact.hitBall ? ballRadius * 0.85 : 0));
    const length = end - start;
    const positions = aimLineGeometry.attributes.position;
    positions.setXYZ(0, 0, 0.025, start);
    positions.setXYZ(1, 0, 0.025, end);
    positions.needsUpdate = true;
    aimLine.computeLineDistances();
    aimGlow.scale.z = length;
    aimGlow.position.set(0, 0.014, start + length / 2);

    const hue = THREE.MathUtils.lerp(0.39, 0.02, charging ? power : 0);
    aimLineMaterial.color.setHSL(hue, 0.65, charging ? 0.76 : 0.88);
    aimGlowMaterial.color.setHSL(hue, 0.62, 0.65);
    aimLineMaterial.opacity = charging ? 0.82 + Math.sin(elapsed * 9) * 0.12 : 0.9;
    aimGlowMaterial.opacity = charging ? 0.25 + power * 0.24 : 0.2;

    powerRing.material.color.setHSL(hue, 0.7, 0.62);
    powerRing.material.opacity = charging ? 0.45 + power * 0.35 : 0.18;
    const ringScale = charging ? 1 + Math.sin(elapsed * 8) * 0.055 + power * 0.12 : 1;
    powerRing.scale.setScalar(ringScale * radiusRatio);

    if (contact.hitBall) {
      ghostRing.visible = true;
      ghostRing.position.set(cue.x + dx * contact.distance, 0.016, cue.z + dz * contact.distance);
      objectRing.visible = true;
      objectRing.position.set(contact.hitBall.x, 0.014, contact.hitBall.z);
    }

    if (cueVisual?.spinDot) {
      const spinX = clamp(Number.isFinite(state.spin?.x) ? state.spin.x : 0, -1, 1);
      const spinY = clamp(Number.isFinite(state.spin?.y) ? state.spin.y : 0, -1, 1);
      const sx = spinX * ballRadius * 0.64;
      const sz = spinY * ballRadius * 0.64;
      const sy = Math.sqrt(Math.max(0.0001, ballRadius * ballRadius - sx * sx - sz * sz));
      cueVisual.spinDot.position.set(sx, sy + 0.0008, sz);
      cueVisual.spinDot.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(sx, sy, sz).normalize(),
      );
      cueVisual.spinDot.visible = Math.abs(spinX) + Math.abs(spinY) > 0.02;
    }
  }

  function updateCamera(dt) {
    const blend = 1 - Math.exp(-Math.max(0.001, dt) * 11);
    const thetaDelta = Math.atan2(
      Math.sin(cameraGoal.theta - cameraNow.theta),
      Math.cos(cameraGoal.theta - cameraNow.theta),
    );
    cameraNow.theta += thetaDelta * blend;
    cameraNow.phi += (cameraGoal.phi - cameraNow.phi) * blend;
    cameraNow.radius += (cameraGoal.radius - cameraNow.radius) * blend;
    const horizontal = cameraNow.radius * Math.sin(cameraNow.phi);
    camera.position.set(
      cameraTarget.x + horizontal * Math.sin(cameraNow.theta),
      cameraTarget.y + cameraNow.radius * Math.cos(cameraNow.phi),
      cameraTarget.z + horizontal * Math.cos(cameraNow.theta),
    );
    camera.lookAt(cameraTarget);
  }

  function resize() {
    if (disposed) return;
    viewWidth = Math.max(1, container.clientWidth || window.innerWidth || 1);
    viewHeight = Math.max(1, container.clientHeight || window.innerHeight || 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(viewWidth, viewHeight, false);
    camera.aspect = viewWidth / viewHeight;
    camera.updateProjectionMatrix();
    if (!userMovedCamera) cameraGoal.radius = defaultDistance();
  }

  let dragPointer = null;
  let dragX = 0;
  let dragY = 0;

  function onPointerDown(event) {
    if (event.button !== 2 && event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    dragPointer = event.pointerId;
    dragX = event.clientX;
    dragY = event.clientY;
    userMovedCamera = true;
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = 'grabbing';
  }

  function onPointerMove(event) {
    if (event.pointerId !== dragPointer) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - dragX;
    const dy = event.clientY - dragY;
    dragX = event.clientX;
    dragY = event.clientY;
    cameraGoal.theta -= dx * 0.0052;
    cameraGoal.phi = clamp(cameraGoal.phi - dy * 0.0042, 0.3, 1.13);
  }

  function endDrag(event) {
    if (event.pointerId !== dragPointer) return;
    event.preventDefault();
    event.stopPropagation();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    dragPointer = null;
    canvas.style.cursor = '';
  }

  function onWheel(event) {
    event.preventDefault();
    event.stopPropagation();
    userMovedCamera = true;
    const { min, max } = distanceLimits();
    cameraGoal.radius = clamp(cameraGoal.radius * Math.exp(event.deltaY * 0.001), min, max);
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('resize', resize);
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(container);

  function resetCamera() {
    cameraGoal.theta = 0;
    cameraGoal.phi = 0.64;
    cameraGoal.radius = defaultDistance();
    userMovedCamera = false;
  }

  function getAimAngle(clientX, clientY, originX = 0, originZ = 0) {
    const bounds = container.getBoundingClientRect();
    if (disposed || !bounds.width || !bounds.height || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return null;
    }
    aimPointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    camera.updateMatrixWorld();
    aimRaycaster.setFromCamera(aimPointer, camera);
    if (!aimRaycaster.ray.intersectPlane(aimPlane, aimPoint)) return null;
    const worldDx = aimPoint.x - (Number.isFinite(originX) ? originX : 0);
    const worldDz = aimPoint.z - (Number.isFinite(originZ) ? originZ : 0);
    if (Math.hypot(worldDx, worldDz) < 0.0001) return null;
    return Math.atan2(worldDx, worldDz);
  }

  function render(dt = 1 / 60) {
    if (disposed) return;
    const delta = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0.001, 0.06);
    elapsed += delta;
    updateBalls(delta);
    updateAim(delta);
    updateCamera(delta);
    renderer.render(scene, camera);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    resizeObserver?.disconnect();
    window.removeEventListener('resize', resize);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', endDrag);
    canvas.removeEventListener('pointercancel', endDrag);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    scene.traverse((object) => {
      object.shadow?.dispose();
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material)) {
            if (value?.isTexture) textures.add(value);
          }
        }
      }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    renderer.dispose();
    if (canvas.parentNode === container) container.removeChild(canvas);
    ballVisuals.clear();
  }

  resize();
  updateCamera(1);
  render(1 / 60);

  return { render, resize, resetCamera, getAimAngle, dispose };
}
