"""Converte a BDGD (File Geodatabase da ANEEL) em arquivos JSON pequenos, um por alimentador.

Uso: python processar.py <zip da BDGD> <pasta de saída> <id> "<nome exibido>"
Gera <saida>/<id>/alimentadores.json e <saida>/<id>/a/<arquivo>.json, e devolve um resumo em JSON.
"""
import json, os, re, sys, zipfile
from collections import defaultdict

import numpy as np
import pyogrio
from shapely import line_merge, get_coordinates, get_parts
from shapely.geometry import MultiLineString

zip_path, saida, ident, nome_exib = sys.argv[1:5]
with zipfile.ZipFile(zip_path) as z:
    gdb = next(n.split('.gdb/')[0] + '.gdb' for n in z.namelist() if '.gdb/' in n)
fonte = f'/vsizip/{zip_path}/{gdb}'
titulo = os.path.basename(zip_path)[:-4]

def ler(camada, colunas, geometria=True, onde=None):
    return pyogrio.read_dataframe(fonte, layer=camada, columns=colunas, read_geometry=geometria, where=onde,
                                  use_arrow=False)

# Tensão nominal (tabela TTEN do Módulo 10), só os valores de média tensão.
TTEN = {'41': 11.4, '42': 11.9, '43': 12.0, '44': 12.6, '45': 12.7, '46': 13.2, '47': 13.337, '48': 13.53,
        '49': 13.8, '50': 13.86, '51': 14.14, '52': 14.19, '53': 14.4, '54': 14.835, '55': 15.0, '56': 15.2,
        '57': 19.053, '58': 19.919, '59': 21.0, '60': 21.5, '61': 22.0, '62': 23.0, '63': 23.1, '64': 23.827,
        '65': 24.0, '66': 24.2, '67': 25.0, '68': 25.8, '69': 27.0, '70': 30.0, '71': 33.0, '72': 34.5,
        '73': 36.0, '74': 38.0}

r5 = lambda v: round(float(v), 5)
txt = lambda v: '' if v is None or (isinstance(v, float) and np.isnan(v)) else str(v).strip()
ativo = lambda df: df[df['SIT_ATIV'].fillna('AT') != 'DS'] if 'SIT_ATIV' in df else df

ctmt = ler('CTMT', ['COD_ID', 'NOME', 'SUB', 'TEN_NOM'], geometria=False)
subs = ler('SUB', ['COD_ID', 'NOME'])
sub_info = {txt(r.COD_ID): (txt(r.NOME), r.geometry.representative_point() if r.geometry is not None else None)
            for r in subs.itertuples()}

# Rede primária: segmentos unidos em linhas contínuas, separando trifásica de mono/bifásica.
ssdmt = ler('SSDMT', ['CTMT', 'FAS_CON', 'PN_CON_1', 'PN_CON_2'])
ssdmt = ssdmt[ssdmt.geometry.notna()]
ssdmt['tri'] = ssdmt['FAS_CON'].fillna('').str.replace('N', '').str.len() >= 3
rede = defaultdict(lambda: {'rede3': [], 'rede1': []})
for (cod, tri), grupo in ssdmt.groupby(['CTMT', 'tri']):
    partes = []
    for g in grupo.geometry.values:
        partes.extend(get_parts(g))
    unidas = line_merge(MultiLineString(partes))
    linhas = get_parts(unidas)
    chave = 'rede3' if tri else 'rede1'
    for ln in linhas:
        c = get_coordinates(ln)
        rede[txt(cod)][chave].append([r5(x) for par in c for x in par])

# Postes e pontos da rede de média tensão (PONNOT ligados aos segmentos do alimentador).
pn_alim = {}
for col in ('PN_CON_1', 'PN_CON_2'):
    for pn, cod in zip(ssdmt[col].values, ssdmt['CTMT'].values):
        if pn is not None:
            pn_alim.setdefault(txt(pn), txt(cod))
postes = defaultdict(list)
ponnot = ler('PONNOT', ['COD_ID', 'TIP_PN'])
for cod_pn, tip, g in zip(ponnot['COD_ID'].values, ponnot['TIP_PN'].values, ponnot.geometry.values):
    a = pn_alim.get(txt(cod_pn))
    if a and g is not None and txt(tip) in ('POS', 'PSE', 'PIS', 'PSA', 'PSB', ''):
        postes[a].extend([r5(g.x), r5(g.y)])
del ponnot

