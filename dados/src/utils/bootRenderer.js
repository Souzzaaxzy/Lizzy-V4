/**
 * Boot visual da SESSÃO JÁ PAREADA (restauração de conexão automática).
 *
 * Este módulo é o ÚNICO responsável pela apresentação do boot quando a Lizzy já
 * tem sessão válida e conecta sozinha: animação de entrada, sequência de etapas,
 * ambiente, sessão, sistema, dados da bot e tela final.
 *
 * O fluxo de PRIMEIRO LOGIN (QR Code / código de pareamento) NÃO usa nada daqui —
 * ele mantém a apresentação original. Quem escolhe o fluxo é o `start.js`
 * (variável LIZZY_SESSION_BOOT); este renderer só aparece com ela ligada.
 *
 * O renderer NÃO executa as tarefas: ele apenas APRESENTA os estados que o
 * `connect.js` reporta (`step`, `setEnv`, `setQueue`, `summary`). Nada aqui abre
 * socket, lê credencial ou decide conexão.
 */

import fs from 'fs';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[1;32m',
  red: '\x1b[1;31m',
  yellow: '\x1b[1;33m',
  cyan: '\x1b[1;36m',
  blue: '\x1b[1;34m',
  magenta: '\x1b[1;35m',
  gray: '\x1b[90m',
};

const SPINNER = ['◐', '◓', '◑', '◒'];
const LINE = '──────────────────────────────────────────────────────────────';
const ASCII = !process.env.TERM || process.env.TERM === 'dumb';

/** Etapas da BOOT SEQUENCE. O `id` é a chave usada por connect.js. */
const STAGES = [
  { id: 'core', num: '01', label: 'CORE ENGINE' },
  { id: 'deps', num: '02', label: 'DEPENDENCIES' },
  { id: 'ytdlp', num: '03', label: 'YT-DLP' },
  { id: 'abyss', num: '04', label: 'ABYSS CORE' },
  { id: 'wa', num: '05', label: 'WHATSAPP ENGINE' },
  { id: 'opt', num: '06', label: 'OPTIMIZATION SYSTEM' },
  { id: 'plugins', num: '07', label: 'PLUGIN MANAGER' },
  { id: 'subbots', num: '08', label: 'SUB-BOT MANAGER' },
];

/** Rótulo/emoji de cada estado de etapa. */
function estadoEtapa(state) {
  switch (state) {
    case 'online': return `${C.green}✓ ONLINE${C.reset}`;
    case 'ready': return `${C.green}✓ READY${C.reset}`;
    case 'connected': return `${C.green}✓ CONNECTED${C.reset}`;
    case 'active': return `${C.green}✓ ACTIVE${C.reset}`;
    case 'loading': return `${C.yellow}◐ LOADING${C.reset}`;
    case 'checking': return `${C.yellow}◐ CHECKING${C.reset}`;
    case 'connecting': return `${C.yellow}◐ CONNECTING${C.reset}`;
    case 'warn': return `${C.yellow}! WARNING${C.reset}`;
    case 'failed': return `${C.red}✗ FAILED${C.reset}`;
    default: return `${C.gray}· PENDING${C.reset}`;
  }
}

/** Um estado "de sucesso" já confirmado? (usado no resumo/tela final) */
function etapaOk(state) {
  return ['online', 'ready', 'connected', 'active'].includes(state);
}

