import {
  TABLE_WIDTH,
  TABLE_LENGTH,
  BALL_RADIUS,
  POCKET_RADIUS,
} from './constants.js';

const FIXED_STEP = 1 / 240;
const MAX_FRAME_TIME = 0.25;
const SNOOKER_BALL_RADIUS = BALL_RADIUS * 0.8;
const ROLLING_FRICTION = 0.85;
const STOP_SPEED = 0.018;
const BALL_RESTITUTION = 0.96;
const CUSHION_RESTITUTION = 0.82;
const CUSHION_TANGENT_DAMPING = 0.985;
const MIN_SHOT_SPEED = 0.7;
const MAX_SHOT_SPEED = 8.2;
const HEAD_SPOT_Z = TABLE_LENGTH * 0.32;
const RACK_APEX_Z = -0.9;
const SNOOKER_RACK_APEX_Z = -1.05;
const EPSILON = 1e-9;

const POCKETS = [
  { x: -TABLE_WIDTH / 2, z: -TABLE_LENGTH / 2 },
  { x: TABLE_WIDTH / 2, z: -TABLE_LENGTH / 2 },
  { x: -TABLE_WIDTH / 2, z: 0 },
  { x: TABLE_WIDTH / 2, z: 0 },
  { x: -TABLE_WIDTH / 2, z: TABLE_LENGTH / 2 },
  { x: TABLE_WIDTH / 2, z: TABLE_LENGTH / 2 },
];

const RACK = [
  [1],
  [9, 2],
  [3, 8, 10],
  [11, 4, 13, 6],
  [5, 14, 7, 12, 15],
];

const NINE_BALL_RACK = [
  [1],
  [2, 3],
  [4, 9, 5],
  [6, 7],
  [8],
];

const SNOOKER_COLOURS = [
  { number: 16, kind: 'yellow', label: '黄球', value: 2, x: TABLE_WIDTH * 0.18, z: HEAD_SPOT_Z },
  { number: 17, kind: 'green', label: '绿球', value: 3, x: -TABLE_WIDTH * 0.18, z: HEAD_SPOT_Z },
  { number: 18, kind: 'brown', label: '棕球', value: 4, x: 0, z: HEAD_SPOT_Z },
  { number: 19, kind: 'blue', label: '蓝球', value: 5, x: 0, z: 0 },
  { number: 20, kind: 'pink', label: '粉球', value: 6, x: 0, z: -0.82 },
  { number: 21, kind: 'black', label: '黑球', value: 7, x: 0, z: -TABLE_LENGTH * 0.425 },
];

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function normalizeVariant(variant) {
  return variant === 'nineball' || variant === 'snooker' ? variant : 'eightball';
}

function groupForNumber(number) {
  if (number >= 1 && number <= 7) return 'solid';
  if (number >= 9 && number <= 15) return 'stripe';
  return null;
}

function oppositeGroup(group) {
  return group === 'solid' ? 'stripe' : 'solid';
}

function groupLabel(group) {
  return group === 'solid' ? '实心球' : '花色球';
}

function makeBall(number, x, z, extra = {}) {
  const kind = number === 0
    ? 'cue'
    : number === 8
      ? 'eight'
      : groupForNumber(number);

  return {
    id: number,
    number,
    kind,
    x,
    z,
    vx: 0,
    vz: 0,
    active: true,
    pocketed: false,
    ...extra,
  };
}

function createEightBallBalls() {
  const balls = [makeBall(0, 0, HEAD_SPOT_Z)];
  const spacing = BALL_RADIUS * 2 * 1.01;
  const rowSpacing = Math.sqrt(3) * spacing / 2;

  for (let row = 0; row < RACK.length; row += 1) {
    for (let column = 0; column < RACK[row].length; column += 1) {
      balls.push(makeBall(
        RACK[row][column],
        (column - row / 2) * spacing,
        RACK_APEX_Z - row * rowSpacing,
      ));
    }
  }

  return balls;
}

function createNineBallBalls() {
  const balls = [makeBall(0, 0, HEAD_SPOT_Z)];
  const spacing = BALL_RADIUS * 2 * 1.01;
  const rowSpacing = Math.sqrt(3) * spacing / 2;

  for (let row = 0; row < NINE_BALL_RACK.length; row += 1) {
    for (let column = 0; column < NINE_BALL_RACK[row].length; column += 1) {
      const number = NINE_BALL_RACK[row][column];
      const x = (column - row / 2) * spacing;
      const z = RACK_APEX_Z - row * rowSpacing;
      balls.push(makeBall(number, x, z, number === 9
        ? { spot: { x: 0, z: RACK_APEX_Z } }
        : {}));
    }
  }

  return balls;
}