def pontos(camada, colunas):
    df = ativo(ler(camada, ['CTMT', 'SIT_ATIV'] + colunas))
    df = df[df.geometry.notna()]
    out = defaultdict(list)
    for r in df.itertuples():
        g = r.geometry
        if g.geom_type != 'Point':
            g = g.representative_point()
        out[txt(r.CTMT)].append((r5(g.x), r5(g.y), r))
    return out

trafos = defaultdict(list)
for cod, lst in pontos('UNTRMT', ['COD_ID', 'POT_NOM', 'FAS_CON_P', 'POSTO', 'MUN']).items():
    for x, y, r in lst:
        pot = r.POT_NOM
        try:
            pot = float(pot)
            pot = int(pot) if pot.is_integer() else pot
        except (TypeError, ValueError):
            pot = None
        trafos[cod].append([x, y, pot, txt(r.FAS_CON_P), txt(r.COD_ID)])

chaves = defaultdict(list)
for cod, lst in pontos('UNSEMT', ['COD_ID', 'TIP_UNID', 'P_N_OPE', 'COR_NOM', 'FAS_CON']).items():
    for x, y, r in lst:
        chaves[cod].append([x, y, txt(r.TIP_UNID), txt(r.P_N_OPE), txt(r.COD_ID), txt(r.FAS_CON)])

reguladores = defaultdict(list)
for cod, lst in pontos('UNREMT', ['COD_ID', 'FAS_CON']).items():
    for x, y, r in lst:
        reguladores[cod].append([x, y, txt(r.COD_ID), txt(r.FAS_CON)])

capacitores = defaultdict(list)
for cod, lst in pontos('UNCRMT', ['COD_ID', 'FAS_CON']).items():
    for x, y, r in lst:
        capacitores[cod].append([x, y, txt(r.COD_ID), txt(r.FAS_CON)])

# Município (código IBGE) dos transformadores: serve para saber se a distribuidora atua em SP (código 35…).
mun = ler('UNTRMT', ['MUN'], geometria=False)['MUN'].dropna().astype(str)
frac_sp = float((mun.str[:2] == '35').mean()) if len(mun) else 0.0

nome_arq = lambda cod: re.sub(r'[^A-Za-z0-9_-]+', '_', cod)[:80] or 'sem_codigo'
os.makedirs(os.path.join(saida, ident, 'a'), exist_ok=True)
lista, usados, total = [], set(), 0
for r in ctmt.itertuples():
    cod = txt(r.COD_ID)
    rd = rede.get(cod)
    if not rd or not (rd['rede3'] or rd['rede1']):
        continue  # circuito sem rede de média tensão cadastrada
    arq = nome_arq(cod)
    while arq in usados:
        arq += '_'
    usados.add(arq)
    xs = [v for ln in rd['rede3'] + rd['rede1'] for v in ln[0::2]]
    ys = [v for ln in rd['rede3'] + rd['rede1'] for v in ln[1::2]]
    sub_nome, sub_pt = sub_info.get(txt(r.SUB), ('', None))
    dados = {
        'v': 1, 'dist': nome_exib, 'fonte': titulo, 'cod': cod, 'nome': txt(r.NOME), 'sub': txt(r.SUB),
        'subNome': sub_nome, 'kv': TTEN.get(txt(r.TEN_NOM)),
        'bbox': [min(xs), min(ys), max(xs), max(ys)],
        'subPt': [r5(sub_pt.x), r5(sub_pt.y)] if sub_pt is not None else None,
        'rede3': rd['rede3'], 'rede1': rd['rede1'],
        'trafos': trafos.get(cod, []), 'chaves': chaves.get(cod, []),
        'reguladores': reguladores.get(cod, []), 'capacitores': capacitores.get(cod, []),
        'postes': postes.get(cod, []),
    }
    corpo = json.dumps(dados, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(saida, ident, 'a', arq + '.json'), 'w', encoding='utf-8') as f:
        f.write(corpo)
    total += len(corpo)
    lista.append([cod, txt(r.NOME), txt(r.SUB), sub_nome, arq, len(dados['trafos'])])

lista.sort(key=lambda l: (l[2], l[1], l[0]))
with open(os.path.join(saida, ident, 'alimentadores.json'), 'w', encoding='utf-8') as f:
    json.dump({'dist': nome_exib, 'fonte': titulo, 'alimentadores': lista}, f, ensure_ascii=False, separators=(',', ':'))
print(json.dumps({'id': ident, 'nome': nome_exib, 'fonte': titulo, 'alimentadores': len(lista),
                  'bytes': total, 'fracSP': round(frac_sp, 3)}, ensure_ascii=False))
