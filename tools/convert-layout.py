#!/usr/bin/env python3
"""
Converte as caixas decoradas simples para o layout `꧁༺ ✦ ༻꧂`.

O que converte (por PAR topo+rodape, nunca solto):
  - TOPO:   ╭━━━〔 <emoji> TITULO 〕━━━╮  (variantes ⊱..⊱, 〔〕, ╭━〔〕━⬣, ╭━━[..]━━)
  - RODAPE: ╰ + SO barras ━/═ + canto  →  ╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

NAO toca:
  - caixas ja no layout novo (꧁);
  - bordas configuraveis de menu (menuTopBorder/bottomBorder/header) -- tema do
    dono, nao template de mensagem;
  - caixa de largura FIXA (linhas de corpo com borda direita `│`) -- o layout novo
    nao tem borda direita, entao converter so o topo/rodape desalinharia;
  - topo sem rodape correspondente (e vice-versa) -- converter so um lado quebra.

Uso:
  python3 tools/convert-layout.py --dry
  python3 tools/convert-layout.py --apply
"""
import glob
import re
import sys

RODAPE = '╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯'

SKIP_LINE_MARKERS = ('menuTopBorder', 'bottomBorder', 'header:', 'menuItemIcon',
                     'middleBorder', 'menuHeader')

# Templates CONFIGURAVEIS pelo dono (global.json / settings do grupo): o texto
# salvo no banco continua o antigo, entao mexer no fallback do codigo nao muda o
# que o usuario ve -- so criaria divergencia. Ficam fora, por pedido.
SKIP_CONTEXT = ('globalJson', 'defaultText', 'settings.text', 'settings?.text',
                '#numerodele#', '#nomedogp#', '#membros#', '#user#')

# Placeholders de interpolacao: `${...}`, `{...}`, `#nome#`.
# Sao MASCARADOS antes do regex: sem isso o `]` de `${a[b]}` era lido como
# fechamento do titulo e a caixa saia corrompida (bug pego no dry-run).
MASK_RE = re.compile(r'\$\{[^}]*\}|\{[A-Za-z_][A-Za-z0-9_]*\}|#[A-Za-z_][A-Za-z0-9_]*#')
PUA = 0xE000

TOP_RE = re.compile(
    r'╭(?:━|═){1,6}\s*([〔⊱\[【])\s*([^\n`\x00]{0,140}?)\s*([〕⊰⊱\]】])(?:━|═)*(╮|⬣|╗|╯)?'
)
BOT_RE = re.compile(r'╰(?:━|═){3,}(╯|⬣|╗)')
# linha de corpo com borda direita (largura fixa)
RIGHT_BORDER_RE = re.compile(r'│\s*(?:\\n)?["\'`]?[,)]?\s*$')


def boldify(s):
    out = []
    for ch in s:
        cp = ord(ch)
        if 65 <= cp <= 90:
            out.append(chr(0x1D400 + cp - 65))
        elif 97 <= cp <= 122:
            out.append(chr(0x1D41A + cp - 97))
        elif 48 <= cp <= 57:
            out.append(chr(0x1D7CE + cp - 48))
        else:
            out.append(ch)
    return ''.join(out)


def limpar_titulo(inner):
    return inner.strip().replace('*', '').strip()


def mascarar(texto):
    itens = []

    def _rep(m):
        itens.append(m.group(0))
        return chr(PUA) + chr(PUA + len(itens)) + chr(PUA)

    return MASK_RE.sub(_rep, texto), itens


def desmascarar(texto, itens):
    for i, v in enumerate(itens, start=1):
        texto = texto.replace(chr(PUA) + chr(PUA + i) + chr(PUA), v)
    return texto


def converter_top(m):
    inner = limpar_titulo(m.group(2))
    if not inner:
        return None
    return f'╭━━━꧁༺ {boldify(inner)} ༻꧂━━━╮'


