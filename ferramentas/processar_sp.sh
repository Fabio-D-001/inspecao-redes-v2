#!/bin/bash
# Processa as distribuidoras de SP: <prefixo do zip>|<id>|<nome exibido>
# Uso: processar_sp.sh <pasta (caminho completo) com os .zip da BDGD baixados do portal da ANEEL> <pasta de saída, caminho completo, ex.: .../app-v2/dados/2025>
# Requer Python com pyogrio, geopandas e shapely. Gera resumo.jsonl na pasta de saída.
ZIPS=$1; OUT=$2
mkdir -p "$OUT"
cd "$(dirname "$0")"
while IFS='|' read -r pre id nome; do
  z=$(ls "$ZIPS"/${pre}_*.zip | tail -1)
  python3 processar.py "$z" "$OUT" "$id" "$nome" | tail -1 >> "$OUT/resumo.jsonl" || echo "ERRO $id" >> "$OUT/resumo.jsonl"
  echo "feito $id"
done <<'L'
Cedrap|cedrap|Cedrap (cooperativa)
Cedri|cedri|Cedri (cooperativa)
Cemirim|cemirim|Cemirim (cooperativa)
Cerim|cerim|Cerim (cooperativa)
Ceripa|ceripa|Ceripa (cooperativa)
Ceris|ceris|Ceris (cooperativa)
Cerpro|cerpro|Cerpro (cooperativa)
Cerrp|cerrp|Cerrp (cooperativa)
Cervam|cervam|Cervam (cooperativa)
Cetril|cetril|Cetril (cooperativa)
CPFL_Santa_Cruz|cpfl-santa-cruz|CPFL Santa Cruz
Energisa_Sul-Sudeste|energisa-sul-sudeste|Energisa Sul-Sudeste
CPFL_Piratininga|cpfl-piratininga|CPFL Piratininga
EDP_SP|edp-sp|EDP São Paulo
Neoenergia_Elektro|neoenergia-elektro|Neoenergia Elektro
CPFL_Paulista|cpfl-paulista|CPFL Paulista
Enel_SP|enel-sp|Enel Distribuição São Paulo
L
echo TUDO_PRONTO
