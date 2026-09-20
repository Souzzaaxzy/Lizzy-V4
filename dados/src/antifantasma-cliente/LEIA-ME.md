# AntiFantasma — integração

Você recebeu **um único arquivo**: `antifantasma.js`. Coloque-o na mesma pasta
do seu `Index.js` (ex.: `src/`).

O funcionamento real roda no servidor — este arquivo é só o adaptador.

## 1. Configure no topo do arquivo

Abra `antifantasma.js` e ajuste:

```js
const API_URL = 'https://SEU-SERVIDOR/api/antifantasma/exec';
const KEY = 'SUA-KEY-AQUI';
```

Em produção use **HTTPS**.

## 2. Importe no Index.js

```js
const antiFantasma = require('./antifantasma');
```

> Se o seu `package.json` tiver `"type": "module"`, renomeie o arquivo para
> `antifantasma.cjs` e use `await import('./antifantasma.cjs')`. Nada mais muda.

## 3. Crie as cases que você quiser

Os nomes são **escolha sua** — o plugin não impõe nenhum:

```js
case 'afon':
  antiFantasma.ativar();
  await reply('🟢 AntiFantasma ativado.');
  break;

case 'afoff':
  antiFantasma.desativar();
  await reply('🔴 AntiFantasma desativado.');
  break;

case 'afstatus':
  await reply(antiFantasma.estaAtivo() ? '🟢 Ligado' : '🔴 Desligado');
  break;
```

## 4. Passe cada mensagem do grupo para o AntiFantasma avaliar

Onde você já processa mensagens de grupo, chame `executar`:

```js
await antiFantasma.executar({
  sock,                 // o socket do seu bot
  grupo: from,          // JID do grupo
  autor: sender,        // quem enviou a mensagem
  reply,                // função de resposta do seu bot
  contexto: {           // o que você observou na mensagem
    isGroup: true,
    botIsAdmin: true,
    sender: sender,
    // sinais que a sua bot já tenha (o servidor decide o que fazer com eles):
    selectiveDistribution: Boolean(msg.selectiveDistribution),
    undecryptableGroupMessage: !msg.message,
    zeroValuePayment: false,
    fromMe: Boolean(msg.key?.fromMe),
  },
});
```

Regras importantes:

- **Desativado não chama a API** — se `estaAtivo()` for `false`, `executar`
  retorna imediatamente e nada sai da sua bot.
- Você **não precisa saber** quais sinais caracterizam ataque: mande o contexto
  que tiver e a decisão vem do servidor.
- O `sock` precisa ter `groupSettingUpdate` e `groupParticipantsUpdate` (padrão
  no Baileys).

## Respostas possíveis

| Situação | O que aparece |
|---|---|
| API fora do ar | ⚠️ Serviço AntiFantasma indisponível. |
| KEY inválida/revogada | ❌ KEY do AntiFantasma inválida ou revogada. |
| Erro interno | ❌ Não foi possível processar o AntiFantasma. |
| Tudo certo | A ação é executada e o grupo recebe o aviso |

## O que este arquivo NÃO tem

O algoritmo, as regras e os critérios de detecção ficam no servidor. Este
arquivo só envia o contexto e executa a ação autorizada.