def processar(path, apply=False):
    with open(path, 'rb') as f:
        texto = f.read().decode('utf-8')
    linhas = texto.split('\n')
    n = len(linhas)
    novas = list(linhas)
    cont = {'top': 0, 'bot': 0, 'pulados_fixa': 0, 'pulados_sem_par': 0}

    i = 0
    while i < n:
        linha = linhas[i]
        if any(mk in linha for mk in SKIP_LINE_MARKERS):
            i += 1
            continue

        mascarado, itens = mascarar(linha)
        mtop = TOP_RE.search(mascarado)
        mbot = BOT_RE.search(mascarado)

        if mtop:
            # Caixa de UMA LINHA: topo e rodape na MESMA linha (o template tem
            # `\n`s internos). Sem tratar isso, a busca avancava e casava o topo
            # com o rodape da PROXIMA caixa (bug pego pelo teste de idempotencia).
            mb_mesma = BOT_RE.search(mascarado, mtop.end())
            if mb_mesma:
                novo_top = converter_top(mtop)
                saida = mascarado
                if novo_top:
                    saida = saida[:mtop.start()] + novo_top + saida[mtop.end():]
                    cont['top'] += 1
                    # posicoes mudaram: refaz o match do rodape
                    mb_mesma = BOT_RE.search(saida, mtop.start())
                if mb_mesma:
                    saida = saida[:mb_mesma.start()] + RODAPE + saida[mb_mesma.end():]
                    cont['bot'] += 1
                novas[i] = desmascarar(saida, itens)
                i += 1
                continue

            # Procura o rodape da caixa e os TOPOS ANINHADOS no caminho.
            # Caixas reais tem topo dentro de topo (ex.: PERFIL com bloco
            # ATIVIDADE no meio e UM rodape no fim), entao encontrar outro topo
            # NAO encerra a busca -- so um topo que ja tenha o proprio rodape.
            j = i + 1
            achou_bot = False
            tem_borda_dir = False
            topos_extras = []
            while j < n and j <= i + 40:
                lj_m = mascarar(linhas[j])[0]
                if BOT_RE.search(lj_m):
                    achou_bot = True
                    break
                mt2 = TOP_RE.search(lj_m)
                if mt2:
                    topos_extras.append((j, mt2))
                if RIGHT_BORDER_RE.search(linhas[j]):
                    tem_borda_dir = True
                j += 1

            # Qualquer `│` no corpo (borda direita OU o `\n│\n` colado ao topo)
            # indica largura FIXA -> o layout novo nao tem borda direita e
            # desalinharia. Pula. Templates configuraveis tambem ficam fora.
            corpo = '\n'.join(linhas[i:j + 1])
            contexto = '\n'.join(linhas[max(0, i - 3):j + 1])
            if tem_borda_dir or '│' in corpo or any(sk in contexto for sk in SKIP_CONTEXT):
                cont['pulados_fixa'] += 1
                i += 1
                continue
            if not achou_bot:
                cont['pulados_sem_par'] += 1
                i += 1
                continue

            novo_top = converter_top(mtop)
            if novo_top:
                novas[i] = desmascarar(mascarado[:mtop.start()] + novo_top +
                                       mascarado[mtop.end():], itens)
                cont['top'] += 1
            # topos aninhados
            for (k, mt2) in topos_extras:
                lk_m, lk_itens = mascarar(linhas[k])
                nt2 = converter_top(mt2)
                if nt2:
                    novas[k] = desmascarar(lk_m[:mt2.start()] + nt2 +
                                           lk_m[mt2.end():], lk_itens)
                    cont['top'] += 1
            # substitui o rodape correspondente
            lj_m, lj_itens = mascarar(linhas[j])
            mb2 = BOT_RE.search(lj_m)
            novas[j] = desmascarar(lj_m[:mb2.start()] + RODAPE + lj_m[mb2.end():], lj_itens)
            cont['bot'] += 1
            i = j + 1
            continue

        if mbot:
            # Rodape SOLTO NAO e convertido: so um par casado (topo+rodape) e
            # seguro. Converter rodape solto casava-o com o topo de OUTRA caixa
            # mais acima e desalinhava o bloco (visto no dry-run: 50 topos para
            # 134 rodapes).
            cont['pulados_sem_par'] += 1
            i += 1
            continue

        i += 1

    novo_texto = '\n'.join(novas)

    if novo_texto.count('\n') != texto.count('\n'):
        raise SystemExit(f'ABORTADO {path}: numero de linhas mudou')
    for pat in (r'\$\{[^}]*\}', r'#[A-Za-z_][A-Za-z0-9_]*#', r'\{[A-Za-z_][A-Za-z0-9_]*\}'):
        a = sorted(re.findall(pat, texto))
        c = sorted(re.findall(pat, novo_texto))
        if a != c:
            raise SystemExit(f'ABORTADO {path}: placeholders {pat} divergiram')

    if novo_texto != texto and apply:
        with open(path, 'wb') as f:
            f.write(novo_texto.encode('utf-8'))
    return cont


def main():
    apply = '--apply' in sys.argv
    total = {'top': 0, 'bot': 0, 'pulados_fixa': 0, 'pulados_sem_par': 0}
    tocados = 0
    for path in sorted(glob.glob('dados/src/**/*.js', recursive=True)):
        cont = processar(path, apply=apply)
        if cont['top'] or cont['bot']:
            tocados += 1
            for k in total:
                total[k] += cont[k]
            print(f"{cont['top']:4d} topo / {cont['bot']:4d} rodape  {path}")
    modo = 'APLICADO' if apply else 'DRY-RUN'
    print(f"\n[{modo}] {tocados} arquivos | {total['top']} topos | {total['bot']} rodapes")
    print(f"pulados: {total['pulados_fixa']} caixas de largura fixa | "
          f"{total['pulados_sem_par']} topo/rodape sem par")


if __name__ == '__main__':
    main()
