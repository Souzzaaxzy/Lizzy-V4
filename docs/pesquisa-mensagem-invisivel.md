# Mensagem "invisível" no WhatsApp — mapa de técnicas (pesquisa global, set/2026)

Pesquisa pedida pelo dono: **quais outras formas existem** de fazer a "mensagem
invisível", além da que o bot já usa.

> Escopo: este documento é **levantamento técnico**. Nada aqui foi ligado ao bot
> nem executado — é material de leitura para decidir o que vale testar.

---

## O que o bot já usa (baseline)

`!rajar` monta um **envelope de pagamento** e entrega por **rotação de Sender
Key** (só membros comuns decifram). São **dois** mecanismos empilhados:

| camada | o que faz | onde |
|---|---|---|
| **Conteúdo** | `sendPaymentMessage` com `noteMessage` de texto invisível (`.` + zero-width) e **sem** `requestMessageKey`/`amount` — o cliente não tem card para desenhar | `buildRajaContent` |
| **Transporte** | `relayMessage` com `recipientMode: 'members-only'` — admins não recebem a Sender Key | fork, commit `3b41788` |

E existe ainda o `requestPaymentMessage` com `amount1000: "0"` (a variante que o
`!raja`/`!divulgar` montam e que o analisador `INV-007`/`INV-023` detecta).

**O ponto comum**: a invisibilidade **não é uma flag**. É um **proto malformado
para renderizar** — o cliente recebe a mensagem, não tem o que desenhar, e o
resultado é uma linha em branco (ou nada).

---

## Técnicas encontradas

### 1. Envelope de pagamento (o que já temos)

| variante | como fica invisível | estado |
|---|---|---|
| `requestPaymentMessage` + `amount1000: "0"` + `amount.value: "0"` | card de pagamento sem valor — nada a desenhar | **em uso** (`!raja`, `!divulgar`) |
| `sendPaymentMessage` sem `requestMessageKey` e sem `amount`, nota invisível | envelope de pagamento vazio | **em uso** (`!rajar`) |
| `requestPaymentMessage` com `noteMessage.extendedTextMessage.viewOnce: true` | a nota vira "ver uma vez" dentro do card | visto em `paycrash` (bugbot) |
| `paymentInviteMessage` / `declinePaymentRequestMessage` / `cancelPaymentRequestMessage` | tipos de pagamento **sem valor** por definição | **não testado** |

Referências: `L1ghtzin/chainy`, `bakizinho/Kyara-High-Tech`.

### 2. Mensagem só de caracteres invisíveis (a mais simples)

Não é proto especial: é **texto normal** com caractere que o filtro do WhatsApp
aceita mas não desenha. É o "blank message" popular.

| caractere | code point | observação |
|---|---|---|
| Hangul Filler | `U+3164` | **melhor taxa** cross-platform (iOS/Android/Web) |
| Braille Pattern Blank | `U+2800` | bom em Android antigo; às vezes vira pontinho |
| Zero Width Space | `U+200B` | iOS autocorrect costuma remover; usar x10 |
| Ideographic Space | `U+3000` | fallback raro |
| Left-to-Right Mark | `U+200E` | funciona no Web |
| par `U+200E`+`U+200F` | — | builds antigos |

**Limite honesto**: gera uma **bolha vazia visível** — não é "invisível", é
"branca". Diferente do raja, que não desenha card.

### 3. Reação vazia / reação na própria mensagem

Fonte: paper acadêmico **"Careless Whisper: Exploiting Silent Delivery Receipts
to Monitor Users on Mobile Instant Messengers"** (arXiv `2411.11194`).

- **remover uma reação** (mandar `reactionMessage` com texto vazio) é
  **totalmente invisível** para o destinatário;
- **reagir à própria mensagem** não notifica ninguém, mas **gera delivery
  receipt**;
- reação a mensagem **inexistente** também gera receipt (não valida alvo).

**Por que interessa**: é invisibilidade **de verdade** (não uma bolha branca) e
não depende de proto malformado. **Não testado** no nosso contexto.

### 4. Status direcionado (`status@broadcast` + `statusJidList`)

O tipo mais comum nos "bugbots". A mensagem vai para `status@broadcast`, mas o
`statusJidList` restringe **quem** recebe — na prática vira um "PV invisível"
dentro do chat, sem bolha no grupo.

