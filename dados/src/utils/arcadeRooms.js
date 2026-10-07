/**
 * SALAS DE ARCADE (multiplayer via netplay) — estado em memoria.
 *
 * Fluxo: alguem chama `!kof @fulano` -> guarda um CONVITE pendente (quem
 * convidou, quem foi convidado, qual jogo). O convidado responde `sim` e a sala
 * e criada; os dois recebem o link com o codigo da sala.
 *
 * O estado vive em MEMORIA (igual as calls do `!callp`): uma sala de jogo e
 * efemera e morre com o processo. Persistir em JSON faria sala zumbi depois de
 * um restart.
 *
 * Modulo PURO: sem socket, sem arquivo, sem timers proprios — quem agenda a
 * expiracao e o handler.
 */

/** Convites pendentes: chave = `${grupo}|${convidado}`. */
const convites = new Map();
/** Salas criadas: chave = `${grupo}|${codigo}`. */
const salas = new Map();

export const CONVITE_TTL_MS = 5 * 60 * 1000; // 5 min para aceitar/recusar
export const SALA_TTL_MS = 6 * 60 * 60 * 1000; // 6h (limpeza de sala abandonada)

/** Normaliza para a forma "base" (sem device, sem dominio) — so os digitos. */
export function baseId(id) {
  return String(id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** Dois ids sao a mesma pessoa? (LID x JID x numero) */
export function mesmoUsuario(a, b) {
  const x = baseId(a);
  const y = baseId(b);
  return Boolean(x) && x === y;
}

const chaveConvite = (grupo, convidado) => `${grupo}|${baseId(convidado)}`;
const chaveSala = (grupo, codigo) => `${grupo}|${String(codigo).toUpperCase()}`;

/**
 * Cria (ou substitui) o convite de uma sala. Devolve o convite gravado.
 */
export function criarConvite({ grupo, anfitriao, convidado, jogo, agora = Date.now() }) {
  if (!grupo || !convidado || !jogo?.id) return null;
  const convite = {
    grupo,
    anfitriao,
    convidado,
    jogoId: jogo.id,
    jogoNome: jogo.nome,
    criadoEm: agora,
    expiraEm: agora + CONVITE_TTL_MS,
  };
  convites.set(chaveConvite(grupo, convidado), convite);
  return convite;
}

/** O convite pendente para este convidado neste grupo (ou null). */
export function convitePendente(grupo, convidado, agora = Date.now()) {
  const c = convites.get(chaveConvite(grupo, convidado));
  if (!c) return null;
  if (agora > c.expiraEm) {
    convites.delete(chaveConvite(grupo, convidado));
    return null;
  }
  return c;
}

/** Remove o convite (aceito, recusado ou expirado). */
export function removerConvite(grupo, convidado) {
  return convites.delete(chaveConvite(grupo, convidado));
}

/** Codigo curto e legivel para a sala (sem 0/O/1/I, para ditar sem confusao). */
export function gerarCodigo(rng = Math.random) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alfabeto[Math.floor(rng() * alfabeto.length)];
  return out;
}

/**
 * Cria a sala de jogo. `jogadores` e a lista de ids que vao jogar (anfitriao
 * primeiro). Devolve a sala gravada.
 */
export function criarSala({ grupo, jogo, jogadores, codigo, agora = Date.now(), rng = Math.random }) {
  if (!grupo || !jogo?.id) return null;
  const lista = (jogadores || []).filter(Boolean);
  if (lista.length < 2) return null;
  let code = codigo || gerarCodigo(rng);
  while (salas.has(chaveSala(grupo, code))) code = gerarCodigo(rng);
  const sala = {
    codigo: code,
    grupo,
    jogoId: jogo.id,
    jogoNome: jogo.nome,
    jogadores: lista,
    criadoEm: agora,
    expiraEm: agora + SALA_TTL_MS,
  };
  salas.set(chaveSala(grupo, code), sala);
  return sala;
}

/** Busca a sala pelo codigo (ou null). */
export function buscarSala(grupo, codigo, agora = Date.now()) {
  const s = salas.get(chaveSala(grupo, codigo));
  if (!s) return null;
  if (agora > s.expiraEm) {
    salas.delete(chaveSala(grupo, codigo));
    return null;
  }
  return s;
}

/** O usuario esta nesta sala? (aceita LID/JID/numero) */
export function estaNaSala(sala, usuario) {
  if (!sala) return false;
  return (sala.jogadores || []).some((j) => mesmoUsuario(j, usuario));
}

/** Apaga a sala. */
export function removerSala(grupo, codigo) {
  return salas.delete(chaveSala(grupo, codigo));
}

/** Limpeza: remove convites e salas vencidos. Devolve quantos removeu. */
export function limparExpirados(agora = Date.now()) {
  let n = 0;
  for (const [k, c] of convites) {
    if (agora > c.expiraEm) { convites.delete(k); n++; }
  }
  for (const [k, s] of salas) {
    if (agora > s.expiraEm) { salas.delete(k); n++; }
  }
  return n;
}

/** So para teste: zera tudo. */
export function limparTudo() {
  convites.clear();
  salas.clear();
}

export default {
  CONVITE_TTL_MS, SALA_TTL_MS,
  criarConvite, convitePendente, removerConvite,
  gerarCodigo, criarSala, buscarSala, estaNaSala, removerSala,
  limparExpirados, limparTudo, baseId, mesmoUsuario,
};
