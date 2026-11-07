/**
 * Group Status — perguntas e respostas: armazenamento e gestão.
 *
 * Guarda o histórico das perguntas publicadas no status do grupo e das
 * respostas recebidas, em disco (não em RAM), com controle de duplicidade —
 * reconexão e sincronização fazem a mesma resposta chegar mais de uma vez.
 *
 * O módulo é PURO em relação ao socket: não envia nada, não conhece Baileys.
 * Recebe o que o handler já tem e devolve o que ele precisa mostrar. É isso
 * que o torna testável sem abrir conexão.
 *
 * ## Formato em disco (`database/statusQA.json`)
 *
 * ```json
 * {
 *   "version": 1,
 *   "grupos": {
 *     "<groupJid>": {
 *       "perguntas": [{
 *         "id": "3EB0...",            // id da mensagem do status publicado
 *         "texto": "...",
 *         "autor": "5511...@s.whatsapp.net",
 *         "criadoEm": 1790108013000,
 *         "respostas": [{
 *           "id": "3EB0...",          // id da resposta
 *           "participante": "5511...",
 *           "texto": "...",
 *           "recebidoEm": 1790108013000,
 *           "respostasAdmin": [{ "texto": "...", "enviadoEm": 1790108013000 }]
 *         }]
 *       }]
 *     }
 *   }
 * }
 * ```
 *
 * O isolamento é por GRUPO na própria chave — não existe consulta que atravesse
 * grupos, então uma resposta de um grupo não aparece em outro nem por acidente.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATABASE_DIR } from './paths.js';

const ARQUIVO = path.join(DATABASE_DIR, 'statusQA.json');

/** Teto de perguntas guardadas por grupo (as mais antigas saem primeiro). */
export const MAX_PERGUNTAS_POR_GRUPO = 20;
/** Teto de respostas guardadas por pergunta. */
export const MAX_RESPOSTAS_POR_PERGUNTA = 200;
/** Teto de respostas da administração guardadas por resposta. */
export const MAX_RESPOSTAS_ADMIN = 20;

const vazio = () => ({ version: 1, grupos: {} });

/**
 * Lê o arquivo do disco.
 *
 * Nunca lança: arquivo ausente, vazio ou corrompido devolve a estrutura vazia.
 * Um JSON quebrado não pode derrubar o handler de mensagens.
 *
 * @returns {{version: number, grupos: object}}
 */
export function ler() {
    try {
        if (!fs.existsSync(ARQUIVO)) return vazio();
        const bruto = JSON.parse(fs.readFileSync(ARQUIVO, 'utf-8'));
        if (!bruto || typeof bruto !== 'object' || typeof bruto.grupos !== 'object') return vazio();
        return { version: 1, grupos: bruto.grupos || {} };
    } catch {
        return vazio();
    }
}

/**
 * Grava no disco de forma atômica (tmp único + rename).
 *
 * O tmp tem pid + aleatório porque duas escritas simultâneas no mesmo caminho
 * fixo se atropelam — o primeiro rename consome o arquivo e o segundo falha.
 *
 * @param {{version: number, grupos: object}} dados
 * @returns {boolean} se gravou
 */
