/**
 * Boot mostra a biblioteca do WhatsApp REALMENTE instalada.
 *
 * O bot usa a fork `github:Souzzaaxzy/baileys` (publicada como
 * `@itsliaaa/baileys`). O header do boot precisa anunciar essa fork — a versão
 * que está instalada — e não uma string fixa que envelhece (foi assim que
 * apareceu uma biblioteca antiga que não era mais a usada).
 *
 * O teste roda a função REAL contra arquivos montados em pasta temporária:
 * confirma o que ela lê e que ela sobrevive a metadados ausentes/corrompidos.
 *
 * Uso: node tests/baileys-boot-info.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { getWhatsAppLibrary, getMediaEngine } from '../dados/src/utils/baileysInfo.js';

let ok = 0, fail = 0;
const erros = [];
function check(cond, msg) {
  if (cond) { ok += 1; console.log(`✅ ${msg}`); }
  else { fail += 1; erros.push(msg); console.log(`❌ ${msg}`); }
}

const PKG_DIR = 'node_modules/@itsliaaa/baileys';

/** Monta uma árvore fake com o pacote e o lock do node_modules. */
function montar({ pkg, resolved } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-baileys-'));
  fs.mkdirSync(path.join(root, PKG_DIR), { recursive: true });
  if (pkg !== null) {
    fs.writeFileSync(path.join(root, PKG_DIR, 'package.json'), typeof pkg === 'string' ? pkg : JSON.stringify(pkg ?? {}));
  }
  if (resolved !== null) {
    fs.writeFileSync(
      path.join(root, 'node_modules', '.package-lock.json'),
      JSON.stringify({ packages: { [PKG_DIR]: resolved ? { version: pkg?.version, resolved } : {} } })
    );
  }
  return root;
}

console.log('\n── 1. lê a fork instalada (nome, versão, repo e commit) ──');
{
  const root = montar({
    pkg: { name: '@souzzaaxzy/baileys', version: '0.3.18-final' },
    resolved: 'git+ssh://git@github.com/Souzzaaxzy/baileys.git#d3692c7ec2fa4a1fd28fdbc0cee0525b488476da',
  });
  const info = getWhatsAppLibrary(root);

  check(info.name === '@souzzaaxzy/baileys', 'nome do pacote da fork');
  check(info.version === '0.3.18-final', 'versão do pacote');
  check(info.repo === 'Souzzaaxzy/baileys', 'owner/repo extraído da URL git');
  check(info.commit === 'd3692c7ec2fa4a1fd28fdbc0cee0525b488476da', 'commit COMPLETO (não o curto, que gera falso drift)');
  check(info.commitCurto === 'd3692c7', 'commit curto para exibição');
  check(info.label.includes('@souzzaaxzy/baileys'), 'label traz o nome');
  check(info.label.includes('0.3.18-final'), 'label traz a versão');
  check(info.label.includes('Souzzaaxzy/baileys@d3692c7'), 'label traz repo e commit — é o que identifica a fork');
  check(!/WhiskeySockets|adiwajshing/i.test(info.label), 'NÃO anuncia a biblioteca antiga');
}

console.log('\n── 2. o commit instalado é o que manda (trocar o lock muda o label) ──');
{
  const antigo = montar({
    pkg: { name: '@souzzaaxzy/baileys', version: '0.3.18-final' },
    resolved: 'git+ssh://git@github.com/Souzzaaxzy/baileys.git#aee4b2451ef1e2394085e890b00d82c6df372209',
  });
  const novo = montar({
    pkg: { name: '@souzzaaxzy/baileys', version: '0.3.18-final' },
    resolved: 'git+ssh://git@github.com/Souzzaaxzy/baileys.git#d3692c7ec2fa4a1fd28fdbc0cee0525b488476da',
  });
  const a = getWhatsAppLibrary(antigo);
  const n = getWhatsAppLibrary(novo);

  check(a.commitCurto !== n.commitCurto, 'commits diferentes produzem labels diferentes');
  check(n.commitCurto === 'd3692c7', 'o label segue o commit realmente instalado (sem string fixa)');
}

