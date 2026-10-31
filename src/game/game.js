import {
  TABLE_WIDTH,
  TABLE_LENGTH,
  BALL_RADIUS,
  POCKET_RADIUS,
} from './constants.js';

const FIXED_STEP = 1 / 240;
const MAX_FRAME_TIME = 0.25;
const BALL_DIAMETER = BALL_RADIUS * 2;
const X_LIMIT = TABLE_WIDTH / 2 - BALL_RADIUS;
const Z_LIMIT = TABLE_LENGTH / 2 - BALL_RADIUS;
const ROLLING_FRICTION = 0.85;
const STOP_SPEED = 0.018;
const BALL_RESTITUTION = 0.96;
const CUSHION_RESTITUTION = 0.82;
const CUSHION_TANGENT_DAMPING = 0.985;
const MIN_SHOT_SPEED = 0.7;
const MAX_SHOT_SPEED = 8.2;
const HEAD_SPOT_Z = TABLE_LENGTH * 0.32;
const RACK_APEX_Z = -0.9;
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

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
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

function makeBall(number, x, z) {
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
  };
}

function createBalls() {
  const balls = [makeBall(0, 0, HEAD_SPOT_Z)];
  const spacing = BALL_DIAMETER * 1.01;
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

export function createGame(options = {}) {
  let mode = typeof options === 'string' ? options : options.mode || 'cpu';
  let accumulator = 0;
  let currentShot = null;
  let cpuTimer = null;
  let randomState = 0x6d2b79f5;

  const state = {
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

  function getBall(number) {
    return state.balls.find((ball) => ball.number === number);
  }

  function activeGroupBalls(group) {
    return state.balls.filter((ball) => (
      ball.active && ball.kind === group
    ));
  }

  function legalTargets(playerIndex) {
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

  function canShootEight(playerIndex) {
    const group = state.players[playerIndex].group;
    return Boolean(group && activeGroupBalls(group).length === 0);
  }

  function armCpuTimer() {
    if (state.phase === 'aiming' && state.players[state.currentPlayer].type === 'cpu') {
      cpuTimer = 0.65 + random() * 0.45;
    } else {
      cpuTimer = null;
    }
  }

  function resetCueBall() {
    const cue = getBall(0);
    cue.active = true;
    cue.pocketed = false;
    cue.vx = 0;
    cue.vz = 0;

    function isFree(x, z) {
      return state.balls.every((ball) => {
        if (ball === cue || !ball.active) return true;
        const dx = ball.x - x;
        const dz = ball.z - z;
        return dx * dx + dz * dz >= (BALL_DIAMETER + 0.006) ** 2;
      });
    }

    if (isFree(0, HEAD_SPOT_Z)) {
      cue.x = 0;
      cue.z = HEAD_SPOT_Z;
      return;
    }

    for (let row = 0; row <= 32; row += 1) {
      const z = HEAD_SPOT_Z - row * BALL_DIAMETER;
      if (z < -Z_LIMIT) break;
      for (let column = -15; column <= 15; column += 1) {
        const x = column * BALL_DIAMETER;
        if (Math.abs(x) > X_LIMIT) continue;
        if (isFree(x, z)) {
          cue.x = x;
          cue.z = z;
          return;
        }
      }
    }

    cue.x = 0;
    cue.z = HEAD_SPOT_Z;
  }

  function reset(nextMode = mode) {
    mode = nextMode === 'local' ? 'local' : 'cpu';
    accumulator = 0;
    currentShot = null;
    cpuTimer = null;
    randomState = 0x6d2b79f5;

    state.balls = createBalls();
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
    state.message = `${state.players[0].name} 开球，请瞄准球堆`;
    state.shotNumber = 0;
    state.winner = null;
    state.charging = false;
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
      eightWasLegal: canShootEight(state.currentPlayer),
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

    if (ball.x < -X_LIMIT) {
      ball.x = -X_LIMIT;
      ball.vx = Math.abs(ball.vx) * CUSHION_RESTITUTION;
      ball.vz *= CUSHION_TANGENT_DAMPING;
      tangentAxis = 'vz';
      wallSign = -1;
    } else if (ball.x > X_LIMIT) {
      ball.x = X_LIMIT;
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
    if (ball.z < -Z_LIMIT) {
      ball.z = -Z_LIMIT;
      ball.vz = Math.abs(ball.vz) * CUSHION_RESTITUTION;
      ball.vx *= CUSHION_TANGENT_DAMPING;
      tangentAxis = 'vx';
      wallSign = -1;
    } else if (ball.z > Z_LIMIT) {
      ball.z = Z_LIMIT;
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
    if (distanceSquared >= BALL_DIAMETER * BALL_DIAMETER) return;

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

    const overlap = BALL_DIAMETER - distance + 0.000001;
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

  function finishShot() {
    if (!currentShot) return;
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

    currentShot = null;
    accumulator = 0;
    if (state.currentPlayer === shooter && !getBall(0).active) resetCueBall();
    armCpuTimer();
    if (cpuTimer !== null) state.message += '；CPU 正在思考…';
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
      if (
        Math.abs(ball.x) > X_LIMIT
        || Math.abs(ball.z) > Z_LIMIT
      ) {
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
      return offsetX * offsetX + offsetZ * offsetZ < (BALL_DIAMETER + 0.008) ** 2;
    });
  }

  function findCpuShot() {
    const cue = getBall(0);
    const targets = legalTargets(state.currentPlayer);
    let best = null;

    for (const target of targets) {
      for (let pocketIndex = 0; pocketIndex < POCKETS.length; pocketIndex += 1) {
        const pocket = POCKETS[pocketIndex];
        const pocketX = pocket.x - target.x;
        const pocketZ = pocket.z - target.z;
        const pocketDistance = Math.hypot(pocketX, pocketZ);
        if (pocketDistance < BALL_DIAMETER) continue;

        const pocketDirectionX = pocketX / pocketDistance;
        const pocketDirectionZ = pocketZ / pocketDistance;
        const ghostX = target.x - pocketDirectionX * BALL_DIAMETER;
        const ghostZ = target.z - pocketDirectionZ * BALL_DIAMETER;
        if (Math.abs(ghostX) > X_LIMIT + 0.001 || Math.abs(ghostZ) > Z_LIMIT + 0.001) continue;

        const cueX = ghostX - cue.x;
        const cueZ = ghostZ - cue.z;
        const cueDistance = Math.hypot(cueX, cueZ);
        if (cueDistance < BALL_RADIUS) continue;

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
      state.message = plan.pocketIndex === null
        ? `CPU 击打 ${plan.target} 号球`
        : `CPU 瞄准 ${plan.target} 号球并入袋`;
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

  reset(mode);

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
