# Investigação: autorização de operações de grupo no WhatsApp/Baileys
## (escalada vertical de privilégios — promote/demote)

> Escopo: pesquisa **aberta na internet** (sem `poc-cliente`, que não estava
> disponível). Não implementa exploits. Não altera Baileys nem o bot.
> Classificação honesta dos achados (seção 11 do pedido).

---

## 1. Resumo executivo

A operação **promote/demote** de participante de grupo no WhatsApp Web é uma
stanza `<iq type="set" xmlns="w:g2">` enviada ao grupo, contendo um nó
`<promote>`/`<demote>` com `<participant jid="…">`. **O cliente só DECLARA a
ação; a autorização é do servidor.** Quem não é admin recebe erro por
participante na resposta. Não há verificação de cargo no cliente — e isso é
**correto por design** (o servidor é a fonte de verdade).

**Não encontrei evidência pública de escalada vertical** (conta comum promovendo
a si mesma) em grupo do WhatsApp. O que **existe** e está documentado é outra
classe: **manipulação de conteúdo exibido** (consistência de transcrição /
spoofing), demonstrada no **Black Hat 2019**.

- **CONFIRMADO (design):** a autorização de cargo é server-side.
- **DESCARTADO (por ora):** "cliente sem checagem ⇒ vuln" — o cliente não é o
  ponto de decisão.
- **NÃO CONFIRMADO:** escalada vertical real; não há PoC público.

---

## 2. Origem e integridade do material

- **poc-cliente:** NÃO localizado (ambiente nem internet). Buscas: `find /` (só
  um arquivo de sistema `opencl-pocl`) e GitHub API (`"poc-cliente"` = 78 repos
  homônimos de outros assuntos; `"poc-cliente baileys"` = 0).
- **Pista no repo do dono** (`AGENTS.md:7516`): a POC é do Google Drive
  ("whatsmeow completo + cliente de Sender Keys"), sem link versionado.
- **Material efetivamente usado:** (a) fork `Souzzaaxzy/baileys` (`@itsliaaa/baileys`
  0.3.18-final, commit `a5b9495`) — parcialmente; (b) **fontes públicas** de
  engenharia reversa (abaixo).

---

## 3. Arquitetura do protocolo (fonte: sigalor/whatsapp-web-reveng)

O WhatsApp Web fala **WebSocket binário** (`wss://w[1-8].web.whatsapp.com/ws`),
mensagens no formato `tag,payload`. Sobre o socket:

- **Noise handshake** (Curve25519 + HKDF + AES-256-CBC + HMAC-SHA256).
- Inner payload: **protobuf** (`WebMessageInfo`/`Message`) + nós binários.

### Vocabulário de tokens (confirmado na lista oficial do reveng)
A lista de 151 tokens inclui, literalmente:
`action, add, demote, promote, participant, admin, creator, owner, group, g.us,
set, get, query, error, response, status, "200", "400", "404", "409", "500"…`

Isso **confirma a forma real** dos nós de grupo — não é suposição.

---

## 4. Operações de grupo e o fluxo de promote/demote

### 4.1 Como o cliente solicita (Baileys/fork)
`lib/Socket/groups.js` → `groupParticipantsUpdate(jid, participants, action)`:

```js
groupQuery(jid, 'set', [
  { tag: action,                       // 'promote' | 'demote' | 'add' | 'remove'
    attrs: {},
    content: participants.map(jid => ({ tag: 'participant', attrs: { jid } })) }
]);
```

e `groupQuery` monta:
```js
{ tag:'iq', attrs:{ type:'set', xmlns:'w:g2', to: jid }, content }
```

**Observações verificáveis:**
- O cliente **não valida cargo** antes de enviar — o `action` é um rótulo.
- O **alvo** (participant jid) e o **grupo** (to) vêm do chamador.
- A **identidade autenticada** não vai num campo do cliente; ela é a própria
  sessão E2E (a stanza é assinada/cifrada com as chaves da conta).

### 4.2 Como a resposta é tratada
```js
const participantsAffected = getBinaryNodeChildren(node, 'participant');
return participantsAffected.map(p => ({ status: p.attrs.error || '200', ... }));
```

Ou seja: **cada participante** retorna `attrs.error` (ou 200 implícito). É o
**servidor** quem decide e reporta. **Solicitar ≠ executar.**

---

## 5. Server-Side Authorization (OWASP: BFLA / BOLA)

| Pergunta (BFLA) | Resposta com evidência |
|---|---|
| Operação privilegiada pode ser executada sem a permissão? | **Não há evidência.** A resposta traz erro por participante; o servidor valida cargo do autor contra o metadata do grupo. |
| Onde fica a checagem? | **No servidor.** O cliente não tem (nem deveria ter) a decisão final. |

| Pergunta (BOLA) | Resposta |
|---|---|
| IDs de grupo/participante associados à requisição? | Sim: `to=jid@g.us` + `participant jid`. |
| Há validação do contexto/autorização sobre o recurso? | **Sim, server-side** — o servidor checa se a conta é admin daquele grupo e se o alvo pertence a ele. |

**Documentação pública (várias fontes independentes):** *"This action requires
that your session has admin privileges in the target group"* (WasenderApi) e o
próprio Help Center: *"Only group admins are allowed to add/remove/promote/demote."*

### Mass assignment
O corpo de um promote é `{ action, participants:[jid] }`. **Não existem campos
`role`/`isAdmin`/`permission` no payload do WhatsApp** para o cliente "se
promover" — a vulnerabilidade clássica de *role parameter tampering* (comum em
SaaS) **não tem correspondente observável** aqui. Marcar `admin:true` num corpo
HTTP de wrapper (Wassenger/Wasender) é da **API do revendedor**, não do
protocolo do WhatsApp.