```js
await sock.relayMessage('status@broadcast', msg.message, {
  messageId: msg.key.id,
  statusJidList: [target],
  additionalNodes: [{ tag: 'meta', attrs: {}, content: [
    { tag: 'mentioned_users', attrs: {}, content: [
      { tag: 'to', attrs: { jid: target }, content: undefined }]}]}]
})
```

Variantes vistas: conteúdo `viewOnceMessage` + `locationMessage` com nome/endereço
de 15k-60k repetições (`IosInvisible`), `stickerMessage` (`StickerInvisible`),
`interactiveResponseMessage` + `nativeFlowResponseMessage` com `paramsJson` de
~1 MB (`InvisibleHard`).

Referências: `SABIR7718/XeonTGbot`, `CrazyPrince12/BugSite`,
`Alexander12Po/SOSI-CODEX_PRO`, `Dafispdi/Portifolio`.

### 5. `statusMentionMessage` / `groupStatusMentionMessage`

Encapsula um `protocolMessage` com `type: 25` apontando para a mensagem de
status, mais `meta.is_status_mention`. É o que faz a "menção de status" — chega
como **aviso**, não como mensagem normal.

```js
await sock.relayMessage(jid, {
  statusMentionMessage: {
    message: { protocolMessage: { key: msg.key, type: 25, ... } }
  }
})
```

Referência: `Alexander12Po/SOSI-CODEX_PRO` (`InvisibleHard.js`).

### 6. `groupStatusMessageV2` dentro do grupo

O status nativo do grupo (`!statusgrupo` já usa isso no nosso bot). Envolver
conteúdo arbitrário em `groupStatusMessageV2` faz ele aparecer na faixa de status
do grupo — **não** como mensagem no chat.

```js
await sock.relayMessage(target, { groupStatusMessageV2: { message: msg.message } }, { messageId: msg.key.id })
```

Referência: `hsh34811-hash/Raven-Crash-Bot-WS`.

### 7. `ephemeralMessage` + `interactiveMessage` com título/botão "vazios"

Envelope de mensagem temporária com `interactiveMessage` cujo `header.title` e
`body.text` são `\u0000` + milhares de repetições — o cliente tenta desenhar o
card interativo e não consegue.

Referência: `det-core/NULL` (`MarkDelayHardInvis`).

### 8. `protocolMessage` com type não-renderizável

Enviar `protocolMessage` de tipos internos (`EPHEMERAL_SETTING`, `type: 25`,
edição/revogação) — são mensagens de **controle**, o cliente não desenha bolha.
**Não confirmado** que cheguem a outros dispositivos via `relayMessage` — é o
mesmo tipo de dúvida que tivemos com `MarkAsVerifiedAction` (inbound-only).

### 9. `keepInChatMessage` / `pinInChatMessage` / `pollUpdateMessage`

Add-ons de mensagem. No `messages-send` da fork, `pinInChatMessage` /
`keepInChatMessage` / `reactionMessage` / `editedMessage` ganham
`decrypt-fail="hide"` — o cliente **esconde a entrada** quando não decifra.
Combinado com conteúdo vazio, é uma via de invisibilidade **já suportada pela
nossa fork**. **Não testado** como mensagem isolada.

### 10. Texto com sobrecarga (o "força o cliente a desistir")

Milhares de `mentionedJid` aleatórios (`Array.from({length: 40000})`), nomes de
60k caracteres, `fileLength: "9999999999999"`. Não é "invisível" por design —
é **invisível porque o cliente não consegue renderizar** (e muitas vezes trava).
É o que a maioria dos "bugbots" chama de "invisible"/"delay invisible".

**Isto é o oposto do que queremos**: o objetivo desses scripts é **derrubar** o
cliente, não mandar uma mensagem limpa.

---

## Resultado MEDIDO (offline, sem enviar nada)

Rodei um probe local: montei cada tecnica com a fork instalada, medi o tamanho no
proto (`proto.Message.encode`) e passei pelo **proprio analisador do bot**
(`analyzeInvisibleMessage`). Nada foi enviado.

> Detalhe da API: `analyzeInvisibleMessage` precisa de **`content` explicito**
> (`{ ...info, content: info.message }`). Sem isso ele le `content` vazio e
> classifica tudo como NORMAL — foi o primeiro resultado (errado) que o probe deu.

