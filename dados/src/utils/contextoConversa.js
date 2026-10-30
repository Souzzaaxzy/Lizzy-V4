/**
 * O CONTEXTO da conversa da Lizzy — fonte ÚNICA dos dois canais.
 *
 * ## Por que existe (e o que ele evita)
 *
 * A Lizzy fala por dois canais: o **chat** (`!assistente`) e a **call**
 * (`!iap`). Os dois precisam das mesmas coisas para soar como a mesma pessoa:
 * quem está falando (JID -> NOME DO CONTATO), quem é o dono, e os dados do
 * grupo (dono, admins, criação, membros).
 *
 * Se cada canal montasse o seu, os dois divergiriam na primeira mudança — e é
 * justamente esse o erro que o repo já pagou caro (duas personalidades, duas
 * cadeias de modelo, dois resolvedores de nome). Aqui a coleta e o formato
 * ficam num lugar só.
 *
 * ## A divisão: COLETA x FORMATO
 *
 * - `coletarDadosDoGrupo()` precisa de socket/metadata, então é **async** e
 *   recebe tudo por parâmetro (nada global) — quem tem o `nazu` é o handler;
 * - `montarContextoDaConversa()` e `montarBlocoDoGrupo()` são **puros**: só
 *   transformam o que já foi coletado em texto. É o que os torna testáveis sem
 *   abrir conexão.
 *
 * Nada aqui lança: cada bloco é best-effort. Um campo que falha simplesmente
 * não aparece — melhor faltar uma linha do que a Lizzy dizer um nome ou número
 * que não existe.
 */

import { resolverNomeContato, resolverNomesContatos } from './contactName.js';

/** `id` sem `:device` e sem `@...` (o mesmo corte do resto do bot). */
function baseDe(v) {
  return String(v || '').split('@')[0].split(':')[0];
}

/** Só devolve a string quando ela tem conteúdo (evita `null`/vazio no texto). */
function limpo(v) {
  return (typeof v === 'string' && v.trim()) ? v.trim() : null;
}

/**
 * Duas identidades são a MESMA pessoa? (compara pela base: sem `:device`/`@`)
 *
 * É o mesmo critério do `idsMatch` do bot, reduzido ao que este módulo precisa
 * (o LID do config vs. o JID/LID de quem fala).
 */
function mesmaPessoa(a, b) {
  const x = baseDe(a);
  const y = baseDe(b);
  return Boolean(x) && Boolean(y) && x === y;
}

/**
 * Quem está falando é um dos PAIS ADOTIVOS da Lizzy?
 *
 * ## Por que isto existe (o bug do dono)
 *
 * O `config.json` guarda o LID do pai e da mãe, e o prompt manda a Lizzy
 * tratá-los como pai/mãe. Mas o CONTEXTO só dizia "quem está falando é o
 * Kannon" — nunca "o Kannon é o SEU PAI". Resultado: ela não reconhecia os
 * pais sozinha e tratava o pai como qualquer pessoa.
 *
 * Aqui o casamento é por LID **ou** por nome: o config pode ter só o LID (e o
 * nome resolvido depois) ou só o nome escrito à mão.
 *
 * @param {string} quem JID/LID de quem fala
 * @param {string} [nome] nome resolvido de quem fala
 * @param {Array<{papel:string, lid:string, nome:string}>} pais
 * @returns {{papel:string, nome:string}|null}
 */
export function quemEhDosPais(quem, nome, pais = []) {
  if (!Array.isArray(pais) || !pais.length) return null;
  const nomeBaixo = limpo(nome) ? String(nome).trim().toLowerCase() : null;
  for (const p of pais) {
    if (!p) continue;
    if (p.lid && mesmaPessoa(p.lid, quem)) return { papel: String(p.papel || 'responsavel'), nome: limpo(p.nome) };
    // Sem LID (ou LID não bate): casa pelo NOME, que é o que o dono escreveu.
    if (nomeBaixo && limpo(p.nome) && String(p.nome).trim().toLowerCase() === nomeBaixo) {
      return { papel: String(p.papel || 'responsavel'), nome: limpo(p.nome) };
    }
  }
  return null;
}

/**
 * Coleta os dados do grupo e o reconhecimento do dono do bot.
 *
 * @param {object} p
 * @param {object} [p.nazu] socket (para `getName`/`store.contacts`)
 * @param {object} [p.metadata] `groupMetadata` (participants/owner/creation/desc)
 * @param {string} [p.from] jid do chat
 * @param {string} [p.groupName] nome do grupo (fallback do `subject`)
 * @param {string[]} [p.numerosDono] número E LID do dono (config)
 * @param {string} [p.nomeDonoBot] nome do dono (config)
 * @param {string} [p.sender] quem está falando (para saber se é o dono)
 * @param {function} [p.matchId] comparador de identidade (`idsMatch` do bot)
 * @param {boolean} [p.isGroup]
 * @returns {Promise<{ donoDoBot: object, grupo: object|null }>}
 */