---

## 6. O que É documentado como manipulação (Black Hat 2019)

Zaikin & Vanunu (Check Point) fizeram RE do WhatsApp Web e demonstraram, ao
manipular o **conteúdo** (não o cargo):

1. **Fake reply** de alguém no grupo (manipular `participant`/citação);
2. **Fake de quem não está no grupo**;
3. **Mensagem "privada" no grupo** (enviar a um par, parecendo ao grupo) — *foi
   corrigido pelo WhatsApp*;
4. **Enviar mensagem para si mesmo** (`fromMe`).

O ponto em comum: manipulando `conversation`, `participant`, `fromMe`,
`remoteJid`, `id` no protobuf, o **conteúdo exibido** muda. **Não** é escalada
de privilégio de cargo — é **consistência de transcrição** (o mesmo ID com
conteúdo diferente por destinatário, como já registrei no
`docs/mensagens-nao-decifraveis.md` #3).

---

## 7. Relação com o Baileys

- **Reaproveitável:** o **modelo de transporte** (stanza `w:g2` com
  `<promote>/<demote>` + `<participant>`, resposta com `error` por participante)
  é idêntico no Baileys e no WhatsApp Web. Confirma "cliente declara, servidor
  decide".
- **Diferenças:** o Baileys abstrai o binário em `groupParticipantsUpdate`; a API
  do WhatsApp Web/mobile usa os mesmos nós por baixo. Não há caminho "por fora"
  da autorização.
- **Não transferir conclusões:** o achado do Black Hat é de **2009-2019 no
  WhatsApp Web**; não afirmo que vale para esta versão/fork sem medir.

---

## 8. Classificação das descobertas

### CONFIRMADO
- **Autorização de cargo é server-side.** Evidência: forma da stanza + resposta
  com `error` por participante + documentação de múltiplas fontes independentes
  ("requires admin privileges"). Pré-condição: sessão E2E válida. Impacto: nenhum
  (é o comportamento correto). Reprodução autorizada: conta comum tentando
  `promote` num grupo de teste → espera-se erro, sem mudança de cargo.

### DESCARTADO
- **"Cliente sem verificação local = vulnerabilidade de escalada".** A ausência
  de checagem no cliente é esperada; a decisão é remota. (Confirmado pelo fluxo.)

### NÃO CONFIRMADO
- **Escalada vertical real (não-admin se promovendo).** Sem PoC público e sem
  ambiente autorizado aqui. Precisa de teste de campo (cenário B controle
  negativo).
- **Inconsistência "estado local vs servidor".** Há **cache** de metadata no
  cliente (Baileys `cachedGroupMetadata`, TTL curto). Um cache desatualizado pode
  mostrar cargo antigo — mas isso é **display**, não privilégio efetivo (o
  servidor rejeita a ação inválida na hora).

### HIPÓTESE
- **Manipulação de notificações de grupo** (forjar "X entrou/saiu/promoveu") —
  mesma família da consistência de transcrição. Caminho de código existe
  (`group-participants.update`), mas não comprova vulnerabilidade.

---

## 9. Limitações
- Sem `poc-cliente` e **sem ambiente autorizado** (sem sessão pareada/grupo de
  teste) → **não executei** os cenários A–E; ficam descritos.
- Sem acesso ao binário do servidor do WhatsApp → a decisão do servidor é
  inferida de: forma da stanza, resposta com `error`, e documentação pública.
- Não medi versão-a-versão.

## 10. Como testar (ambiente autorizado, contas próprias)
- **A (positivo):** admin promove membro → espera 200 + metadata atualizado.
- **B (negativo):** membro comum chama `groupParticipantsUpdate(gid,[si],'promote')`
  → espera **erro por participante** (401/403/`not-authorized`) e **nenhuma**
  mudança. Se o cargo mudar, aí sim é achado CONFIRMADO.
- **C (estado):** comparar metadata local com `groupMetadata` após sync.
- **D (erros):** conferir `status`/`error` retornados, sem mudança parcial.
- **E (regressão):** repetir A/B após qualquer correção.

## 11. Recomendações
- **Não confiar em estado local de cargo** para decidir (o bot já faz certo:
  re-checa `isGroupAdmin` do metadata antes de agir).
- Em qualquer bot, **ignorar o `action` como prova** — usar o retorno do servidor
  (o bot já trata `operation:'remove'` + `ok` para só então anunciar).
- Monitorar inconsistências (evento de participantes sem autor admin) — já
  existe `handleGroupParticipantsUpdate` + anti-roubo.

## 12. Referências
- **Black Hat USA 2019** — Zaikin & Vanunu (Check Point): *Reverse Engineering
  WhatsApp Encryption for Chat Manipulation and More* (4 manipulações; a #3 foi
  corrigida).
- **sigalor/whatsapp-web-reveng** — spec do protocolo binário + lista de tokens
  (`promote`/`demote`/`participant`/`admin`/`creator` + códigos 200/400/404/409).
- **WhatsApp Help Center** — controles de admin de grupo/comunidade.
- **WasenderApi / Wassenger / wwebjs** — *"requires admin privileges in the
  target group"* (documentação de API de wrapper).
- **OWASP API Security** — BFLA/BOLA; **OWASP WSTG** — Privilege Escalation.
- **KCL / EuroCrypt 2025** — WhatsApp sem gestão criptográfica de grupo.