| # | tecnica | bytes no proto | classificacao do bot | indice |
|---|---|---|---|---|
| 1 | reaction vazia | 76 | NORMAL | 0 |
| 2 | `paymentInviteServiceType: 3` | 49 | NORMAL | 0 |
| 3 | texto `U+3164` | 44 | NORMAL | 0 |
| 4 | keepInChat | 83 | NORMAL | 0 |
| 5 | **raja atual** (`sendPaymentMessage`) | 23 | **FORTEMENTE_COMPATIVEL** | 40 |
| 6 | `declinePaymentRequestMessage` | 35 | NORMAL | 0 |
| 7 | `cancelPaymentRequestMessage` | 35 | NORMAL | 0 |
| 8 | `protocolMessage` type 25 | 4 | NORMAL | INV-016 (informativo) |
| 9 | `placeholderMessage` | 3 | NORMAL | 0 |
| 10 | `requestPaymentMessage` amount 0 | 29 | **FORTEMENTE_COMPATIVEL** | 90 |

### O que isso diz

1. **Todas as 10 sao PRODUZIVEIS** pela fork — inclusive as que nao tem ramo
   proprio no send (`declinePaymentRequest`, `cancelPaymentRequest`,
   `protocolMessage`, `placeholderMessage`): basta
   `generateWAMessageFromContent`, que passa o proto direto.
2. **O bot ja pega as duas variantes de pagamento** (5 e 10). O resto passa
   limpo — sao invisiveis **e** indetectaveis hoje.
3. **`INV-016`** (mensagem de sistema/protocolo) e **informativo** (peso 0), entao
   o `protocolMessage` nao pontua.
4. Os tamanhos sao **minusculos** (3 a 83 bytes) comparados ao travazap
   (~2,9 MB). Ou seja: as tecnicas limpas sao baratas; a que "trava" e que e
   gigante — e e a unica que hoje nao e pega por tamanho.

### Proximo passo (nao executado)

Sao 8 tecnicas sem deteccao e sem validacao em aparelho real. Testar em grupo
exige sessao pareada — o que da para fazer **offline** ja foi feito: elas montam,
o proto fica correto e o bot nao as classifica.

## ACHADO para o `!rajar2` — texto em campo OCULTO

Testei 8 variantes do envelope de pagamento (mantendo o mecanismo que funciona)
e 8 posicoes de texto em campos inesperados. **Nenhuma variante de pagamento
escapa** da deteccao atual — mas **duas posicoes de texto sim**.

### A ideia

O raja atual poe o texto na **nota** do card. Se o texto for para um campo que o
cliente **nao desenha** (e que o detector tambem nao olha), ele fica invisivel
**em dois sentidos**: nao aparece na tela **e** nao e detectado.

### Resultado medido (nada enviado)

| posicao do texto | tipo | bytes | texto viaja? | deteccao |
|---|---|---|---|---|
| nota (baseline raja) | `sendPaymentMessage` | 36 | sim | SUSPEITA (INV-008, INV-022) |
| `background.mimetype` | `sendPaymentMessage` | 62 | sim | SUSPEITA (INV-022) |
| `background.id` | `sendPaymentMessage` | 57 | sim | SUSPEITA (INV-022) |
| `transactionData` | `sendPaymentMessage` | 29 | sim | SUSPEITA (INV-022) |
| `currencyCodeIso4217` | `requestPaymentMessage` | 45 | sim | ATIPICA (INV-019) |
| `requestPayment.requestFrom` | `requestPaymentMessage` | 50 | sim | ATIPICA (INV-019) |
| **`paymentInviteMessage.referralId`** | `paymentInviteMessage` | 34 | **sim** | **NORMAL** |
| **`declinePaymentRequestMessage.key.id`** | `declinePaymentRequestMessage` | 36 | **sim** | **NORMAL** |

### As duas candidatas limpas

```
A) paymentInviteMessage: { serviceType: 3 (UPI), expiryTimestamp: 0, referralId: <texto> }
B) declinePaymentRequestMessage: { key: { id: <texto>, remoteJid: '', fromMe: false } }
```

Ambas: **montam**, o **texto sobrevive ao encode/decode** (provado por
round-trip real do proto) e a deteccao e **NORMAL** (indice 0).

