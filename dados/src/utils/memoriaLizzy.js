/**
 * A CHAVE da memoria da Lizzy: por GRUPO, por pessoa, por personalidade.
 *
 * ## O que mudou (e por que)
 *
 * A chave era `id_enviou_personalidade` — sem o grupo. O proprio comentario do
 * codigo dizia a intencao: *"manter contexto entre grupos"*. O dono pediu o
 * oposto: a Lizzy deve ter uma memoria POR GRUPO. E a personalidade continua
 * sendo uma so' (a Lizzy) — ela entra na chave como a dimensao que sempre foi.
 *
 * ## A forma
 *
 *     grupo|usuario|personalidade
 *
 * Ex.: `120363425268923269@g.us|5511915323638@s.whatsapp.net|lizzy`
 *
 * O separador e' `|` de proposito: JID e LID contem `@`, `.` e `:` — nunca `|`.
 * (Separar por `_` colidiria: o id `a_b` e o grupo `a` com pessoa `b` dariam a
 * mesma chave.)
 *
 * ## Conversa privada (PV)
 *
 * Em PV nao ha' grupo. O escopo passa a ser o JID da propria conversa — que e'
 * o que o handler ja' manda em `extraContext.groupId` (`from`). Assim a memoria
 * de PV continua isolada por pessoa, sem chave vazia nem memoria compartilhada
 * entre desconhecidos.
 *
 * ## Compatibilidade
 *
 * As memorias antigas ficam sob a chave LEGADA (`id_personalidade`) e nao sao
 * lidas. `chaveLegada` existe para o teste conseguir provar que a migracao e'
 * exatamente a adicao do escopo — nada mais.
 */

/** O escopo usado quando nao ha' grupo (a memoria cai no PV da propria pessoa). */
export const ESCOPO_PV = 'pv';

/**
 * A chave de memoria de UMA conversa.
 *
 * @param {object} p
 * @param {string} p.idGrupo  JID do grupo (`...@g.us`) ou o JID da conversa em PV
 * @param {string} p.idUsuario JID/LID de quem fala
 * @param {string} [p.personalidade] a personalidade (uma so': `lizzy`)
 * @returns {string} `grupo|usuario|personalidade`
 */
export function chaveDaMemoria({ idGrupo, idUsuario, personalidade = 'lizzy' } = {}) {
  const grupo = String(idGrupo || '').trim() || ESCOPO_PV;
  const usuario = String(idUsuario || '').trim();
  const pers = String(personalidade || '').trim() || 'lizzy';
  return `${grupo}|${usuario}|${pers}`;
}

/**
 * A chave ANTIGA (`id_usuario_personalidade`), sem o grupo.
 *
 * Serve so' para o teste medir a migracao: a chave nova tem de ser a antiga
 * MAIS o escopo. Nao use no fluxo.
 *
 * @param {string} idUsuario
 * @param {string} [personalidade]
 * @returns {string}
 */
export function chaveLegada(idUsuario, personalidade = 'lizzy') {
  return `${String(idUsuario || '')}_${String(personalidade || '')}`;
}