console.log('\n── 3. a MESMA versão em commits diferentes não confunde ──');
{
  // A fork mantém `0.3.18-final` entre commits: só o commit distingue.
  const r1 = montar({ pkg: { name: '@souzzaaxzy/baileys', version: '0.3.18-final' }, resolved: 'git+ssh://git@github.com/Souzzaaxzy/baileys.git#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  const r2 = montar({ pkg: { name: '@souzzaaxzy/baileys', version: '0.3.18-final' }, resolved: 'git+ssh://git@github.com/Souzzaaxzy/baileys.git#bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
  const i1 = getWhatsAppLibrary(r1);
  const i2 = getWhatsAppLibrary(r2);

  check(i1.version === i2.version, 'as duas têm a mesma versão (0.3.18-final)');
  check(i1.commitCurto === 'aaaaaaa' && i2.commitCurto === 'bbbbbbb', 'o commit é o que diferencia');
}

console.log('\n── 4. nunca lança e nunca deixa buraco no boot ──');
{
  const semPacote = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-baileys-vazio-'));
  const i1 = getWhatsAppLibrary(semPacote);
  check(typeof i1.label === 'string' && i1.label.length > 0, 'sem node_modules ainda devolve um label');
  check(!/undefined|null|NaN/.test(i1.label), 'label sem undefined/null/NaN');

  const pkgCorrompido = montar({ pkg: '{isso nao e json', resolved: 'git+ssh://git@github.com/x/y.git#abc' });
  const i2 = getWhatsAppLibrary(pkgCorrompido);
  check(typeof i2.label === 'string' && i2.label.length > 0, 'package.json corrompido → label válido');
  check(!/undefined|null|NaN/.test(i2.label), 'sem undefined/null/NaN no label');

  const semLock = montar({ pkg: { name: '@souzzaaxzy/baileys', version: '0.3.18-final' }, resolved: null });
  const i3 = getWhatsAppLibrary(semLock);
  check(i3.name === '@souzzaaxzy/baileys' && i3.version === '0.3.18-final', 'sem lock ainda mostra nome e versão');
  check(i3.commit === null && i3.commitCurto === null, 'sem lock, commit é null (não inventa)');
  check(!/undefined|null|NaN/.test(i3.label), 'label sem undefined/null/NaN sem lock');

  const pkgSemCampos = montar({ pkg: {}, resolved: 'git+ssh://git@github.com/Souzzaaxzy/baileys.git#d3692c7' });
  const i4 = getWhatsAppLibrary(pkgSemCampos);
  check(i4.name === '@itsliaaa/baileys', 'sem nome no pacote, usa o nome da dependência');
  check(i4.version === 'desconhecida', 'sem versão, marca desconhecida');
}

console.log('\n── 5. o header do boot realmente usa a função ──');
{
  const startSrc = fs.readFileSync(new URL('../dados/src/.scripts/start.js', import.meta.url), 'utf8');
  check(startSrc.includes('baileysInfo.js'), 'start.js importa o helper de identificação');
  check(startSrc.includes('getWhatsAppLibrary'), 'start.js chama getWhatsAppLibrary()');
  check(/Baileys:\s*\$\{waLib/.test(startSrc), 'start.js exibe o label no header');
  check(!/Baileys:\s*(WhiskeySockets|adiwajshing|@whiskeysockets)/.test(startSrc), 'start.js NÃO tem biblioteca antiga fixa');
}

console.log('\n── 6. o MOTOR DE MÍDIA da call também aparece no boot ──');
{
  // A mesma armadilha da fork do Baileys vale para o `@zapo-js/voip`: a versão
  // (1.4.0) NÃO muda entre commits, então uma correção pode estar no lockfile e
  // não estar rodando — o bot sobe normal e o comportamento novo não acontece.
  // O commit no boot é o que separa "o fix não foi instalado" de "o fix não funciona".
  const info = getMediaEngine();
  check(typeof info?.label === 'string' && info.label.length > 0, 'getMediaEngine devolve um label');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-midia-'));
  const dir = path.join(root, 'node_modules/@zapo-js/voip');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@zapo-js/voip', version: '1.4.0' }));
  fs.writeFileSync(
    path.join(root, 'node_modules', '.package-lock.json'),
    JSON.stringify({
      packages: {
        'node_modules/@zapo-js/voip': {
          version: '1.4.0',
          resolved: 'git+ssh://git@github.com/Souzzaaxzy/zapo.git#dd47c9085b0732a0b73504059f30ef98b4c38ff3',
        },
      },
    })
  );
  const lido = getMediaEngine(root);
  check(lido.name === '@zapo-js/voip', 'lê o nome do pacote do motor');
  check(lido.version === '1.4.0', 'lê a versão');
  check(lido.commitCurto === 'dd47c90', 'lê o commit CURTO para o header');
  check(lido.commit === 'dd47c9085b0732a0b73504059f30ef98b4c38ff3', 'guarda o commit completo');
  check(lido.repo === 'Souzzaaxzy/zapo', 'identifica o repositório da fork');
  check(lido.label.includes('Souzzaaxzy/zapo@dd47c90'), 'o label traz repo e commit');

  // Commits diferentes => labels diferentes (é o que denuncia o pacote velho).
  const outro = getMediaEngine(
    (() => {
      const r2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-midia2-'));
      const d2 = path.join(r2, 'node_modules/@zapo-js/voip');
      fs.mkdirSync(d2, { recursive: true });
      fs.writeFileSync(path.join(d2, 'package.json'), JSON.stringify({ name: '@zapo-js/voip', version: '1.4.0' }));
      fs.writeFileSync(
        path.join(r2, 'node_modules', '.package-lock.json'),
        JSON.stringify({
          packages: {
            'node_modules/@zapo-js/voip': {
              version: '1.4.0',
              resolved: 'git+ssh://git@github.com/Souzzaaxzy/zapo.git#2ee77754959b2e9798c8ce8a9521bc6a621868c4',
            },
          },
        })
      );
      return r2;
    })()
  );
  check(outro.label !== lido.label, 'mesma versão em commits diferentes => labels DIFERENTES');
  check(outro.label.includes('2ee7775'), 'o label do pacote antigo mostra o commit antigo');

  // Degradação: sem pacote, ainda devolve um label válido (nunca undefined).
  const vazio = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-midia3-'));
  const sem = getMediaEngine(vazio);
  check(typeof sem.label === 'string' && sem.label.length > 0, 'sem pacote, devolve label válido');
  check(sem.commit === null, 'sem pacote, commit é null (não undefined)');

  const startSrc = fs.readFileSync(new URL('../dados/src/.scripts/start.js', import.meta.url), 'utf8');
  check(startSrc.includes('midiaLib = getMediaEngine()'), 'start.js CHAMA getMediaEngine()');
  check(/Mídia da call:\s*\$\{midiaLib/.test(startSrc), 'start.js exibe o commit do motor no header');
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
if (fail) {
  console.log('\nFALHAS:');
  for (const e of erros) console.log(`- ${e}`);
  process.exit(1);
}
console.log('✅ boot mostra a biblioteca instalada');
process.exit(0);
