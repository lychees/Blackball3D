const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const ballColors = {
  1: "#e7c54d",
  2: "#397bc3",
  3: "#d95c4f",
  4: "#8261ad",
  5: "#df853f",
  6: "#3b916a",
  7: "#88453c",
};

export function createUI(handlers = {}) {
  const byId = (id) => document.getElementById(id);
  const elements = {
    app: byId("app"),
    shotCounter: byId("shot-counter"),
    turnPill: byId("turn-pill"),
    turnLabel: byId("turn-label"),
    contextHint: byId("context-hint"),
    message: byId("game-message"),
    foulBadge: byId("foul-badge"),
    matchType: byId("match-type"),
    powerMeter: byId("power-meter"),
    powerValue: byId("power-value"),
    spinPad: byId("spin-pad"),
    spinHandle: byId("spin-handle"),
    spinLabel: byId("spin-label"),
    spinReset: byId("spin-reset"),
    shootButton: byId("shoot-button"),
    shotStatus: byId("shot-status"),
    loading: byId("loading-screen"),
    winnerOverlay: byId("winner-overlay"),
    winnerTitle: byId("winner-title"),
    winnerDetail: byId("winner-detail"),
    fatalError: byId("fatal-error"),
    fatalErrorMessage: byId("fatal-error-message"),
  };

  const players = [0, 1].map((index) => ({
    card: byId(`player-card-${index}`),
    name: byId(`player-name-${index}`),
    type: byId(`player-type-${index}`),
    turn: byId(`player-turn-${index}`),
    group: byId(`player-group-${index}`),
    count: byId(`player-count-${index}`),
    rack: byId(`player-rack-${index}`),
    rackSignature: "",
  }));

  const modeButtons = [...document.querySelectorAll("[data-mode]")];
  let currentSpin = { x: 0, y: 0 };
  let spinPointer = null;
  let shootPointer = null;

  const setText = (element, value) => {
    const text = String(value);
    if (element.textContent !== text) element.textContent = text;
  };

  const normalizedSpin = (x, y) => {
    const length = Math.hypot(x, y);
    const scale = length > 1 ? 1 / length : 1;
    return { x: clamp(x * scale, -1, 1), y: clamp(y * scale, -1, 1) };
  };

  const spinDescription = ({ x, y }) => {
    if (Math.hypot(x, y) < 0.08) return "CENTER BALL";
    const vertical = y > 0.05 ? "TOP" : y < -0.05 ? "BACK" : "";
    const horizontal = x > 0.05 ? "RIGHT" : x < -0.05 ? "LEFT" : "";
    return [vertical, horizontal].filter(Boolean).join(" · ") || "CENTER BALL";
  };

  const paintSpin = (spin) => {
    currentSpin = normalizedSpin(Number(spin?.x) || 0, Number(spin?.y) || 0);
    const description = spinDescription(currentSpin);
    elements.spinHandle.style.transform = `translate(-50%, -50%) translate(${currentSpin.x * 26}px, ${-currentSpin.y * 26}px)`;
    elements.spinPad.setAttribute("aria-valuenow", currentSpin.x.toFixed(2));
    elements.spinPad.setAttribute("aria-valuetext", description.toLowerCase());
    setText(elements.spinLabel, description);
  };

  const changeSpin = (x, y) => {
    if (elements.spinPad.getAttribute("aria-disabled") === "true") return;
    const next = normalizedSpin(x, y);
    paintSpin(next);
    handlers.onSpin?.(next.x, next.y);
  };

  const remainingBalls = (balls, group) => {
    if (!group) return null;
    return balls.filter((ball) => ball.kind === group && ball.active !== false && !ball.pocketed).length;
  };

  const paintRack = (player, group, balls) => {
    const signature = `${group}:${balls.map((ball) => `${ball.number}-${ball.active !== false && !ball.pocketed ? 1 : 0}`).join(",")}`;
    if (signature === player.rackSignature) return;
    player.rackSignature = signature;
    player.rack.replaceChildren();
    player.rack.classList.toggle("has-balls", Boolean(group));
    if (!group) return;

    const start = group === "solid" ? 1 : 9;
    for (let number = start; number < start + 7; number += 1) {
      const ball = balls.find((item) => item.number === number);
      const pocketed = ball ? ball.active === false || ball.pocketed : false;
      const marker = document.createElement("span");
      marker.className = `mini-ball${group === "stripe" ? " is-stripe" : ""}${pocketed ? " is-pocketed" : ""}`;
      marker.style.setProperty("--ball-color", ballColors[number > 8 ? number - 8 : number]);
      marker.textContent = number;
      player.rack.append(marker);
    }
  };

  const spinFromPointer = (event) => {
    const bounds = elements.spinPad.getBoundingClientRect();
    const radius = Math.min(bounds.width, bounds.height) * 0.32;
    const x = (event.clientX - (bounds.left + bounds.width / 2)) / radius;
    const y = -((event.clientY - (bounds.top + bounds.height / 2)) / radius);
    changeSpin(x, y);
  };

  elements.spinPad.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || elements.spinPad.getAttribute("aria-disabled") === "true") return;
    event.preventDefault();
    event.stopPropagation();
    spinPointer = event.pointerId;
    elements.spinPad.setPointerCapture(event.pointerId);
    spinFromPointer(event);
  });

  elements.spinPad.addEventListener("pointermove", (event) => {
    if (event.pointerId !== spinPointer) return;
    event.preventDefault();
    spinFromPointer(event);
  });

  const finishSpinPointer = (event) => {
    if (event.pointerId !== spinPointer) return;
    spinPointer = null;
    if (elements.spinPad.hasPointerCapture(event.pointerId)) elements.spinPad.releasePointerCapture(event.pointerId);
  };

  elements.spinPad.addEventListener("pointerup", finishSpinPointer);
  elements.spinPad.addEventListener("pointercancel", finishSpinPointer);

  elements.spinPad.addEventListener("keydown", (event) => {
    const steps = {
      ArrowLeft: [-0.1, 0],
      ArrowRight: [0.1, 0],
      ArrowUp: [0, 0.1],
      ArrowDown: [0, -0.1],
    };
    if (event.key === "Home" || event.key === "0") {
      event.preventDefault();
      event.stopPropagation();
      changeSpin(0, 0);
      return;
    }
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    changeSpin(currentSpin.x + step[0], currentSpin.y + step[1]);
  });

  elements.spinReset.addEventListener("click", () => {
    changeSpin(0, 0);
    elements.spinPad.focus({ preventScroll: true });
  });

  elements.shootButton.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || elements.shootButton.disabled || shootPointer !== null) return;
    event.preventDefault();
    event.stopPropagation();
    if (handlers.onChargeStart?.("button") === false) return;
    shootPointer = event.pointerId;
    elements.shootButton.setPointerCapture(event.pointerId);
  });

  elements.shootButton.addEventListener("pointerup", (event) => {
    if (event.pointerId !== shootPointer) return;
    event.preventDefault();
    event.stopPropagation();
    shootPointer = null;
    if (elements.shootButton.hasPointerCapture(event.pointerId)) elements.shootButton.releasePointerCapture(event.pointerId);
    handlers.onChargeEnd?.("button");
  });

  const cancelButtonCharge = (event) => {
    if (event.pointerId !== shootPointer) return;
    shootPointer = null;
    handlers.onChargeCancel?.("button");
  };

  elements.shootButton.addEventListener("pointercancel", cancelButtonCharge);
  elements.shootButton.addEventListener("lostpointercapture", cancelButtonCharge);
  elements.shootButton.addEventListener("click", (event) => {
    if (event.detail === 0 && !elements.shootButton.disabled) handlers.onKeyboardShot?.();
  });

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => handlers.onMode?.(button.dataset.mode));
  });
  byId("new-game").addEventListener("click", () => handlers.onNewGame?.());
  byId("winner-restart").addEventListener("click", () => handlers.onNewGame?.());
  byId("reset-camera").addEventListener("click", () => handlers.onCamera?.());

  return {
    update(state, options = {}) {
      const balls = Array.isArray(state.balls) ? state.balls : [];
      const playerStates = Array.isArray(state.players) ? state.players : [];
      const current = Number(state.currentPlayer) === 1 ? 1 : 0;
      const currentPlayer = playerStates[current] || { type: "human", name: "YOU" };
      const isHuman = currentPlayer.type !== "cpu";
      const canControl = state.phase === "aiming" && isHuman;
      const charging = Boolean(options.charging);
      const mode = playerStates[1]?.type === "cpu" ? "cpu" : "local";
      const power = clamp(Number(options.charging ? options.chargePower : state.power) || 0);
      const powerPercent = Math.round(power * 100);

      elements.app.dataset.phase = state.phase || "aiming";
      elements.app.dataset.player = String(current);
      elements.app.classList.toggle("is-charging", charging);
      setText(elements.shotCounter, `SHOT ${String(Number(state.shotNumber) || 0).padStart(2, "0")}`);
      setText(elements.matchType, mode === "cpu" ? "VS CPU" : "LOCAL MATCH");

      modeButtons.forEach((button) => {
        const active = button.dataset.mode === mode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });

      playerStates.slice(0, 2).forEach((playerState, index) => {
        const player = players[index];
        const active = current === index && state.phase !== "gameover";
        const group = playerState.group === "solid" || playerState.group === "stripe" ? playerState.group : null;
        const remaining = remainingBalls(balls, group);
        player.card.classList.toggle("is-active", active);
        setText(player.name, playerState.name || (index === 0 ? "YOU" : mode === "cpu" ? "CPU" : "PLAYER 2"));
        setText(player.type, playerState.type === "cpu" ? "CPU OPPONENT" : "HUMAN PLAYER");
        setText(player.turn, active ? "AT TABLE" : state.phase === "gameover" && state.winner === index ? "WINNER" : "WAITING");
        setText(player.group, group ? `${group === "solid" ? "SOLIDS" : "STRIPES"} · ${remaining} LEFT` : "OPEN TABLE");
        setText(player.count, group ? `${7 - remaining} / 7 DOWN` : "— / 7");
        paintRack(player, group, balls);
      });

      elements.turnPill.classList.toggle("is-cpu", state.phase === "aiming" && !isHuman);
      elements.turnPill.classList.toggle("is-rolling", state.phase === "rolling");
      if (state.phase === "gameover") {
        setText(elements.turnLabel, "MATCH COMPLETE");
        setText(elements.contextHint, "Rack them up and play again");
      } else if (state.phase === "rolling") {
        setText(elements.turnLabel, "BALLS IN MOTION");
        setText(elements.contextHint, "Let the table settle");
      } else if (!isHuman) {
        setText(elements.turnLabel, "CPU IS THINKING");
        setText(elements.contextHint, "Your opponent is at the table");
      } else {
        setText(elements.turnLabel, mode === "local" ? `${currentPlayer.name || `PLAYER ${current + 1}`} TO PLAY` : "YOUR TURN");
        setText(elements.contextHint, charging ? `Charging shot · ${powerPercent}%` : "Move to aim · Hold to charge");
      }

      const fallbackMessage = state.phase === "rolling"
        ? "The balls are in motion. Watch the table."
        : isHuman
          ? "Line up your shot, choose your spin, and hold to charge."
          : "The CPU is lining up its next shot.";
      const message = state.message || fallbackMessage;
      setText(elements.message, message);
      elements.foulBadge.hidden = !/\bfoul\b|scratch|犯规|失误/i.test(message);

      elements.powerMeter.style.setProperty("--power", power.toFixed(3));
      elements.powerMeter.setAttribute("aria-valuenow", String(powerPercent));
      elements.shootButton.style.setProperty("--power", power.toFixed(3));
      setText(elements.powerValue, `${String(powerPercent).padStart(2, "0")}%`);
      elements.shootButton.disabled = !canControl && !charging;
      elements.shootButton.classList.toggle("is-charging", charging);
      elements.spinPad.setAttribute("aria-disabled", String(!canControl));
      elements.spinPad.tabIndex = canControl ? 0 : -1;
      elements.spinReset.disabled = !canControl;
      paintSpin(state.spin);

      if (charging) {
        setText(elements.shotStatus, `Release to strike at ${powerPercent}% power.`);
      } else if (state.phase === "rolling") {
        setText(elements.shotStatus, "Wait for every ball to settle.");
      } else if (state.phase === "gameover") {
        setText(elements.shotStatus, "Match complete. Rack up for another game.");
      } else if (!isHuman) {
        setText(elements.shotStatus, "CPU is calculating the angles…");
      } else {
        setText(elements.shotStatus, "Ready when you are.");
      }

      const hasWinner = state.phase === "gameover";
      elements.winnerOverlay.hidden = !hasWinner;
      if (hasWinner) {
        const winner = state.winner === 0 || state.winner === 1 ? state.winner : null;
        const winnerName = winner === null ? "MATCH OVER" : `${playerStates[winner]?.name || `PLAYER ${winner + 1}`} WINS`;
        setText(elements.winnerTitle, winnerName.toUpperCase());
        setText(elements.winnerDetail, state.message || "A fine finish at the Blackball club.");
      }
    },

    setCharging(charging) {
      elements.app.classList.toggle("is-charging", charging);
      elements.shootButton.classList.toggle("is-charging", charging);
    },

    setReady() {
      elements.loading.classList.add("is-ready");
    },

    showError(error) {
      elements.loading.hidden = true;
      elements.winnerOverlay.hidden = true;
      elements.fatalError.hidden = false;
      setText(elements.fatalErrorMessage, error?.message || "Please refresh and try again.");
    },
  };
}