### Por que isso e uma forma NOVA

- o raja usa `sendPaymentMessage` / `requestPaymentMessage` — **ja detectados**;
- a candidata A usa **`paymentInviteMessage`**, que **nao tem `amount`** (nao ha
  valor a zerar) — o detector atual procura por pagamento **com valor**, entao
  ela nao entra em nenhum caminho;
- a candidata B usa **`declinePaymentRequestMessage`**, que so tem `key` — o
  texto vai no `id` da chave, um campo que o detector nunca le como conteudo;
- nenhuma das duas tem `noteMessage`, entao os indicadores de nota
  (`INV-008`, `INV-020`, `INV-023`) nao disparam.

### LIMITE HONESTO (importante)

O que esta **provado**: o proto monta, o texto viaja e o detector nao classifica.
O que **NAO esta provado**: que a mensagem **nao aparece** no aparelho.

Pelo mecanismo (card sem valor / tipo sem conteudo renderizavel), a expectativa
e que **nao desenhe** — mas isso **so se confirma num grupo real**, e nao ha
sessao pareada aqui. Antes de virar comando, precisa do teste no aparelho.

### Se for implementar

O `!rajar2` deve reaproveitar a estrutura do `!rajar` (mesmo gate de dono, mesma
entrega por **rotacao de Sender Key** para membros comuns) e trocar **apenas** o
`buildRajaContent` pela candidata escolhida. A decisao de qual das duas vai
depender do que o teste no aparelho mostrar.

## Comparativo (o que serve para o `!rajar`)

| técnica | invisível de verdade? | precisa de fork? | risco de travar cliente | validado aqui? |
|---|---|---|---|---|
| Envelope de pagamento (**atual**) | sim (não desenha) | não | baixo | **sim** |
| Caractere invisível | não (bolha branca) | não | nenhum | não |
| Reação vazia | **sim** | não | nenhum | **não** |
| Status direcionado | sim (não vai ao grupo) | não | **alto** | não |
| `statusMentionMessage` | chega como aviso | não | médio | não |
| `groupStatusMessageV2` | vai à faixa de status | não | baixo | parcial (`!statusgrupo`) |
| `interactiveMessage` vazio | sim | não | **alto** | não |
| Add-on (`keepInChat` etc.) | provável | não | baixo | não |

---

## Onde NÃO existe resposta (para não repetir a busca)

- **Não há receita pública** do "raja invisível" com esse nome — o que existe
  são bugbots com nomes próprios (`IosInvisible`, `InvisibleHard`,
  `MarkDelayHardInvis`, `bulldozer`, `killui`), cada um com uma variação.
- **Nenhum fork da Baileys implementa "modo invisível"** — os forks mexem em
  pagamento com valor **legítimo**.
- **Não existe flag/opção** que ligue invisibilidade. É sempre **proto
  malformado** ou **conteúdo não-renderizável**.
- O paper do arXiv é a **única fonte acadêmica** encontrada sobre mensagem
  silenciosa em mensageiros (e é sobre *delivery receipts*, não sobre o raja).

---

## Fontes

| fonte | o que deu |
|---|---|
| `L1ghtzin/chainy` | `dpay.js` + `antiPayment.js` (par pagamento) |
| `bakizinho/Kyara-High-Tech` | `apagar.js` + `antiPayment.js` (detecção/revogação) |
| `kingranzz/nexbug`, `det-core/NULL` | coleções de bugbots (`IosInvisible`, `MarkDelayHardInvis`, `killui`) |
| `SABIR7718/XeonTGbot`, `CrazyPrince12/BugSite` | `IosInvisible` (status direcionado) |
| `Alexander12Po/SOSI-CODEX_PRO` | `InvisibleHard.js` (status + `statusMentionMessage`) |
| `Dafispdi/Portifolio` | `StickerInvisible.js` |
| `hsh34811-hash/Raven-Crash-Bot-WS` | `groupStatusMessageV2` |
| arXiv `2411.11194` | "Careless Whisper" — reação vazia / receipt silencioso |
| `WhiskeySockets/Baileys#2357` | `baileys-antiban` (variações de mensagem p/ anti-spam) |
| unicode-explorer / invisible-characters | tabela de caracteres invisíveis |
