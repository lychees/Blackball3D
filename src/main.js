import { createGame } from "./game/game.js";
import { createTableScene } from "./scene/scene.js";
import { createUI } from "./ui.js";

const container = document.getElementById("scene-container");
const shootButton = document.getElementById("shoot-button");
const chargeDuration = 1400;

let game;
let view;
let currentMode = "cpu";
let charging = false;
let chargeSource = null;
let chargeStartedAt = 0;
let chargePower = 0;
let activePointer = null;
let animationId = 0;
let disposed = false;

const ui = createUI({
  onMode(mode) {
    if (mode !== "cpu" && mode !== "local") return;
    if (mode === currentMode) return;
    currentMode = mode;
    resetMatch();
  },
  onNewGame: resetMatch,
  onCamera() {
    view?.resetCamera();
  },
  onSpin(x, y) {
    if (canControl()) game.setSpin(x, y);
  },
  onChargeStart(source) {
    return beginCharge(source);
  },
  onChargeEnd(source) {
    finishCharge(source);
  },
  onChargeCancel(source) {
    cancelCharge(source);
  },
  onKeyboardShot() {
    if (!canControl() || charging) return;
    const power = Math.max(0.45, Number(game.state.power) || 0);
    game.setPower(power);
    game.shoot(power);
  },
});

function canControl() {
  if (!game || game.state.phase !== "aiming") return false;
  return game.state.players?.[game.state.currentPlayer]?.type === "human";
}

function updateAim(event) {
  if (!canControl()) return;
  const cueBall = game.state.balls?.find((ball) => ball.kind === "cue");
  const originX = Number.isFinite(cueBall?.x) ? cueBall.x : 0;
  const originZ = Number.isFinite(cueBall?.z) ? cueBall.z : 0;
  if (typeof view?.getAimAngle === "function") {
    const angle = view.getAimAngle(event.clientX, event.clientY, originX, originZ);
    if (Number.isFinite(angle)) game.setAim(angle);
    return;
  }
  const bounds = container.getBoundingClientRect();
  const dx = event.clientX - (bounds.left + bounds.width / 2);
  const dy = event.clientY - (bounds.top + bounds.height / 2);
  if (Math.hypot(dx, dy) < 4) return;
  game.setAim(Math.atan2(dx, dy));
}

function beginCharge(source = "scene", pointerId = null) {
  if (charging || !canControl()) return false;
  charging = true;
  chargeSource = source;
  chargeStartedAt = performance.now();
  chargePower = 0.08;
  activePointer = pointerId;
  game.setPower(chargePower);
  container.classList.add("is-charging");
  ui.setCharging(true);
  return true;
}

function updateCharge(now) {
  if (!charging) return;
  const progress = Math.min((now - chargeStartedAt) / chargeDuration, 1);
  chargePower = 0.08 + progress * 0.92;
  game.setPower(chargePower);
}

function clearCharge() {
  charging = false;
  chargeSource = null;
  activePointer = null;
  container.classList.remove("is-charging");
  ui.setCharging(false);
}

function finishCharge(source) {
  if (!charging || (source && chargeSource !== source)) return;
  const power = chargePower;
  clearCharge();
  if (!canControl()) return;
  game.setPower(power);
  game.shoot(power);
}

function cancelCharge(source) {
  if (!charging || (source && chargeSource !== source)) return;
  clearCharge();
  if (game?.state.phase === "aiming") game.setPower(0);
}

function resetMatch() {
  if (!game) return;
  cancelCharge();
  game.reset(currentMode);
}

container.addEventListener("pointermove", (event) => {
  if (activePointer !== null && event.pointerId !== activePointer) return;
  if (event.pointerType === "mouse" && (event.buttons & 6)) return;
  if (event.pointerType !== "touch" || charging) updateAim(event);
});

container.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || activePointer !== null || !canControl()) return;
  if (event.pointerType !== "mouse" && !event.isPrimary) return;
  event.preventDefault();
  updateAim(event);
  if (!beginCharge("scene", event.pointerId)) return;
  container.setPointerCapture(event.pointerId);
});

container.addEventListener("pointerup", (event) => {
  if (event.pointerId !== activePointer || chargeSource !== "scene") return;
  event.preventDefault();
  updateAim(event);
  finishCharge("scene");
  if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
});

container.addEventListener("pointercancel", (event) => {
  if (event.pointerId !== activePointer || chargeSource !== "scene") return;
  cancelCharge("scene");
});

container.addEventListener("lostpointercapture", (event) => {
  if (event.pointerId === activePointer && chargeSource === "scene") cancelCharge("scene");
});

container.addEventListener("contextmenu", (event) => event.preventDefault());

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.repeat) return;
  const target = event.target instanceof Element ? event.target : null;
  const nativeControl = target?.closest("button, input, select, textarea, [role='slider'], [contenteditable='true']");
  if (nativeControl && nativeControl !== shootButton) return;
  if (!canControl() && !charging) return;
  event.preventDefault();
  if (!charging) beginCharge("keyboard");
});

document.addEventListener("keyup", (event) => {
  if (event.code !== "Space" || !charging || chargeSource !== "keyboard") return;
  event.preventDefault();
  finishCharge("keyboard");
});

window.addEventListener("blur", () => cancelCharge());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelCharge();
});

try {
  game = createGame({ mode: currentMode });
  view = createTableScene(container, game);
  view.resize();
} catch (error) {
  ui.showError(error);
  throw error;
}

const resize = () => view.resize();
const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
resizeObserver?.observe(container);
window.addEventListener("resize", resize);

let lastFrame = performance.now();
let firstFrame = true;

function frame(now) {
  if (disposed) return;
  const dt = Math.min(Math.max((now - lastFrame) / 1000, 0), 0.05);
  lastFrame = now;

  try {
    updateCharge(now);
    game.update(dt);
    view.render(dt);
    ui.update(game.state, { charging, chargePower });
    if (firstFrame) {
      firstFrame = false;
      ui.setReady();
    }
  } catch (error) {
    ui.showError(error);
    console.error("Blackball could not continue:", error);
    return;
  }

  animationId = requestAnimationFrame(frame);
}

animationId = requestAnimationFrame(frame);

window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  disposed = true;
  cancelAnimationFrame(animationId);
  resizeObserver?.disconnect();
  window.removeEventListener("resize", resize);
  view.dispose();
});