export async function coletarDadosDoGrupo({
  nazu, metadata, from, groupName, numerosDono = [], nomeDonoBot,
  sender, matchId, isGroup = true,
  // Mods e Alphas sao do BOT (por grupo), nao do WhatsApp: vem do `groupData`.
  moderadores = [], alphas = [], nomeDe = null,
  // A FOTO e' opcional e custa uma chamada; quem quer passa `comFoto: true`.
  comFoto = false
} = {}) {
  const dadosDoGrupo = {};

  // O dono do bot: número E lid, para reconhecer de qualquer forma. O
  // comparador entra por parâmetro (`idsMatch`), que é a MESMA checagem do
  // resto do bot — nada de uma regra paralela de identidade.
  try {
    const numeros = numerosDono.filter(Boolean).map(String);
    const compara = typeof matchId === 'function' ? matchId : (a, b) => String(a) === String(b);
    dadosDoGrupo.donoDoBot = {
      nome: nomeDonoBot || null,
      numeros,
      falanteEhDono: Boolean(sender) && numeros.some((n) => compara(n, sender))
    };
  } catch { /* segue sem o dono */ }

  if (!isGroup || !metadata) return dadosDoGrupo;

  try {
    const parts = Array.isArray(metadata.participants) ? metadata.participants : [];
    const ehAdmin = (p) => p?.admin === 'admin' || p?.admin === 'superadmin';

    // O CRIADOR: `superadmin` quando o metadata marca; senão, o `owner`.
    const criador = parts.find((p) => p?.admin === 'superadmin')
      || (metadata.owner ? { id: metadata.owner } : null);
    const admins = parts.filter(ehAdmin);

    // Nomes dos admins pelo MESMO resolvedor do `!me`/`!cf`.
    // ATENÇÃO: `resolverNomesContatos` devolve um **Map** (id -> nome).
    let nomesAdmins = [];
    try {
      const ids = admins.map((a) => a?.id || a?.lid || a?.phoneNumber).filter(Boolean);
      const mapa = await resolverNomesContatos(ids, { nazu, metadata, from });
      nomesAdmins = [...mapa.values()].filter(Boolean);
    } catch { /* segue sem os nomes */ }

    let nomeDonoGrupo = null;
    try {
      const idCriador = criador?.id || criador?.lid;
      if (idCriador) {
        nomeDonoGrupo = await resolverNomeContato(idCriador, { nazu, metadata, from });
      }
    } catch { /* segue sem o nome */ }

    dadosDoGrupo.grupo = {
      nome: metadata.subject || groupName || null,
      descricao: metadata.desc || null,
      // `creation` vem em SEGUNDOS no metadata do WhatsApp.
      criadoEm: metadata.creation
        ? new Date(Number(metadata.creation) * 1000).toLocaleDateString('pt-BR')
        : null,
      totalMembros: parts.length,
      dono: criador
        ? { nome: nomeDonoGrupo, numero: baseDe(criador.id || criador.lid) }
        : null,
      admins: nomesAdmins.slice(0, 20),
      totalAdmins: admins.length
    };

    // MODERADORES e ALPHAS: sao do BOT (quem o dono promoveu), nao do WhatsApp.
    // Nomes resolvidos pelo MESMO resolvedor — sem sistema paralelo.
    try {
      const nomesDe = async (lista) => {
        if (!Array.isArray(lista) || !lista.length) return [];
        try {
          const mapa = await resolverNomesContatos(lista.filter(Boolean), { nazu, metadata, from });
          return [...mapa.values()].filter(Boolean);
        } catch { return []; }
      };
      const nomesMods = await nomesDe(moderadores);
      const nomesAlphas = await nomesDe(alphas);
      if (nomesMods.length) {
        dadosDoGrupo.grupo.moderadores = nomesMods;
        dadosDoGrupo.grupo.totalModeradores = moderadores.length;
      }
      if (nomesAlphas.length) {
        dadosDoGrupo.grupo.alphas = nomesAlphas;
        dadosDoGrupo.grupo.totalAlphas = alphas.length;
      }
    } catch { /* segue sem mods/alphas */ }
  } catch { /* segue sem os dados do grupo */ }

  // A FOTO do grupo: `profilePictureUrl` LANCA quando o grupo nao tem foto (e
  // pode demorar). Por isso e' opcional e best-effort — nunca derruba a coleta.
  // Vai DENTRO de `grupo` para os dois formatadores (chat e voz) a lerem sem
  // precisar de um campo paralelo.
  if (dadosDoGrupo.grupo && comFoto && nazu && typeof nazu.profilePictureUrl === 'function') {
    try {
      const url = await nazu.profilePictureUrl(from, 'image');
      if (url) dadosDoGrupo.grupo.foto = url;
    } catch { /* grupo sem foto */ }
  }

  return dadosDoGrupo;
}

