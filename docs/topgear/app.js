const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const info = document.getElementById('info');
const playBtn = document.getElementById('play');
const pad = document.getElementById('pad');

const W = canvas.width;
const H = canvas.height;

const keys = { up: false, down: false, left: false, right: false, a: false, b: false };

const MAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', z: 'b', x: 'a'
};

addEventListener('keydown', (e) => {
  const k = MAP[e.key] || MAP[e.key.toLowerCase()];
  if (k) { keys[k] = true; e.preventDefault(); }
});

addEventListener('keyup', (e) => {
  const k = MAP[e.key] || MAP[e.key.toLowerCase()];
  if (k) { keys[k] = false; e.preventDefault(); }
});

for (const el of pad.querySelectorAll('[data-k]')) {
  const k = el.dataset.k;
  const on = (e) => { keys[k] = true; el.classList.add('on'); e.preventDefault(); };
  const off = (e) => { keys[k] = false; el.classList.remove('on'); e.preventDefault(); };
  el.addEventListener('touchstart', on, { passive: false });
  el.addEventListener('touchend', off, { passive: false });
  el.addEventListener('touchcancel', off, { passive: false });
  el.addEventListener('mousedown', on);
  el.addEventListener('mouseup', off);
  el.addEventListener('mouseleave', off);
}

const state = {
  car: { x: W / 2, y: H - 52, speed: 0, steer: 0 },
  road: 0,
  t: 0,
  frames: 0,
  wasm: null
};

function update(dt) {
  const car = state.car;
  const accel = keys.up ? 190 : keys.down ? -150 : -40;
  car.speed = Math.max(0, Math.min(230, car.speed + accel * dt));

  const target = keys.left ? -1 : keys.right ? 1 : 0;
  car.steer += (target - car.steer) * Math.min(1, dt * 9);
  car.x += car.steer * car.speed * dt * 0.55;
  car.x = Math.max(28, Math.min(W - 28, car.x));

  state.road = (state.road + car.speed * dt) % 40;
  state.t += dt;
  state.frames++;
}

function draw() {
  ctx.fillStyle = '#1f6b3a';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#3a3f47';
  ctx.fillRect(W / 2 - 95, 0, 190, H);

  ctx.fillStyle = '#e8ecf3';
  for (let y = -40 + state.road; y < H; y += 40) {
    ctx.fillRect(W / 2 - 3, y, 6, 20);
  }

  ctx.fillStyle = '#f2f4f8';
  ctx.fillRect(W / 2 - 98, 0, 6, H);
  ctx.fillRect(W / 2 + 92, 0, 6, H);

  const car = state.car;
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.steer * 0.18);
  ctx.fillStyle = '#d92b2b';
  ctx.fillRect(-16, -24, 32, 48);
  ctx.fillStyle = '#2b3340';
  ctx.fillRect(-13, -14, 26, 14);
  ctx.fillStyle = '#111';
  ctx.fillRect(-19, -20, 5, 14);
  ctx.fillRect(14, -20, 5, 14);
  ctx.fillRect(-19, 8, 5, 14);
  ctx.fillRect(14, 8, 5, 14);
  ctx.restore();

  ctx.fillStyle = '#e8ecf3';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(`${Math.round(car.speed)} km/h`, 10, 18);
  ctx.fillText(`${state.frames} frames`, 10, 34);
}

let last = performance.now();
let rodando = false;
let rafId = 0;

function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  rafId = requestAnimationFrame(loop);
}

function iniciarLoop() {
  if (rodando) return;
  rodando = true;
  last = performance.now();
  rafId = requestAnimationFrame(loop);
}

function pararLoop() {
  if (!rodando) return;
  rodando = false;
  cancelAnimationFrame(rafId);
}

function resetar() {
  pararLoop();
  state.car = { x: W / 2, y: H - 52, speed: 0, steer: 0 };
  state.road = 0;
  state.t = 0;
  state.frames = 0;
  playBtn.disabled = false;
  playBtn.textContent = 'JOGAR';
  draw();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pararLoop();
  else if (playBtn.textContent === 'RODANDO') iniciarLoop();
});

addEventListener('pagehide', pararLoop);
addEventListener('blur', pararLoop);

async function loadEngine() {
  try {
    const res = await fetch('./engine/emulator.wasm', { cache: 'force-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const bytes = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    state.wasm = instance.exports;
    return true;
  } catch (e) {
    state.wasm = null;
    state.motivo = String(e && e.message || e);
    return false;
  }
}

playBtn.addEventListener('click', () => {
  if (playBtn.textContent === 'RODANDO') {
    resetar();
    return;
  }
  playBtn.disabled = true;
  playBtn.textContent = 'RODANDO';
  info.textContent = state.wasm
    ? 'Engine WASM carregada. Sem ROM — modo demonstração.'
    : 'Sem WASM (CSP) — modo demonstração em canvas.';
  iniciarLoop();
});

loadEngine().then((ok) => {
  if (ok) {
    info.textContent = 'WASM ok — aguardando ROM.';
  } else if (/wasm-unsafe-eval|CompileError|instantiate/i.test(state.motivo || '')) {
    info.textContent = 'WASM bloqueada pelo CSP do site — modo demonstração em canvas.';
  } else {
    info.textContent = 'WASM não encontrada — demonstração de canvas.';
  }
  playBtn.disabled = false;
  draw();
});
