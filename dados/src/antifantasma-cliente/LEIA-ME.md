# AntiFantasma — integração

Você recebeu **um único arquivo**: `antifantasma.cjs`. Coloque-o na mesma pasta
do seu `Index.js` (ex.: `src/`).

O funcionamento real roda no servidor — este arquivo é só o adaptador.

## Usar em OUTRO bot (levar só o comando)

Você **não** precisa copiar `core.js`, `api.js`, `keys.js`, `health.js` nem nada
do projeto. Leve **só o `antifantasma.cjs`** e cole a CASE no `index.js` do
outro bot. A lógica continua no servidor da Lizzy que gerou a KEY.

1. Na **Lizzy** (o servidor), rode `!addghostcmd` respondendo a uma mensagem
   **do número do outro bot**. Isso gera a KEY e o arquivo já configurado.
2. No outro bot, coloque `antifantasma.cjs` na pasta do `index.js`.
3. Cole a CASE (a que veio no tutorial) no switch de comandos.
4. Reinicie o bot e envie `!antifantasma` no grupo.

> ⚠️ A KEY fica registrada no servidor que a gerou. Um arquivo antigo, gerado
> por **outro** servidor, não vale aqui: gere de novo pelo `!addghostcmd`. É
> esse o caso que responde "KEY do AntiFantasma inválida ou revogada".

```
dados/
└── src/
    ├── index.js
    └── antifantasma.cjs        <- o ÚNICO arquivo que o outro bot precisa
```

## 1. Configure no topo do arquivo

Abra `antifantasma.cjs` e ajuste:

```js
const API_URL = 'https://SEU-SERVIDOR/api/antifantasma/exec';
const KEY = 'SUA-KEY-AQUI';
```

A `API_URL` é o **endpoint da Lizzy** (o servidor do plugin) — não a sua. Quem
instala o plugin gera a KEY e informa as duas linhas.

> O servidor detecta sozinho a própria URL pública: no início da Lizzy aparece
> no log algo como
> `Endpoint: https://host/api/antifantasma/exec`. É esse valor que vai aqui.

Em produção use **HTTPS** (a KEY nunca deve trafegar em claro).

## 2. Importe no Index.js

A CASE entregue no tutorial já traz o `require` **dentro** dela — você não
precisa importar nada no topo do arquivo.

> O arquivo termina em `.cjs` **de propósito**: assim funciona tanto num bot
> CommonJS quanto num bot ESM (a Lizzy é ESM). A CASE já carrega do jeito certo
> para cada caso — não renomeie nem mude a extensão.

## 3. Cole a CASE

A **CASE completa** vem no tutorial. Cole dentro do switch dos seus comandos.
Ela é autossuficiente.

## 4. Reinicie o bot e use

No grupo:

```
!antifantasma       → liga a proteção NESTE grupo
!antifantasma       → desliga
```

**Não existe etapa extra.** Você não precisa editar o seu handler de mensagens:
a CASE chama `iniciar(nazu)` e o plugin passa a observar as mensagens do grupo
sozinho, consultando a API e executando as ações. O estado é por grupo — ligar
no Grupo A não liga no Grupo B.

- **Desativado não chama a API** — se a proteção estiver desligada naquele
  grupo, `executar` retorna imediatamente e nada sai da sua bot.
- Você **não precisa saber** quais sinais caracterizam ataque: mande o contexto
  que tiver e a decisão vem do servidor.
- O `sock` precisa ter `groupSettingUpdate` e `groupParticipantsUpdate` (padrão
  no Baileys).

## Funções do módulo

| Função | Para que serve |
|---|---|
| `iniciar(sock)` | Liga a observação contínua (a CASE chama isto) |
| `parar()` | Para de observar |
| `ativar(grupo)` | Liga a proteção naquele grupo |
| `desativar(grupo)` | Desliga a proteção naquele grupo |
| `estaAtivo(grupo)` | A proteção está ligada naquele grupo? |
| `executar({ sock, msg })` | Avalia uma mensagem específica à mão (opcional) |

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