const pad = (s, n) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const visLen = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
const padVis = (s, n) => {
  const d = n - visLen(s);
  return d > 0 ? s + ' '.repeat(d) : s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BootRenderer {
  constructor(opts = {}) {
    this.enabled = opts.enabled === true;
    this.ttys = Boolean(process.stdout?.isTTY) && !ASCII;
    this.botName = opts.botName || 'Lizzy';
    this.prefix = opts.prefix ?? '!';
    this.owner = opts.owner || 'Owner';
    this.version = opts.version || '4';

    this.stages = new Map(STAGES.map((s) => [s.id, { ...s, state: 'pending', _start: null }]));
    this.snapshot = {
      serverIp: opts.serverIp || null,
      waVersion: null,
      baileys: opts.baileys || null,
      jidLid: null,
      captcha: null,
      botName: this.botName,
      prefix: this.prefix,
      owner: this.owner,
      parallel: null,
      subBots: null,
      optimization: 'pending',
      messageCounter: 'pending',
      autoReset: 'pending',
      pluginManager: 'pending',
      connectionError: null,
    };
    this.startedAt = Date.now();
    this.rendered = false;
    this.animated = !(this.enabled && this.ttys); // sem animação (não-TTY) já pode renderizar
    this._lastLineCount = 0;
    this._timer = null;
    this._spin = 0;

    if (this.enabled && this.ttys) {
      process.stdout.write('\x1b[?25l'); // esconde o cursor
      process.stdin?.resume?.();
      this._restoreCursor = () => process.stdout.write('\x1b[?25h');
      process.once('exit', this._restoreCursor);
    } else {
      this._restoreCursor = () => {};
    }
  }

  // ───────────────────────────── animação de entrada ─────────────────────────

  async intro() {
    if (!this.enabled || !this.ttys) return;
    const cols = 9;
    const rows = 5;

    const draw = (frames) => {
      const lines = [];
      for (let y = 0; y < rows; y++) {
        let line = '';
        for (let x = 0; x < cols; x++) {
          const cell = frames.find((f) => f.y === y && f.x === x);
          line += cell ? cell.ch : ' ';
        }
        lines.push(line.replace(/\s+$/, ''));
      }
      return lines;
    };

    const L = (x, y, ch = 'L') => ({ x, y, ch: `${C.bold}${C.cyan}${ch}${C.reset}` });
    const part = (x, y, ch) => ({ x, y, ch: `${C.magenta}${ch}${C.reset}` });

    const total = 9;
    for (let i = 0; i <= total; i++) {
      const t = i / total;
      const x = Math.round(t * 4);
      const y = Math.round(t * 3);
      const frames = i === total
        ? [L(4, 3, 'L'), part(3, 2, '✦'), part(5, 2, '✦'), part(4, 2, '•')]
        : [{ x, y, ch: `${C.cyan}●${C.reset}` }];
      this._paintBlock(draw(frames));
      await sleep(i === total ? 240 : 55);
    }

    await sleep(150);

    // Reação do "L" ao impacto: recuo lateral (a "caidinha") + a bola quicando.
    const reacao = [
      [L(5, 3, 'L'), { x: 6, y: 2, ch: `${C.cyan}·${C.reset}` }],
      [L(5, 3, 'L')],
      [L(3, 3, 'L'), { x: 2, y: 2, ch: `${C.cyan}·${C.reset}` }],
      [L(4, 3, 'L')],
    ];
    for (const f of reacao) {
      this._paintBlock(draw(f));
      await sleep(95);
    }

    await sleep(180);

    const letras = 'LIZZY';
    for (let i = 1; i <= letras.length; i++) {
      this._paintBlock([`${C.bold}${C.cyan}${letras.slice(0, i)}${C.reset}`]);
      await sleep(115);
    }

    const finalIntro = [
      '',
      `   ${C.bold}${C.cyan}L I Z Z Y${C.reset}`,
      `   ${C.gray}───────────────${C.reset}`,
      `   ${C.bold}SYSTEM BOOT${C.reset}`,
      `   ${C.dim}v${this.version}${C.reset}`,
      '',
    ];
    this._paintBlock(finalIntro);
    await sleep(320);
  }

  /**
   * Repinta um bloco curto usando a MESMA região: sobe o cursor N linhas,
   * limpa da posição atual até o fim da tela e reescreve. Não cria dezenas de
   * linhas novas.
   */
  _paintBlock(lines) {
    if (!this.ttys) return;
    if (this._lastLineCount > 0) {
      process.stdout.write(`\x1b[${this._lastLineCount}A`);
    }
    process.stdout.write('\x1b[0J');
    process.stdout.write(lines.join('\n') + '\n');
    this._lastLineCount = lines.length;
  }

  // ───────────────────────────── painel principal ────────────────────────────

  _box() {
    const w = 62;
    const title = 'L I Z Z Y';
    const sub = '───────────────';
    const out = [];
    out.push(`${C.cyan}╭${'─'.repeat(w)}╮${C.reset}`);
    out.push(`${C.cyan}│${C.reset}${' '.repeat(w)}${C.cyan}│${C.reset}`);
    out.push(`${C.cyan}│${C.reset}${padVis(title.padStart(Math.floor((w + title.length) / 2)), w)}${C.cyan}│${C.reset}`);
    out.push(`${C.cyan}│${C.reset}${padVis(sub.padStart(Math.floor((w + sub.length) / 2)), w)}${C.cyan}│${C.reset}`);
    out.push(`${C.cyan}│${C.reset}${padVis('SYSTEM BOOT'.padStart(Math.floor((w + 11) / 2)), w)}${C.cyan}│${C.reset}`);
    out.push(`${C.cyan}│${C.reset}${padVis(`v${this.version}`.padStart(Math.floor((w + 2 + String(this.version).length) / 2)), w)}${C.cyan}│${C.reset}`);
    out.push(`${C.cyan}│${C.reset}${' '.repeat(w)}${C.cyan}│${C.reset}`);
    out.push(`${C.cyan}╰${'─'.repeat(w)}╯${C.reset}`);
    return out;
  }

  _executivo() {
    const out = [];
    out.push(`${C.bold}◈ BOOT SEQUENCE${C.reset}`);
    out.push(`${C.blue}${LINE}${C.reset}`);
    for (const s of this.stages.values()) {
      const emAndamento = s.state === 'loading' || s.state === 'checking' || s.state === 'connecting';
      const est = emAndamento
        ? `${C.yellow}${SPINNER[this._spin % SPINNER.length]} ${{ loading: 'LOADING', checking: 'CHECKING', connecting: 'CONNECTING' }[s.state]}${C.reset}`
        : estadoEtapa(s.state);
      const prefix = `◇ ${s.num}  ${s.label}`;
      const dots = '.'.repeat(Math.max(2, 40 - visLen(prefix)));
      out.push(`${C.cyan}${prefix} ${C.gray}${dots}${C.reset} ${est}`);
    }
    return out;
  }

  _section(titulo, rows) {
    const out = [];
    out.push(``);
    out.push(`${C.bold}◈ ${titulo}${C.reset}`);
    out.push(`${C.blue}${LINE}${C.reset}`);
    for (const [k, v] of rows) {
      out.push(`${C.cyan}◇ ${pad(k, 16)}${C.gray}──►${C.reset} ${v}`);
    }
    return out;
  }

  _environment() {
    const ba = this.snapshot.baileys;
    let baileys = '—';
    if (ba) {
      baileys = `${ba.version}`;
      if (ba.repo) baileys += `     ${C.gray}│ FORK ──►${C.reset} ${ba.repo}`;
    }
    return this._section('ENVIRONMENT', [
      ['SERVER IP', this.snapshot.serverIp || `${C.dim}detectando…${C.reset}`],
      ['BAILEYS', baileys],
      ['WHATSAPP', this.snapshot.waVersion || `${C.dim}conectando…${C.reset}`],
    ]);
  }

  _session() {
    return this._section('SESSION', [
      ['SESSION', `${C.green}RESTORED${C.reset}`],
      ['CONNECTION', `${C.green}AUTO CONNECT${C.reset}`],
      ['JID-LID', this.snapshot.jidLid == null ? `${C.dim}—${C.reset}` : `${this.snapshot.jidLid} ENTRIES`],
      ['CAPTCHA', this.snapshot.captcha == null ? `${C.dim}—${C.reset}` : `${this.snapshot.captcha} PENDING`],
    ]);
  }

  _system() {
    const st = (v) => (etapaOk(v) ? `${C.green}✓ ACTIVE${C.reset}` : v === 'failed' ? `${C.red}✗ FAILED${C.reset}` : `${C.gray}· PENDING${C.reset}`);
    const sub = this.snapshot.subBots == null
      ? `${C.gray}· PENDING${C.reset}`
      : (this.snapshot.subBots.total === 0
        ? `${C.dim}nenhum${C.reset}`
        : `${this.snapshot.subBots.active}/${this.snapshot.subBots.total} ATIVOS`);
    return this._section('SYSTEM', [
      ['OPTIMIZATION', st(this.snapshot.optimization)],
      ['MESSAGE COUNTER', st(this.snapshot.messageCounter)],
      ['AUTO RESET', st(this.snapshot.autoReset)],
      ['PLUGIN MANAGER', st(this.snapshot.pluginManager)],
      ['SUB-BOTS', sub],
    ]);
  }

  _bot() {
    return this._section('BOT', [
      ['NAME', this.snapshot.botName || '—'],
      ['PREFIX', this.snapshot.prefix ?? '—'],
      ['OWNER', this.snapshot.owner || '—'],
      ['PARALLEL', this.snapshot.parallel || `${C.dim}—${C.reset}`],
    ]);
  }

  _render() {
    if (!this.ttys) return;
    const lines = [...this._box(), ''];
    lines.push(...this._executivo());
    lines.push(...this._environment());
    lines.push(...this._session());
    lines.push(...this._system());
    lines.push(...this._bot());
    lines.push('');

    if (this._lastLineCount > 0) {
      process.stdout.write(`\x1b[${this._lastLineCount}A`);
    }
    process.stdout.write('\x1b[0J');
    for (const l of lines) process.stdout.write(l + '\n');
    this._lastLineCount = lines.length;
    this.rendered = true;
  }

  /** Repinta o painel (sem duplicar linhas). Ignorado durante a animação. */
  render() {
    if (!this.enabled || !this.ttys || !this.animated || this._finished) return;
    this._render();
  }

  // ───────────────────────────── API usada pelo connect ──────────────────────

  /** Marca uma etapa com um estado explícito. */
  step(id, state) {
    const s = this.stages.get(id);
    if (!s) return;
    if (state === 'loading' || state === 'checking' || state === 'connecting') {
      s._start = s._start || Date.now();
    } else {
      s._start = null;
    }
    s.state = state;
    this.render();
  }

  setEnv(env = {}) {
    Object.assign(this.snapshot, env);
    this.render();
  }

  setQueue(parallel) {
    this.snapshot.parallel = parallel;
    this.render();
  }

  setSubBots(info) {
    this.snapshot.subBots = info;
    this.render();
  }

  setSystem(patch = {}) {
    Object.assign(this.snapshot, patch);
    this.render();
  }

  /** Inicia o giro do spinner e repinta a cada ~90ms. */
  startRefresh() {
    if (!this.enabled || !this.ttys || this._timer || this._finished) return this;
    this._timer = setInterval(() => {
      this._spin++;
      this._render();
    }, 90);
    if (this._timer.unref) this._timer.unref();
    return this;
  }

  stopRefresh() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return this;
  }

  /** Conclui a animação e permite a renderização do painel. */
  async ready() {
    await this.intro();
    this.animated = true;
    this.render();
    this.startRefresh();
  }

  /**
   * Conclui o boot. Se `{ error: true }`, as etapas que ainda não concluíram
   * são marcadas como FALHADAS (nunca falsifica sucesso); caso contrário, só
   * mostra o resumo do que realmente concluiu.
   */
  summary({ error = false } = {}) {
    this.stopRefresh();
    if (this._finished) return;
    if (error) {
      for (const s of this.stages.values()) {
        if (!etapaOk(s.state)) s.state = 'failed';
      }
    }
    this._render();
  }

  async finalize() {
    this._finished = true;
    this.stopRefresh();
    if (!this.enabled) return; // renderer desligado é 100% silencioso
    if (!this.ttys) {
      process.stdout.write(`${this.botName} ONLINE — sessão restaurada\n`);
      return;
    }
    const w = 18;
    const box = [
      `${C.green}╭${'─'.repeat(w)}╮${C.reset}`,
      `${C.green}│   ${C.bold}●${C.reset}${C.green}  ONLINE    │${C.reset}`,
      `${C.green}╰${'─'.repeat(w)}╯${C.reset}`,
    ];
    const bloco = [
      ...box,
      '',
      `   ${C.bold}${C.cyan}L I Z Z Y${C.reset}`,
      '',
      `   ${C.bold}WHATSAPP ENGINE READY${C.reset}`,
      '',
      `   ${C.bold}SYSTEM READY${C.reset}`,
      `   ${C.dim}WAITING FOR COMMANDS${C.reset}`,
      '',
      `   ${C.green}❯${C.reset}`,
      '',
    ];
    this._paintBlock(bloco);
    process.stdout.write('\x1b[?25h');
    this._restoreCursor = () => {};
  }

  destroy() {
    this._finished = true;
    this.stopRefresh();
    try { this._restoreCursor?.(); } catch {}
  }
}

/** Versão do bot a partir do package.json (sem hardcode). */
export function versaoDoProjeto() {
  try {
    const raiz = new URL('../../../', import.meta.url); // src -> dados -> raiz do projeto
    const pkg = JSON.parse(fs.readFileSync(new URL('package.json', raiz), 'utf8'));
    return String(pkg.version || '4').split('.')[0];
  } catch {
    return '4';
  }
}

export { STAGES };
export default BootRenderer;