/**
 * Resolve o NOME dos pais adotivos a partir do LID.
 *
 * O `config.json` guarda o **LID** (o config não tem socket); quem tem o socket
 * e os contatos é o handler. Aqui o LID vira nome pelo MESMO resolvedor do
 * `!me`/`!cf`.
 *
 * Se o nome não resolver (contato desconhecido), o campo fica **vazio** — melhor
 * o prompt dizer "seus pais adotivos" do que a Lizzy chamar a mãe dela de
 * "18408649269356".
 *
 * @param {object} p
 * @param {Array<{papel:string, lid:string, nome:string}>} [p.pais]
 * @returns {Promise<Array<{papel:string, lid:string, nome:string}>>}
 */
export async function resolverPaisAdotivos({ pais = [], nazu, metadata, from } = {}) {
  if (!Array.isArray(pais) || !pais.length) return [];
  const saida = [];
  for (const p of pais) {
    if (!p) continue;
    const papel = String(p.papel || 'responsavel').trim() || 'responsavel';
    // Se o nome ja' veio no config, respeita (o dono pode ter escrito).
    let nome = String(p.nome || '').trim();
    if (!nome && p.lid) {
      try {
        const resolvido = await resolverNomeContato(p.lid, { nazu, metadata, from });
        const texto = String(resolvido || '').trim();
        // O resolvedor CAI no numero/LID quando nao acha o contato — isso nao e'
        // nome. So' aceita o que parece nome de gente.
        const base = baseDe(p.lid);
        const pareceId = !texto || texto === base || /^\+?\d+$/.test(texto);
        if (!pareceId) nome = texto;
      } catch { /* segue sem o nome */ }
    }
    saida.push({ papel, lid: String(p.lid || '').trim(), nome });
  }
  return saida;
}

/**
 * As linhas de DADOS DO GRUPO (sem o título da seção).
 *
 * Separado porque os dois canais usam o mesmo conteúdo em formatos diferentes:
 * o chat tem o bloco completo; a call acrescenta só o essencial.
 *
 * @param {object} [g] `dadosDoGrupo.grupo`
 * @returns {string[]}
 */
export function linhasDoGrupo(g) {
  if (!g) return [];
  const linhas = [];
  if (limpo(g.nome)) linhas.push(`- Nome: ${g.nome}`);
  if (g.dono && (g.dono.nome || g.dono.numero)) {
    linhas.push(`- Dono do grupo: ${limpo(g.dono.nome) || g.dono.numero}`);
  }
  if (Array.isArray(g.admins) && g.admins.length) {
    const mostrados = g.admins.slice(0, 20);
    // O "resto" é o que NÃO coube — o total pode ser maior que os nomes
    // resolvidos (nem todo admin tem nome na agenda).
    const faltando = Math.max(Number(g.totalAdmins) || 0, g.admins.length) - mostrados.length;
    const resto = faltando > 0 ? ` (+${faltando})` : '';
    linhas.push(`- Admins (${g.totalAdmins}): ${mostrados.join(', ')}${resto}`);
  }
  // MODERADORES e ALPHAS: cargos do BOT (quem o dono promoveu), que nao
  // aparecem no metadata do WhatsApp.
  if (Array.isArray(g.moderadores) && g.moderadores.length) {
    linhas.push(`- Moderadores (${g.totalModeradores ?? g.moderadores.length}): ${g.moderadores.slice(0, 20).join(', ')}`);
  }
  if (Array.isArray(g.alphas) && g.alphas.length) {
    linhas.push(`- Alphas (${g.totalAlphas ?? g.alphas.length}): ${g.alphas.slice(0, 20).join(', ')}`);
  }
  if (g.criadoEm) linhas.push(`- Criado em: ${g.criadoEm}`);
  if (Number.isFinite(g.totalMembros)) linhas.push(`- Total de membros: ${g.totalMembros}`);
  if (limpo(g.foto)) linhas.push(`- Foto: ${g.foto}`);
  if (limpo(g.descricao)) {
    linhas.push(`- Descricao: ${String(g.descricao).replace(/\s+/g, ' ').trim().slice(0, 300)}`);
  }
  return linhas;
}