function createSnookerBalls() {
  const balls = [makeBall(0, 0, HEAD_SPOT_Z + 0.3)];
  const spacing = SNOOKER_BALL_RADIUS * 2 * 1.01;
  const rowSpacing = Math.sqrt(3) * spacing / 2;
  let number = 1;

  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      balls.push(makeBall(
        number,
        (column - row / 2) * spacing,
        SNOOKER_RACK_APEX_Z - row * rowSpacing,
        { kind: 'red', value: 1 },
      ));
      number += 1;
    }
  }

  for (const colour of SNOOKER_COLOURS) {
    balls.push(makeBall(colour.number, colour.x, colour.z, {
      kind: colour.kind,
      value: colour.value,
      spot: { x: colour.x, z: colour.z },
    }));
  }

  return balls;
}

export function createGame(options = {}) {
  let mode = typeof options === 'string' ? options : options.mode || 'cpu';
  let currentVariant = normalizeVariant(
    typeof options === 'object' && options !== null ? options.variant : undefined,
  );
  let accumulator = 0;
  let currentShot = null;
  let cpuTimer = null;
  let randomState = 0x6d2b79f5;
  let snookerPhase = 'red';

  const state = {
    variant: currentVariant,
    ballRadius: BALL_RADIUS,
    scores: [0, 0],
    targetLabel: '',
    tie: false,
    balls: [],
    phase: 'aiming',
    currentPlayer: 0,
    players: [],
    aimAngle: Math.PI,
    power: 0.65,
    spin: { x: 0, y: 0 },
    message: '',
    shotNumber: 0,
    winner: null,
    charging: false,
  };

  function random() {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  }

  function ballDiameter() {
    return state.ballRadius * 2;
  }

  function xLimit() {
    return TABLE_WIDTH / 2 - state.ballRadius;
  }

  function zLimit() {
    return TABLE_LENGTH / 2 - state.ballRadius;
  }

  function getBall(number) {
    return state.balls.find((ball) => ball.number === number);
  }

  function activeGroupBalls(group) {
    return state.balls.filter((ball) => (
      ball.active && ball.kind === group
    ));
  }

  function activeRedBalls() {
    return state.balls.filter((ball) => ball.active && ball.kind === 'red');
  }

  function activeColourBalls() {
    return state.balls.filter((ball) => (
      ball.active && SNOOKER_COLOURS.some((colour) => colour.kind === ball.kind)
    ));
  }

  function snookerColourData(kind) {
    return SNOOKER_COLOURS.find((colour) => colour.kind === kind);
  }

  function snookerBallLabel(ball) {
    return snookerColourData(ball?.kind)?.label || '红球';
  }

  function eightBallTargets(playerIndex) {
    const player = state.players[playerIndex];
    if (!player.group) {
      const targets = state.balls.filter((ball) => (
        ball.active && (ball.kind === 'solid' || ball.kind === 'stripe')
      ));
      if (state.shotNumber === 0) {
        const eight = getBall(8);
        if (eight?.active) targets.push(eight);
      }
      return targets;
    }

    const groupBalls = activeGroupBalls(player.group);
    if (groupBalls.length > 0) return groupBalls;
    const eight = getBall(8);
    return eight?.active ? [eight] : [];
  }

  function nineBallTargets() {
    let lowest = null;
    for (const ball of state.balls) {
      if (!ball.active || ball.kind === 'cue') continue;
      if (!lowest || ball.number < lowest.number) lowest = ball;
    }
    return lowest ? [lowest] : [];
  }

  function snookerTargets() {
    const reds = activeRedBalls();
    const colours = activeColourBalls();
    if (snookerPhase === 'red') return reds.length > 0 ? reds : colours;
    if (snookerPhase === 'colour' || snookerPhase === 'freeColour') return colours;
    for (const colour of SNOOKER_COLOURS) {
      const ball = getBall(colour.number);
      if (ball?.active) return [ball];
    }
    return [];
  }

  function legalTargets(playerIndex) {
    if (currentVariant === 'nineball') return nineBallTargets();
    if (currentVariant === 'snooker') return snookerTargets();
    return eightBallTargets(playerIndex);
  }

  function canShootEight(playerIndex) {
    const group = state.players[playerIndex].group;
    return Boolean(group && activeGroupBalls(group).length === 0);
  }

  function updateTargetLabel() {
    if (state.phase === 'gameover') {
      state.targetLabel = '比赛结束';
      return;
    }

    if (currentVariant === 'nineball') {
      const target = nineBallTargets()[0];
      state.targetLabel = target ? `目标：${target.number} 号球` : '目标：9 号球';
      return;
    }

    if (currentVariant === 'snooker') {
      if (snookerPhase === 'red' && activeRedBalls().length > 0) {
        state.targetLabel = '目标：红球';
      } else if (snookerPhase === 'red' || snookerPhase === 'colour' || snookerPhase === 'freeColour') {
        state.targetLabel = '目标：任意彩球';
      } else {
        const target = snookerTargets()[0];
        state.targetLabel = target
          ? `目标：${snookerBallLabel(target)}（${target.value} 分）`
          : '目标：黑球（7 分）';
      }
      return;
    }

    const player = state.players[state.currentPlayer];
    if (!player?.group) {
      state.targetLabel = '目标：实心球或花色球';
    } else if (activeGroupBalls(player.group).length > 0) {
      state.targetLabel = `目标：${groupLabel(player.group)}`;
    } else {
      state.targetLabel = '目标：黑八';
    }
  }

  function armCpuTimer() {
    if (state.phase === 'aiming' && state.players[state.currentPlayer].type === 'cpu') {
      cpuTimer = 0.65 + random() * 0.45;
    } else {
      cpuTimer = null;
    }
  }

  function isFreePosition(x, z, ignoredBall) {
    const clearance = ballDiameter() + 0.006;
    return state.balls.every((ball) => {
      if (ball === ignoredBall || !ball.active) return true;
      const dx = ball.x - x;
      const dz = ball.z - z;
      return dx * dx + dz * dz >= clearance * clearance;
    });
  }

  function resetCueBall() {
    const cue = getBall(0);
    cue.active = true;
    cue.pocketed = false;
    cue.vx = 0;
    cue.vz = 0;

    if (isFreePosition(0, HEAD_SPOT_Z, cue)) {
      cue.x = 0;
      cue.z = HEAD_SPOT_Z;
      return;
    }

    for (let row = 0; row <= 32; row += 1) {
      const z = HEAD_SPOT_Z - row * ballDiameter();
      if (z < -zLimit()) break;
      for (let column = -15; column <= 15; column += 1) {
        const x = column * ballDiameter();
        if (Math.abs(x) > xLimit()) continue;
        if (isFreePosition(x, z, cue)) {
          cue.x = x;
          cue.z = z;
          return;
        }
      }
    }

    cue.x = 0;
    cue.z = HEAD_SPOT_Z;
  }

  function restoreBall(ball, preferredSpot, extraSpots = []) {
    ball.vx = 0;
    ball.vz = 0;
    const candidates = [preferredSpot, ...extraSpots];
    let placed = false;

    for (const spot of candidates) {
      if (!spot || !isFreePosition(spot.x, spot.z, ball)) continue;
      ball.x = spot.x;
      ball.z = spot.z;
      placed = true;
      break;
    }

    if (!placed) {
      const step = ballDiameter() + 0.006;
      for (let ring = 1; ring <= 24 && !placed; ring += 1) {
        for (let index = 0; index < 16; index += 1) {
          const angle = index * Math.PI / 8;
          const x = preferredSpot.x + Math.cos(angle) * ring * step;
          const z = preferredSpot.z + Math.sin(angle) * ring * step;
          if (Math.abs(x) > xLimit() || Math.abs(z) > zLimit()) continue;
          if (!isFreePosition(x, z, ball)) continue;
          ball.x = x;
          ball.z = z;
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      ball.x = preferredSpot.x;
      ball.z = preferredSpot.z;
    }
    ball.active = true;
    ball.pocketed = false;
  }

  function respotColour(ball) {
    const ownSpot = ball.spot || snookerColourData(ball.kind);
    const otherSpots = [...SNOOKER_COLOURS]
      .sort((a, b) => b.value - a.value)
      .filter((colour) => colour.kind !== ball.kind);
    restoreBall(ball, ownSpot, otherSpots);
  }

  function reset(nextMode = mode, nextVariant = currentVariant) {
    mode = nextMode === 'local' ? 'local' : 'cpu';
    currentVariant = normalizeVariant(nextVariant);
    accumulator = 0;
    currentShot = null;
    cpuTimer = null;
    randomState = 0x6d2b79f5;
    snookerPhase = 'red';

    state.variant = currentVariant;
    state.ballRadius = currentVariant === 'snooker' ? SNOOKER_BALL_RADIUS : BALL_RADIUS;
    state.balls = currentVariant === 'snooker'
      ? createSnookerBalls()
      : currentVariant === 'nineball'
        ? createNineBallBalls()
        : createEightBallBalls();
    state.scores = [0, 0];
    state.tie = false;
    state.phase = 'aiming';
    state.currentPlayer = 0;
    state.players = mode === 'cpu'
      ? [
        { name: '玩家', type: 'human', group: null },
        { name: 'CPU', type: 'cpu', group: null },
      ]
      : [
        { name: '玩家 1', type: 'human', group: null },
        { name: '玩家 2', type: 'human', group: null },
      ];
    state.aimAngle = Math.PI;
    state.power = 0.65;
    state.spin.x = 0;
    state.spin.y = 0;
    state.message = currentVariant === 'snooker'
      ? `${state.players[0].name} 开球，请先击打红球`
      : currentVariant === 'nineball'
        ? `${state.players[0].name} 开球，请先击打 1 号球`
        : `${state.players[0].name} 开球，请瞄准球堆`;
    state.shotNumber = 0;
    state.winner = null;
    state.charging = false;
    updateTargetLabel();
    return state;
  }

  function setAim(angle) {
    if (Number.isFinite(angle)) state.aimAngle = normalizeAngle(angle);
    return state;
  }

  function setPower(value) {
    if (!Number.isFinite(value)) return state;
    state.power = clamp(value, 0, 1);
    if (state.phase === 'aiming' && state.players[state.currentPlayer].type === 'human') {
      state.charging = state.power > 0;
    }
    return state;
  }

  function setSpin(x, y) {
    if (Number.isFinite(x)) state.spin.x = clamp(x, -1, 1);
    if (Number.isFinite(y)) state.spin.y = clamp(y, -1, 1);
    return state;
  }

  function shoot(power = state.power, internalCpuShot = false) {
    if (state.phase !== 'aiming' || !Number.isFinite(power)) return false;
    const player = state.players[state.currentPlayer];
    if (player.type === 'cpu' && !internalCpuShot) return false;
    const cue = getBall(0);
    if (!cue?.active || power <= 0) return false;

    const strength = clamp(power, 0, 1);
    const direction = {
      x: Math.sin(state.aimAngle),
      z: Math.cos(state.aimAngle),
    };
    const speed = MIN_SHOT_SPEED + (MAX_SHOT_SPEED - MIN_SHOT_SPEED) * strength;
    const targets = legalTargets(state.currentPlayer);

    currentShot = {
      shooter: state.currentPlayer,
      direction,
      spin: { x: state.spin.x, y: state.spin.y },
      legalTargets: new Set(targets.map((ball) => ball.number)),
      firstContact: null,
      spinApplied: false,
      railAfterContact: false,
      pocketed: [],
      cuePocketed: false,
      eightWasLegal: currentVariant === 'eightball' && canShootEight(state.currentPlayer),
      snookerPhase,
      snookerTargetValue: currentVariant === 'snooker'
        ? targets.length === 1
          ? targets[0].value || 0
          : targets.every((ball) => ball.kind === 'red') ? 1 : 4
        : 0,
    };

    cue.vx = direction.x * speed;
    cue.vz = direction.z * speed;
    state.power = strength;
    state.shotNumber += 1;
    state.phase = 'rolling';
    state.charging = false;
    state.message = `${player.name} 击球`;
    accumulator = 0;
    cpuTimer = null;
    return true;
  }

  function registerRailContact() {
    if (currentShot?.firstContact !== null && currentShot) {
      currentShot.railAfterContact = true;
    }
  }

  function applyCushionSpin(ball, tangentAxis, wallSign) {
    if (ball.kind !== 'cue' || !currentShot) return;
    const amount = currentShot.spin.x * 0.2 * wallSign;
    ball[tangentAxis] += amount;
  }

  function pocketBall(ball, pocket) {
    ball.x = pocket.x;
    ball.z = pocket.z;
    ball.vx = 0;
    ball.vz = 0;
    ball.active = false;
    ball.pocketed = true;

    if (!currentShot) return;
    if (ball.kind === 'cue') {
      currentShot.cuePocketed = true;
    } else {
      currentShot.pocketed.push(ball.number);
    }
  }

  function checkPockets(ball) {
    if (!ball.active) return false;
    for (const pocket of POCKETS) {
      const dx = ball.x - pocket.x;
      const dz = ball.z - pocket.z;
      if (dx * dx + dz * dz <= POCKET_RADIUS * POCKET_RADIUS) {
        pocketBall(ball, pocket);
        return true;
      }
    }
    return false;
  }

  function bounceFromCushions(ball) {
    let tangentAxis;
    let wallSign;

    if (ball.x < -xLimit()) {
      ball.x = -xLimit();
      ball.vx = Math.abs(ball.vx) * CUSHION_RESTITUTION;
      ball.vz *= CUSHION_TANGENT_DAMPING;
      tangentAxis = 'vz';
      wallSign = -1;
    } else if (ball.x > xLimit()) {
      ball.x = xLimit();
      ball.vx = -Math.abs(ball.vx) * CUSHION_RESTITUTION;
      ball.vz *= CUSHION_TANGENT_DAMPING;
      tangentAxis = 'vz';
      wallSign = 1;
    }

    if (tangentAxis) {
      applyCushionSpin(ball, tangentAxis, wallSign);
      registerRailContact();
    }

    tangentAxis = undefined;
    if (ball.z < -zLimit()) {
      ball.z = -zLimit();
      ball.vz = Math.abs(ball.vz) * CUSHION_RESTITUTION;
      ball.vx *= CUSHION_TANGENT_DAMPING;
      tangentAxis = 'vx';
      wallSign = -1;
    } else if (ball.z > zLimit()) {
      ball.z = zLimit();
      ball.vz = -Math.abs(ball.vz) * CUSHION_RESTITUTION;
      ball.vx *= CUSHION_TANGENT_DAMPING;
      tangentAxis = 'vx';
      wallSign = 1;
    }

    if (tangentAxis) {
      applyCushionSpin(ball, tangentAxis, wallSign);
      registerRailContact();
    }
  }

  function applyCueContactSpin(cue) {
    if (!currentShot || currentShot.spinApplied) return;
    currentShot.spinApplied = true;
    const amount = currentShot.spin.y * 1.25;
    cue.vx += currentShot.direction.x * amount;
    cue.vz += currentShot.direction.z * amount;
  }

  function collideBalls(a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distanceSquared = dx * dx + dz * dz;
    const diameter = ballDiameter();
    if (distanceSquared >= diameter * diameter) return;

    let distance = Math.sqrt(distanceSquared);
    let nx;
    let nz;
    if (distance < EPSILON) {
      nx = a.id < b.id ? 1 : -1;
      nz = 0;
      distance = 0;
    } else {
      nx = dx / distance;
      nz = dz / distance;
    }

    const cue = a.kind === 'cue' ? a : b.kind === 'cue' ? b : null;
    const object = cue === a ? b : cue === b ? a : null;
    if (cue && object && currentShot?.firstContact === null) {
      currentShot.firstContact = object.number;
    }

    const overlap = diameter - distance + 0.000001;
    a.x -= nx * overlap * 0.5;
    a.z -= nz * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.z += nz * overlap * 0.5;

    const relativeX = b.vx - a.vx;
    const relativeZ = b.vz - a.vz;
    const normalSpeed = relativeX * nx + relativeZ * nz;
    if (normalSpeed >= 0) return;

    const impulse = -(1 + BALL_RESTITUTION) * normalSpeed * 0.5;
    a.vx -= impulse * nx;
    a.vz -= impulse * nz;
    b.vx += impulse * nx;
    b.vz += impulse * nz;

    if (cue && object) applyCueContactSpin(cue);
  }

  function finishEightBallShot() {
    const shot = currentShot;
    const shooter = shot.shooter;
    const opponent = 1 - shooter;
    const fouls = [];

    if (shot.cuePocketed) fouls.push('白球落袋');
    if (shot.firstContact === null) {
      fouls.push('未碰到目标球');
    } else if (!shot.legalTargets.has(shot.firstContact)) {
      fouls.push('首先碰到了错误目标球');
    }
    if (
      shot.firstContact !== null
      && shot.pocketed.length === 0
      && !shot.railAfterContact
    ) {
      fouls.push('击球后没有球入袋或碰库');
    }

    const eightPocketed = shot.pocketed.includes(8);
    if (eightPocketed) {
      const legalEight = shot.eightWasLegal && fouls.length === 0;
      state.winner = legalEight ? shooter : opponent;
      state.currentPlayer = shooter;
      state.phase = 'gameover';
      state.charging = false;
      state.spin.x = 0;
      state.spin.y = 0;
      state.message = legalEight
        ? `${state.players[shooter].name} 合法打入黑八，赢得比赛`
        : `${state.players[shooter].name} 非法打入黑八，${state.players[opponent].name} 获胜`;
      updateTargetLabel();
      currentShot = null;
      accumulator = 0;
      cpuTimer = null;
      return;
    }

    let assignedGroup = state.players[shooter].group;
    let assignmentMessage = '';
    if (!assignedGroup && fouls.length === 0) {
      const firstObject = shot.pocketed.find((number) => number !== 8);
      if (firstObject !== undefined) {
        assignedGroup = groupForNumber(firstObject);
        state.players[shooter].group = assignedGroup;
        state.players[opponent].group = oppositeGroup(assignedGroup);
        assignmentMessage = `，分为${groupLabel(assignedGroup)}`;
      }
    }

    state.phase = 'aiming';
    state.charging = false;
    state.spin.x = 0;
    state.spin.y = 0;

    if (fouls.length > 0) {
      state.currentPlayer = opponent;
      resetCueBall();
      state.message = `犯规：${fouls.join('、')}。白球已重置，${state.players[opponent].name} 回合`;
    } else {
      const ownBallPocketed = assignedGroup && shot.pocketed.some((number) => (
        groupForNumber(number) === assignedGroup
      ));
      if (ownBallPocketed) {
        state.currentPlayer = shooter;
        state.message = `${state.players[shooter].name} 进球${assignmentMessage}，继续击球`;
      } else {
        state.currentPlayer = opponent;
        state.message = `${shot.pocketed.length ? '未进己方球' : '无进球'}${assignmentMessage}，${state.players[opponent].name} 回合`;
      }
    }

    updateTargetLabel();
    currentShot = null;
    accumulator = 0;
    if (state.currentPlayer === shooter && !getBall(0).active) resetCueBall();
    armCpuTimer();
    if (cpuTimer !== null) state.message += '；CPU 正在思考…';
  }

  function finishNineBallShot() {
    const shot = currentShot;
    const shooter = shot.shooter;
    const opponent = 1 - shooter;
    const fouls = [];

    if (shot.cuePocketed) fouls.push('白球落袋');
    if (shot.firstContact === null) {
      fouls.push('未碰到目标球');
    } else if (!shot.legalTargets.has(shot.firstContact)) {
      fouls.push('未先击打最低号球');
    }
    if (
      shot.firstContact !== null
      && shot.pocketed.length === 0
      && !shot.railAfterContact
    ) {
      fouls.push('击球后没有球入袋或碰库');
    }

    const ninePocketed = shot.pocketed.includes(9);
    if (fouls.length === 0 && ninePocketed) {
      state.winner = shooter;
      state.currentPlayer = shooter;
      state.phase = 'gameover';
      state.charging = false;
      state.spin.x = 0;
      state.spin.y = 0;
      state.message = `${state.players[shooter].name} 合法打入 9 号球，赢得比赛`;
      updateTargetLabel();
      currentShot = null;
      accumulator = 0;
      cpuTimer = null;
      return;
    }

    if (ninePocketed) {
      const nine = getBall(9);
      restoreBall(nine, nine.spot || { x: 0, z: RACK_APEX_Z });
    }

    state.phase = 'aiming';
    state.charging = false;
    state.spin.x = 0;
    state.spin.y = 0;

    if (fouls.length > 0) {
      state.currentPlayer = opponent;
      resetCueBall();
      state.message = `犯规：${fouls.join('、')}。${ninePocketed ? '9 号球已回位，' : ''}白球已重置，${state.players[opponent].name} 回合`;
    } else if (shot.pocketed.length > 0) {
      state.currentPlayer = shooter;
      state.message = `${state.players[shooter].name} 合法进球，继续击球`;
    } else {
      state.currentPlayer = opponent;
      state.message = `无进球，${state.players[opponent].name} 回合`;
    }

    updateTargetLabel();
    currentShot = null;
    accumulator = 0;
    armCpuTimer();
    if (cpuTimer !== null) state.message += '；CPU 正在思考…';
  }

  function finishSnookerShot() {
    const shot = currentShot;
    const shooter = shot.shooter;
    const opponent = 1 - shooter;
    const pottedBalls = shot.pocketed.map((number) => getBall(number)).filter(Boolean);
    const pottedReds = pottedBalls.filter((ball) => ball.kind === 'red');
    const pottedColours = pottedBalls.filter((ball) => ball.kind !== 'red');
    const fouls = [];

    if (shot.cuePocketed) fouls.push('白球落袋');
    if (shot.firstContact === null) {
      fouls.push('未碰到目标球');
    } else if (!shot.legalTargets.has(shot.firstContact)) {
      fouls.push('首先碰到了错误目标球');
    }
    if (pottedBalls.some((ball) => !shot.legalTargets.has(ball.number))) {
      fouls.push('打进了非目标球');
    }
    if (
      (shot.snookerPhase === 'colour' || shot.snookerPhase === 'freeColour')
      && pottedColours.length > 1
    ) {
      fouls.push('一杆打进多颗彩球');
    }

    const firstContactValue = shot.firstContact === null
      ? 0
      : getBall(shot.firstContact)?.value || 0;
    const penalty = Math.max(
      4,
      shot.snookerTargetValue,
      firstContactValue,
      ...pottedBalls.map((ball) => ball.value || 0),
    );
    const earned = fouls.length === 0
      ? pottedBalls.reduce((total, ball) => total + (ball.value || 0), 0)
      : 0;

    if (fouls.length > 0) state.scores[opponent] += penalty;
    if (earned > 0) state.scores[shooter] += earned;

    for (const colour of pottedColours) {
      const legalTailColour = fouls.length === 0
        && shot.snookerPhase === 'colours'
        && shot.legalTargets.has(colour.number);
      if (!legalTailColour) respotColour(colour);
    }

    if (fouls.length > 0) resetCueBall();

    const continueShooting = fouls.length === 0 && pottedBalls.length > 0;
    let nextPlayer = continueShooting ? shooter : opponent;
    const redsRemaining = activeRedBalls().length > 0;

    if (shot.snookerPhase === 'red') {
      snookerPhase = continueShooting && pottedReds.length > 0
        ? redsRemaining ? 'colour' : 'freeColour'
        : redsRemaining ? 'red' : 'freeColour';
    } else if (shot.snookerPhase === 'colour') {
      snookerPhase = redsRemaining ? 'red' : 'freeColour';
    } else if (shot.snookerPhase === 'freeColour') {
      snookerPhase = 'colours';
    }

    const black = getBall(21);
    const blackStroke = shot.snookerPhase === 'colours' && shot.legalTargets.has(21);
    const blackPotted = pottedColours.some((ball) => ball.kind === 'black');
    const frameEnds = blackStroke && (blackPotted || fouls.length > 0);

    if (frameEnds) {
      if (state.scores[0] === state.scores[1]) {
        respotColour(black);
        snookerPhase = 'colours';
        nextPlayer = opponent;
        state.tie = true;
        state.currentPlayer = nextPlayer;
        state.phase = 'aiming';
        state.charging = false;
        state.spin.x = 0;
        state.spin.y = 0;
        state.message = `黑球一击后比分为 ${state.scores[0]}:${state.scores[1]}，黑球已回位决胜，${state.players[nextPlayer].name} 回合`;
      } else {
        state.winner = state.scores[0] > state.scores[1] ? 0 : 1;
        state.tie = false;
        state.currentPlayer = shooter;
        state.phase = 'gameover';
        state.charging = false;
        state.spin.x = 0;
        state.spin.y = 0;
        state.message = `比赛结束，${state.players[state.winner].name} 以 ${state.scores[state.winner]}:${state.scores[1 - state.winner]} 获胜`;
      }
      updateTargetLabel();
      currentShot = null;
      accumulator = 0;
      cpuTimer = null;
      return;
    }

    state.currentPlayer = nextPlayer;
    state.phase = 'aiming';
    state.charging = false;
    state.spin.x = 0;
    state.spin.y = 0;

    const pottedDescription = [
      pottedReds.length > 0 ? `红球×${pottedReds.length}` : '',
      ...pottedColours.map((ball) => snookerBallLabel(ball)),
    ].filter(Boolean).join('、');

    if (fouls.length > 0) {
      state.message = `犯规：${fouls.join('、')}，罚 ${penalty} 分给${state.players[opponent].name}。彩球按规则回位，${state.players[nextPlayer].name} 回合`;
    } else if (continueShooting) {
      state.message = `${state.players[shooter].name} 打进${pottedDescription}，得 ${earned} 分，继续击球`;
    } else {
      state.message = `未进球，${state.players[nextPlayer].name} 回合`;
    }

    updateTargetLabel();
    if (continueShooting || fouls.length > 0) state.message += `；${state.targetLabel}`;
    currentShot = null;
    accumulator = 0;
    armCpuTimer();
    if (cpuTimer !== null) state.message += '；CPU 正在思考…';
  }

  function finishShot() {
    if (!currentShot) return;
    if (currentVariant === 'nineball') finishNineBallShot();
    else if (currentVariant === 'snooker') finishSnookerShot();
    else finishEightBallShot();
  }

  function physicsStep(dt) {
    for (const ball of state.balls) {
      if (!ball.active || checkPockets(ball)) continue;

      let speed = Math.hypot(ball.vx, ball.vz);
      if (speed <= STOP_SPEED) {
        ball.vx = 0;
        ball.vz = 0;
        continue;
      }

      if (ball.kind === 'cue' && currentShot?.firstContact === null) {
        const turn = currentShot.spin.x * 0.16 * dt;
        const cosine = Math.cos(turn);
        const sine = Math.sin(turn);
        const vx = ball.vx * cosine - ball.vz * sine;
        const vz = ball.vx * sine + ball.vz * cosine;
        ball.vx = vx;
        ball.vz = vz;
      }

      const nextSpeed = Math.max(0, speed - ROLLING_FRICTION * dt);
      if (nextSpeed <= STOP_SPEED) {
        ball.vx = 0;
        ball.vz = 0;
        continue;
      }

      const scale = nextSpeed / speed;
      ball.vx *= scale;
      ball.vz *= scale;
      ball.x += ball.vx * dt;
      ball.z += ball.vz * dt;

      if (!checkPockets(ball)) bounceFromCushions(ball);
    }

    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < state.balls.length; i += 1) {
        const a = state.balls[i];
        if (!a.active) continue;
        for (let j = i + 1; j < state.balls.length; j += 1) {
          const b = state.balls[j];
          if (b.active) collideBalls(a, b);
        }
      }
    }

    for (const ball of state.balls) {
      if (!ball.active || checkPockets(ball)) continue;
      if (Math.abs(ball.x) > xLimit() || Math.abs(ball.z) > zLimit()) {
        bounceFromCushions(ball);
      }
    }

    const moving = state.balls.some((ball) => (
      ball.active && Math.hypot(ball.vx, ball.vz) > STOP_SPEED
    ));
    if (!moving) {
      for (const ball of state.balls) {
        if (!ball.active) continue;
        ball.vx = 0;
        ball.vz = 0;
      }
      finishShot();
    }
  }

  function segmentBlocked(x1, z1, x2, z2, ignoredIds) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared < EPSILON) return false;

    return state.balls.some((ball) => {
      if (!ball.active || ignoredIds.has(ball.id)) return false;
      const t = clamp(
        ((ball.x - x1) * dx + (ball.z - z1) * dz) / lengthSquared,
        0,
        1,
      );
      if (t <= 0.015 || t >= 0.985) return false;
      const closestX = x1 + dx * t;
      const closestZ = z1 + dz * t;
      const offsetX = ball.x - closestX;
      const offsetZ = ball.z - closestZ;
      return offsetX * offsetX + offsetZ * offsetZ < (ballDiameter() + 0.008) ** 2;
    });
  }

  function findCpuShot() {
    const cue = getBall(0);
    const targets = legalTargets(state.currentPlayer);
    const diameter = ballDiameter();
    let best = null;

    for (const target of targets) {
      for (let pocketIndex = 0; pocketIndex < POCKETS.length; pocketIndex += 1) {
        const pocket = POCKETS[pocketIndex];
        const pocketX = pocket.x - target.x;
        const pocketZ = pocket.z - target.z;
        const pocketDistance = Math.hypot(pocketX, pocketZ);
        if (pocketDistance < diameter) continue;

        const pocketDirectionX = pocketX / pocketDistance;
        const pocketDirectionZ = pocketZ / pocketDistance;
        const ghostX = target.x - pocketDirectionX * diameter;
        const ghostZ = target.z - pocketDirectionZ * diameter;
        if (Math.abs(ghostX) > xLimit() + 0.001 || Math.abs(ghostZ) > zLimit() + 0.001) continue;

        const cueX = ghostX - cue.x;
        const cueZ = ghostZ - cue.z;
        const cueDistance = Math.hypot(cueX, cueZ);
        if (cueDistance < state.ballRadius) continue;

        const cueDirectionX = cueX / cueDistance;
        const cueDirectionZ = cueZ / cueDistance;
        const cut = cueDirectionX * pocketDirectionX + cueDirectionZ * pocketDirectionZ;
        if (cut < 0.18) continue;
        if (segmentBlocked(cue.x, cue.z, ghostX, ghostZ, new Set([0, target.id]))) continue;
        if (segmentBlocked(target.x, target.z, pocket.x, pocket.z, new Set([0, target.id]))) continue;

        const score = cueDistance + pocketDistance * 1.15 + (1 - cut) * 3;
        if (!best || score < best.score) {
          best = {
            score,
            target: target.number,
            pocketIndex,
            angle: Math.atan2(cueDirectionX, cueDirectionZ),
            distance: cueDistance + pocketDistance,
            cut,
          };
        }
      }
    }

    if (best) return best;
    if (targets.length === 0) return null;

    let target = targets[0];
    let distance = Infinity;
    for (const candidate of targets) {
      const candidateDistance = Math.hypot(candidate.x - cue.x, candidate.z - cue.z);
      if (candidateDistance < distance) {
        target = candidate;
        distance = candidateDistance;
      }
    }
    return {
      target: target.number,
      pocketIndex: null,
      angle: Math.atan2(target.x - cue.x, target.z - cue.z),
      distance,
      cut: 1,
      fallback: true,
    };
  }

  function executeCpuShot() {
    if (state.phase !== 'aiming' || state.players[state.currentPlayer].type !== 'cpu') return;
    const plan = findCpuShot();
    if (!plan) {
      state.message = 'CPU 没有合法目标';
      return;
    }

    const error = (random() * 2 - 1) * (plan.fallback ? 0.006 : 0.006 + (1 - plan.cut) * 0.012);
    state.aimAngle = normalizeAngle(plan.angle + error);
    state.power = clamp(
      0.3 + plan.distance * 0.09 + (1 - plan.cut) * 0.14 + (random() * 2 - 1) * 0.04,
      0.32,
      0.88,
    );
    if (shoot(state.power, true)) {
      const target = getBall(plan.target);
      const label = currentVariant === 'snooker' ? snookerBallLabel(target) : `${plan.target} 号球`;
      state.message = currentVariant === 'snooker'
        ? plan.pocketIndex === null
          ? `CPU 击打${label}`
          : `CPU 瞄准${label}并入袋`
        : plan.pocketIndex === null
          ? `CPU 击打 ${label}`
          : `CPU 瞄准 ${label}并入袋`;
    }
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return state;
    const elapsed = Math.min(dt, MAX_FRAME_TIME);

    if (state.phase === 'aiming' && state.players[state.currentPlayer].type === 'cpu') {
      if (cpuTimer === null) armCpuTimer();
      cpuTimer -= elapsed;
      if (cpuTimer <= 0) executeCpuShot();
    }

    if (state.phase !== 'rolling') return state;
    accumulator = Math.min(accumulator + elapsed, MAX_FRAME_TIME);
    while (accumulator + EPSILON >= FIXED_STEP && state.phase === 'rolling') {
      physicsStep(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
    if (state.phase !== 'rolling') accumulator = 0;
    return state;
  }

  reset(mode, currentVariant);

  return {
    state,
    setAim,
    setPower,
    setSpin,
    shoot,
    update,
    reset,
  };
}

export default createGame;
