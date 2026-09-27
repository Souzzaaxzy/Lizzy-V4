import fs from 'node:fs';
import path from 'node:path';
import { DATABASE_DIR } from './paths.js';

export function isContactPayload(message) {
  const seen = new Set();
  for (let depth = 0; depth < 32 && message && typeof message === 'object'; depth++) {
    if (seen.has(message)) return false;
    seen.add(message);
    if (Object.hasOwn(message, 'contactMessage') || Object.hasOwn(message, 'contactsArrayMessage')) return true;
    let next;
    for (const wrapper of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'deviceSentMessage', 'botForwardedMessage']) {
      if (message[wrapper]?.message) { next = message[wrapper].message; break; }
    }
    message = next;
  }
  return false;
}

export function createAntiCtt({filePath = process.env.ANTICTT_FILE || path.join(DATABASE_DIR, 'antictt.json'), now = Date.now, log = console.warn} = {}) {
  let settings;
  const messages = new Map(), removals = new Map();
  function load() {
    if (settings) return settings;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Arquivo antictt.json inválido');
      settings = data;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      settings = {};
    }
    return settings;
  }
  function isEnabled(group) { return load()[group] === true; }
  function setEnabled(group, value) {
    if (!/^\d+(-\d+)?@g\.us$/.test(group)) throw new Error('Grupo inválido');
    const updated = {...load()};
    if (value) updated[group] = true; else delete updated[group];
    fs.mkdirSync(path.dirname(filePath), {recursive:true});
    const temp = filePath + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(updated, null, 2), {mode:0o600});
    fs.renameSync(temp, filePath);
    settings = updated;
    return !!value;
  }
  function claim(map, key, ttl) {
    const time = now();
    if ((map.get(key) || 0) > time) return false;
    if (map.size >= 5000) map.delete(map.keys().next().value);
    map.set(key, time + ttl); return true;
  }
  function warn(action, error) {
    // Nunca imprime o payload/vCard nem cita a mensagem bloqueada.
    log('[ANTICTT]', action, String(error?.code || error?.status || 'falha'));
  }
  async function enforce({sock, info, group, sender, isGroup, isBotAdmin, protectedSender}) {
    if (!isGroup || info?.key?.fromMe || protectedSender || !isEnabled(group) || !isContactPayload(info?.message)) return {handled:false};
    const key = info.key;
    const participant = key?.participant || sender;
    if (key?.remoteJid !== group || !key?.id || !/^[0-9]+(?::[0-9]+)?@(lid|s\.whatsapp\.net)$/.test(participant || '')) return {handled:true, invalidKey:true};
    if (!isBotAdmin) {
      if (claim(messages, 'no-admin:'+group, 60000)) warn('Bot sem permissão de administrador');
      return {handled:true, noAdmin:true};
    }
    if (!claim(messages, group+':'+key.id, 60000)) return {handled:true, duplicate:true};
    const banKey = group+':'+participant;
    const work = [Promise.resolve().then(() => sock.sendMessage(group, {delete:{...key, remoteJid:group, fromMe:false, participant}}))
      .then(() => ({operation:'delete', ok:true}), e => {warn('Falha ao apagar', e);return {operation:'delete', ok:false};})];
    if (claim(removals, banKey, 30000)) {
      work.push(Promise.resolve().then(() => sock.groupParticipantsUpdate(group, [participant], 'remove')).then(result => {
        // Baileys pode resolver a Promise com erro individual em status.
        if (!Array.isArray(result) || !result.some(r => String(r?.status) === '200')) throw new Error('Remoção não confirmada');
        return {operation:'remove', ok:true};
      }).catch(e => {removals.delete(banKey);warn('Falha ao remover', e);return {operation:'remove', ok:false};}));
    }
    return {handled:true, results:await Promise.all(work)};
  }
  return {isEnabled, setEnabled, enforce};
}

export const antiCtt = createAntiCtt();
