# Formas de fazer uma mensagem chegar e ALGUNS usuários NÃO conseguirem decifrar

Pesquisa para o anti do bot (deteccao). Fontes: WhatsApp Encryption Overview
(white paper, jan/2023 e set/2023), "WhatsUpp with Sender Keys?" (eprint 2023/1385),
"Heise: Encrypted, but wrong" (grupos manipulaveis), KCL/EuroCrypt 2025 (sem
gestao criptografica de grupo), Trail of Bits (sender keys), whatsmeow/Baileys
issues, e o codigo do proprio fork (decode-wa-message.js / selection detection).

## O modelo (por que existe o problema)

Mensagem de grupo usa **Sender Key** (Signal): o remetente gera UMA chave e a
distribui a cada dispositivo do grupo por **sessao pareada (pairwise)**. Depois
manda UM ciphertext e o servidor faz fan-out. Quem **nao recebeu a chave** ve o
ciphertext, mas **nao decifra** -> "Waiting for this message" (ou a entrada some,
se `decrypt-fail="hide"`).

O WhatsApp **nao gerencia criptograficamente** quem recebe a chave (KCL/EuroCrypt
2025) — quem manda escolhe. Isso e o que permite (a) o comportamento legitimo de
rotacionar a chave quando alguem sai e (b) o **abuso**: rotacionar e distribuir
so a um subconjunto.

## Catalogo dos vetores

### 1. Rotacao de Sender Key com distribuicao a SUBCONJUNTO  (o principal)
O remetente gera uma chave NOVA, distribui so para alguns devices e marca o
`<enc>` com `decrypt-fail="hide"`. Os excluidos recebem a stanza mas nao decifram.
- Sinais no receive: `info.selectiveDistribution` (a fork marca quando `skmsg` +
  falha "no sender key" + `decrypt-fail="hide"`), **phash ausente**, **densidade
  baixa** (enderecados/dispositivos), **SKDM fresco** do mesmo autor.
- No bot: `INV-001/002/003/004/005`, `ghostDetection`, antifantasma.

### 2. Stanza de GRUPO com `enc` PAREADO (`msg`/`pkmsg`)  — o "raja"
Transporte: em vez de `skmsg` (Sender Key), a stanza de grupo carrega enc
pareado. E o transporte do **retry** e o usado para entregar a quem foi excluido.
- Sinal na fork: `info.groupEncInfo.pairwiseOnly` (enc SO msg/pkmsg, SEM skmsg,
  SEM count) e `info.pairwiseGroupPayload`.
- CUIDADO: **SKDM** (`senderKeyDistributionMessage`) tambem chega pareado e e
  NORMAL (Baileys gera ao criar grupo/device novo) -> nao pode contar como raja.
- No bot: `ehRajaTransporte` (antifantasma) e `TRANSPORTE` (testeanti).

### 3. Trigger do RETRY + mensagem forjada com o mesmo ID  (transcript consistency)
Fonte: heise / eprint (consistencia de transcricao). O atacante manda ao alvo uma
chave que ele NAO consegue usar -> toda mensagem normal gera erro e o alvo pede
retransmissao **pareada**. O atacante responde com uma mensagem FORJADA usando o
ID da mensagem real. O alvo ve a forjada; os outros descartam a "copia" (ja
tinham o ID) e nem checam. Resultado: **mesmo ID, conteudo diferente por
destinatario**.
- Dificil de detectar so pelo payload (exige comparar com o que os outros viram).

### 4. Chave/epoch que o alvo nao tem  (out-of-order / skipped keys)
O Signal guarda ate `N_max` chaves "puladas". Mandar sob um epoch/contador muito
a frente, ou pular demais, faz o alvo nao conseguir derivar a message key.
- Sinal: `retryCount`, IDs/epoch fora de ordem, stub CIPHERTEXT (`INV-010`).

### 5. ADD-ONS (reacao/EDICAO/enquete) em Community Announcement Groups
Fonte: white paper (set/2023) + whatsmeow (`DecryptReaction`,
`DecryptSecretEncryptedMessage`). Reacao e **edicao** sao "add-ons" cifrados
DUAS vezes:
1. chave derivada do **Message Secret** da mensagem-alvo
   (`HKDF(info = Target Message Id || sender Id || Add-on sender Id || tipo)`);