/**
 * Monta o bloco de CONTEXTO do CHAT: quem fala, quem é o dono, dados do grupo.
 *
 * Tudo opcional: campo sem dado simplesmente não aparece.
 *
 * @param {object} [ctx] `{ nomeDeQuemFalou, dadosDoGrupo }`
 * @returns {string} o bloco, ou '' quando não há nada a dizer
 */
export function montarContextoDaConversa(ctx = {}) {
  if (!ctx || typeof ctx !== 'object') return '';
  const { nomeDeQuemFalou, dadosDoGrupo = {}, paisAdotivos = [], quemFalouId } = ctx;
  const linhas = [];

  const dono = dadosDoGrupo?.donoDoBot;
  if (dono && (dono.nome || (dono.numeros && dono.numeros.length))) {
    linhas.push(`O DONO do bot e' ${limpo(dono.nome) || dono.numeros?.[0] || 'o dono'}.`);
  }

  const nome = limpo(nomeDeQuemFalou);
  if (nome) {
    linhas.push(`Quem esta' falando com voce agora e' ${nome}.`);
    // Reconhecer o dono é o que faz ela tratar diferente — foi o pedido.
    if (dono?.falanteEhDono) {
      linhas.push(`ATENCAO: ${nome} e' o DONO do bot — trate com respeito e deferencia.`);
    }
    // OS PAIS ADOTIVOS: casar quem fala com o LID/nome do config e dizer, sem
    // rodeios, que e' o PAI/MAE. Era o que faltava para ela reconhecer sozinha
    // ("ela nao reconhece os pais dela automaticamente").
    const pai = quemEhDosPais(quemFalouId, nome, paisAdotivos);
    if (pai) {
      const rotulo = pai.papel === 'mae' ? 'MAE' : pai.papel === 'pai' ? 'PAI' : String(pai.papel).toUpperCase();
      linhas.push(`>>> ${nome} e' a sua ${rotulo}. Voce O reconhece na hora e trata como familia, nao como qualquer pessoa.`);
      linhas.push('    Nada de flerte, provocacao nem papo +18 com ele(a): o seu jeito com os seus pais e de filha, carinhosa e respeitosa.');
    }
    linhas.push(`Chame essa pessoa pelo nome (${nome}) quando fizer sentido, sem exagerar.`);
  }

  const doGrupo = linhasDoGrupo(dadosDoGrupo?.grupo);
  if (doGrupo.length) {
    linhas.push('', 'DADOS DO GRUPO (use se precisar; nao fique listando):');
    linhas.push(...doGrupo);
  }

  return linhas.join('\n');
}

/**
 * Monta o bloco de DADOS DO GRUPO para a CALL.
 *
 * A voz lê tudo em voz alta, então o bloco é mais enxuto que o do chat: sem a
 * lista inteira de admins (que soaria como leitura de relatório), mas com o
 * que responde as perguntas naturais de uma call ("quem é o dono?", "quantos
 * somos?").
 *
 * @param {object} [dadosDoGrupo]
 * @returns {string} o bloco, ou '' quando não há nada
 */
export function montarBlocoDoGrupo(dadosDoGrupo = {}) {
  const g = dadosDoGrupo?.grupo;
  if (!g) return '';
  const linhas = [];
  if (limpo(g.nome)) linhas.push(`Voce esta no grupo "${g.nome}".`);
  if (g.dono && (g.dono.nome || g.dono.numero)) {
    linhas.push(`O dono do grupo e' ${limpo(g.dono.nome) || g.dono.numero}.`);
  }
  if (Number.isFinite(g.totalMembros)) linhas.push(`O grupo tem ${g.totalMembros} membro(s).`);
  if (Number.isFinite(g.totalAdmins)) linhas.push(`Sao ${g.totalAdmins} administrador(es).`);
  if (g.criadoEm) linhas.push(`O grupo foi criado em ${g.criadoEm}.`);
  if (Array.isArray(g.admins) && g.admins.length) {
    linhas.push(`Admins: ${g.admins.slice(0, 10).join(', ')}.`);
  }
  if (Array.isArray(g.moderadores) && g.moderadores.length) {
    linhas.push(`Moderadores: ${g.moderadores.slice(0, 10).join(', ')}.`);
  }
  if (Array.isArray(g.alphas) && g.alphas.length) {
    linhas.push(`Alphas: ${g.alphas.slice(0, 10).join(', ')}.`);
  }
  if (limpo(g.descricao)) {
    linhas.push(`A descricao do grupo e': ${String(g.descricao).replace(/\s+/g, ' ').trim().slice(0, 300)}.`);
  }
  return linhas.join(' ');
}