export function gravar(dados) {
    try {
        fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
        const tmp = `${ARQUIVO}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
        fs.renameSync(tmp, ARQUIVO);
        return true;
    } catch {
        return false;
    }
}

/**
 * Normaliza um id para comparação: tira o sufixo de device.
 *
 * `5511...:12@s.whatsapp.net` e `5511...@s.whatsapp.net` são a mesma pessoa, e
 * o WhatsApp entrega as duas formas conforme o caminho. Sem isso, a dedup por
 * participante falharia.
 *
 * @param {string} jid
 * @returns {string}
 */
export const baseId = (jid) => String(jid || '').replace(/:\d+@/, '@');

/** @returns {boolean} se os dois ids são a mesma pessoa. */
export const mesmoId = (a, b) => !!a && !!b && baseId(a) === baseId(b);

/**
 * Registra uma PERGUNTA publicada.
 *
 * Reusa o id da mensagem publicada — é o `originalMessageKey.id` que o servidor
 * devolve na notificação, então é ele que liga pergunta e resposta.
 *
 * @param {string} grupoJid
 * @param {{id: string, texto: string, autor?: string, criadoEm?: number}} pergunta
 * @returns {object|null} a pergunta registrada, ou `null` se inválida
 */
export function registrarPergunta(grupoJid, pergunta) {
    if (!grupoJid || !pergunta?.id) return null;
    const dados = ler();
    dados.grupos[grupoJid] = dados.grupos[grupoJid] || { perguntas: [] };
    const lista = dados.grupos[grupoJid].perguntas;

    const registro = {
        id: pergunta.id,
        texto: String(pergunta.texto || ''),
        autor: pergunta.autor || null,
        criadoEm: pergunta.criadoEm || Date.now(),
        respostas: []
    };
    // republicar o mesmo id não duplica
    const existente = lista.findIndex((p) => p.id === registro.id);
    if (existente >= 0) lista[existente] = { ...lista[existente], ...registro, respostas: lista[existente].respostas || [] };
    else lista.push(registro);

    if (lista.length > MAX_PERGUNTAS_POR_GRUPO) {
        dados.grupos[grupoJid].perguntas = lista.slice(-MAX_PERGUNTAS_POR_GRUPO);
    }
    gravar(dados);
    return registro;
}

/**
 * Registra uma RESPOSTA recebida, com deduplicação.
 *
 * A dedup é pelo id da resposta. Se o id não vier (o protocolo pode não mandar
 * em algum caminho), cai para `participante + texto` — melhor deduplicar por
 * conteúdo do que gravar a mesma resposta duas vezes numa reconexão.
 *
 * @param {string} grupoJid
 * @param {{statusId: string, id?: string, participante?: string,
 *          texto?: string, recebidoEm?: number, pushName?: string}} resposta
 * @returns {{ok: boolean, motivo?: string, resposta?: object, duplicada?: boolean}}
 */
export function registrarResposta(grupoJid, resposta) {
    if (!grupoJid || !resposta?.statusId) return { ok: false, motivo: 'sem_status' };
    const dados = ler();
    const pergunta = (dados.grupos[grupoJid]?.perguntas || []).find((p) => p.id === resposta.statusId);
    if (!pergunta) return { ok: false, motivo: 'status_desconhecido' };

    pergunta.respostas = pergunta.respostas || [];
    const chave = (r) =>
        r.id ? `id:${r.id}` : `pt:${baseId(r.participante)}:${String(r.texto || '').trim()}`;
    const nova = {
        id: resposta.id || null,
        participante: resposta.participante || null,
        pushName: resposta.pushName || null,
        texto: resposta.texto != null ? String(resposta.texto) : null,
        recebidoEm: resposta.recebidoEm || Date.now(),
        respostasAdmin: []
    };
    if (pergunta.respostas.some((r) => chave(r) === chave(nova))) {
        return { ok: true, duplicada: true, resposta: nova };
    }
    pergunta.respostas.push(nova);
    if (pergunta.respostas.length > MAX_RESPOSTAS_POR_PERGUNTA) {
        pergunta.respostas = pergunta.respostas.slice(-MAX_RESPOSTAS_POR_PERGUNTA);
    }
    gravar(dados);
    return { ok: true, duplicada: false, resposta: nova };
}

/**
 * Registra uma RESPOSTA DA ADMINISTRAÇÃO a uma resposta.
 *
 * @param {string} grupoJid
 * @param {string} statusId
 * @param {number} indice 1-based, o MESMO número que o `!statusview` mostra
 * @param {{texto: string, enviadoEm?: number}} respostaAdmin
 * @returns {{ok: boolean, motivo?: string, resposta?: object}}
 */
export function registrarRespostaAdmin(grupoJid, statusId, indice, respostaAdmin) {
    const dados = ler();
    const pergunta = (dados.grupos[grupoJid]?.perguntas || []).find((p) => p.id === statusId);
    if (!pergunta) return { ok: false, motivo: 'status_desconhecido' };
    const lista = pergunta.respostas || [];
    const alvo = lista[indice - 1];
    if (!alvo) return { ok: false, motivo: 'indice_invalido' };

    alvo.respostasAdmin = alvo.respostasAdmin || [];
    alvo.respostasAdmin.push({
        texto: String(respostaAdmin?.texto || ''),
        enviadoEm: respostaAdmin?.enviadoEm || Date.now()
    });
    if (alvo.respostasAdmin.length > MAX_RESPOSTAS_ADMIN) {
        alvo.respostasAdmin = alvo.respostasAdmin.slice(-MAX_RESPOSTAS_ADMIN);
    }
    gravar(dados);
    return { ok: true, resposta: alvo };
}

/**
 * Devolve a pergunta MAIS RECENTE do grupo (a que o `!statusview` mostra).
 *
 * @param {string} grupoJid
 * @returns {object|null}
 */
export function perguntaAtiva(grupoJid) {
    const lista = ler().grupos[grupoJid]?.perguntas || [];
    return lista.length ? lista[lista.length - 1] : null;
}

/**
 * Busca uma pergunta pelo id, DENTRO de um grupo.
 *
 * O `grupoJid` é obrigatório de propósito: sem ele, um id de outro grupo
 * poderia ser consultado — e o requisito é que um grupo não veja o outro.
 *
 * @param {string} grupoJid
 * @param {string} statusId
 * @returns {object|null}
 */
export function buscarPergunta(grupoJid, statusId) {
    if (!grupoJid || !statusId) return null;
    return (ler().grupos[grupoJid]?.perguntas || []).find((p) => p.id === statusId) || null;
}

/**
 * Localiza a pergunta de um grupo a que uma RESPOSTA pertence.
 *
 * É a validação que impede responder a uma resposta de outra pergunta: só
 * devolve algo quando o `indice` existe naquela pergunta.
 *
 * @param {string} grupoJid
 * @param {string} statusId
 * @param {number} indice 1-based
 * @returns {{pergunta: object, resposta: object}|null}
 */
export function respostasPorIndice(grupoJid, statusId, indice) {
    const pergunta = buscarPergunta(grupoJid, statusId);
    if (!pergunta) return null;
    const resposta = (pergunta.respostas || [])[indice - 1];
    if (!resposta) return null;
    return { pergunta, resposta };
}

/**
 * Remove perguntas mais antigas que o TTL (status expira).
 *
 * O status do WhatsApp tem validade; guardar para sempre só acumula lixo.
 *
 * @param {number} [ttlMs] padrão 7 dias
 * @returns {number} quantas perguntas saíram
 */
export function limparExpiradas(ttlMs = 7 * 24 * 60 * 60 * 1000) {
    const dados = ler();
    const corte = Date.now() - ttlMs;
    let removidas = 0;
    for (const grupoJid of Object.keys(dados.grupos)) {
        const antes = dados.grupos[grupoJid].perguntas || [];
        const depois = antes.filter((p) => (p.criadoEm || 0) >= corte);
        removidas += antes.length - depois.length;
        if (depois.length) dados.grupos[grupoJid].perguntas = depois;
        else delete dados.grupos[grupoJid];
    }
    if (removidas) gravar(dados);
    return removidas;
}

/** Apaga tudo (usado em teste). */
export function limparTudo() {
    gravar(vazio());
}

/**
 * Monta o texto do `!statusview` a partir da pergunta e das respostas.
 *
 * Puro: recebe os dados e um resolvedor de nome (o handler passa o resolvedor
 * ÚNICO de contato). Devolve `{ texto, mentions }` — as menções reais são o que
 * faz o `@` renderizar no cliente.
 *
 * @param {object} pergunta
 * @param {{nomeDe: (jid: string) => string, botName?: string, limite?: number}} opts
 * @returns {{texto: string, mentions: string[]}}
 */
export function montarStatusView(pergunta, { nomeDe, botName = 'Bot', limite = 20 } = {}) {
    const TOPO = '╭━━━꧁༺ ❓ 𝐒𝐓𝐀𝐓𝐔𝐒 • 𝐏𝐄𝐑𝐆𝐔𝐍𝐓𝐀 ༻꧂━━━╮';
    const FECHO = `╰━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╯`;
    if (!pergunta) {
        return {
            texto: `${TOPO}\n┃\n┃ 📭 Nenhuma pergunta publicada ainda.\n┃ Use o comando para publicar uma.\n┃\n${FECHO}`,
            mentions: []
        };
    }
    const respostas = pergunta.respostas || [];
    const mentions = [];
    const linhas = [TOPO, '┃', `┃ ❓ ${pergunta.texto}`, '┃'];

    if (!respostas.length) {
        linhas.push('┃ 📭 Nenhuma resposta recebida ainda.', '┃');
    } else {
        linhas.push(`┃ 📩 Respostas recebidas: ${respostas.length}`, '┃');
        respostas.slice(0, limite).forEach((r, i) => {
            const jid = r.participante;
            const nome = jid ? nomeDe(jid) : (r.pushName || 'Participante');
            if (jid) mentions.push(jid);
            const quando = r.recebidoEm ? ` — ${new Date(r.recebidoEm).toLocaleString('pt-BR')}` : '';
            linhas.push(`┃ ${i + 1}. ${nome}${quando}`);
            if (r.texto) linhas.push(`┃    ${r.texto}`);
            const adm = r.respostasAdmin || [];
            if (adm.length) linhas.push(`┃    ↳ respondido (${adm.length})`);
            linhas.push('┃');
        });
        if (respostas.length > limite) {
            linhas.push(`┃ … e mais ${respostas.length - limite} resposta(s).`, '┃');
        }
    }
    linhas.push('┃ Para responder: responder <n> <texto>', FECHO);
    return { texto: linhas.join('\n'), mentions };
}