2. **Add-on Sender Key** (chave SEPARADA, distribuida via pairwise so aos admins).
- Se o alvo **nao decifrou a mensagem-alvo**, nao tem o Message Secret -> nao le
  o add-on (a edicao/reacao fica invisivel para ele).
- Admin deixa de resetar a Add-on Sender Key quando alguem sai (so a normal).
- No bot: `associatedChildMessage`, `editedMessage`, `reactionMessage`,
  `encReactionMessage`, `messageAssociation` (parcialmente em INV-013/INV-016).

### 6. STATUS (group status / status pessoal)
Status tambem usa Sender Key; a chave e resetada quando a privacidade muda (ex.:
tirar um viewer) -> o removido nao le. O `!statusgrupo`/`statusMentionMessage`
entram nessa familia. No bot: `!antistatus` + (o pairwise no status).

### 7. Manipulacao do CLIENTE/SERVIDOR (fora do cripto)
Fonte: KCL/EuroCrypt 2025, blog cryptographyengineering. Quem controla o servidor
(ou um device de membro) pode: adicionar gente ao grupo sem aviso eficaz, alterar
a lista de participantes, **omitir o alvo do fan-out** (nao chega nada) ou forjar
notificacoes. Nao e "chega e nao decifra" — e "nao chega" ou "chega outro".

### 8. Spoof de protocolMessage self-only (CVE-2026-48063)
Tipos que so podem vir do proprio device (`APP_STATE_SYNC_KEY_SHARE`,
`LID_MIGRATION_MAPPING_SYNC`, `HISTORY_SYNC_NOTIFICATION`,
`PEER_DATA_OPERATION_REQUEST_RESPONSE`). Spoof afeta app-state, nao decifragem
de mensagem — relacionado, mas outro eixo.

## O que o bot JA detecta

| Vetor | Detector |
|---|---|
| 1. Rotacao seletiva | `selectiveDistribution` (INV-001/002/005), `ghostDetection`, antifantasma |
| 2. Grupo com enc pareado | `groupEncInfo.pairwiseOnly` / `pairwiseGroupPayload` (antifantasma + `TRANSPORTE` no testeanti) |
| 4. Stub/nao decifrada | `INV-010`, stub CIPHERTEXT |
| 5. Wrappers/add-ons | `INV-013`, `resolveTypeChain`, `associatedChildMessage` |

## Lacunas (o que NAO esta coberto)

- **3. Trigger de retry + forja com mesmo ID** (transcript consistency) — precisa
  de correlacao entre o que o autor mandou e o que os outros viram; so o payload
  nao basta.
- **5. Add-on/edicao keyed por Message Secret** — nao checamos se o alvo tinha o
  Message Secret da mensagem-alvo; a edicao "invisivel" para um subconjunto.
- **6. Sender Key de STATUS** — o `!antistatus` pega status/canal e pairwise, mas
  nao o caso "status que so alguns veem" pela chave.
- **4. Contador/epoch muito a frente** — nao medimos o salto da cadeia.

## Regra de ouro da DETECCAO (sem falso positivo)

Nunca punir por UM sinal de transporte (retry benigno existe). Combinar:
`enc pareado` + `sem skmsg` + `sem count` + **nao ser SKDM** + rajada. Foi o que
tirou o "banindo geral".

## Fontes
- WhatsApp Encryption Overview (white paper, set/2023): sender keys, add-ons,
  Message Secret, key rotation.
- eprint 2023/1385 — "WhatsUpp with Sender Keys?" (analise formal do protocolo).
- heise.de — "Encrypted, but wrong: Group chats vulnerable to manipulated content"
  (consistencia de transcricao, trigger de retry).
- KCL / EuroCrypt 2025 (Albrecht, Dowling, Jones) — WhatsApp sem gestao
  criptografica de grupo.
- Trail of Bits — "Better Encrypted Group Chat" (sender keys vs MLS).
- whatsmeow (`BuildUnavailableMessageRequest`, `DecryptReaction`), Baileys issues
  (empty/waiting messages).
