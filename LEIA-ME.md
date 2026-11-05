# Inspeção de Redes 2.0 — app offline

Aplicativo web instalável (PWA) para registro fotográfico georreferenciado de irregularidades em redes de distribuição, com relatório em .docx e .pdf no layout do modelo `Relatorio_Fotografico_2026-10-29_1849.docx`.

A versão 2.0 parte da 1.0 (pasta `app/`, que continua publicada e sem alterações) e acrescenta a rede do alimentador no mapa, com dados da BDGD da ANEEL.

## Novidades da 2.0
- **Distribuidora**: na nova inspeção, escolha uma das 17 distribuidoras que atuam no estado de SP. São 7 concessionárias (CPFL Paulista, CPFL Piratininga, CPFL Santa Cruz, EDP São Paulo, Enel Distribuição São Paulo, Energisa Sul-Sudeste e Neoenergia Elektro) e 10 cooperativas (Cedrap, Cedri, Cemirim, Cerim, Ceripa, Ceris, Cerpro, Cerrp, Cervam e Cetril).
- **Alimentador**: digite parte do nome, do código ou da subestação e toque no alimentador da lista. A busca ignora espaços, acentos e maiúsculas, então "lub 01" acha "LUB 0106". Se o alimentador não estiver na lista, dá para digitá-lo, mas aí a rede não aparece no mapa.
- **Rede no mapa**: com internet, o app baixa a rede do alimentador e a mostra no mapa da inspeção, no "Escolher no mapa" e no mini-mapa do registro. A rede inclui:
  - rede primária, trifásica e mono/bifásica;
  - transformadores;
  - chaves fusíveis e chaves seccionadoras;
  - religadores, disjuntores e seccionalizadores;
  - reguladores de tensão e bancos de capacitores;
  - postes (só com zoom alto);
  - subestação.
- **Minha posição no mapa**: o mapa da inspeção mostra a posição atual (ponto azul com o círculo de precisão do GPS). O botão abaixo do zoom centraliza o mapa nela; no "Escolher no mapa" ele também liga o GPS. A busca para quando o mapa fecha.
- **Escolher camadas**: o botão de camadas, no canto do mapa, liga e desliga cada tipo de equipamento. O app lembra a escolha.
- **Equipamento no registro**: tocar num equipamento mostra código, potência, fases e estado normal (aberta ou fechada). Ao escolher o ponto de um registro, dá para usar a posição do equipamento e citá-lo na descrição.
- **Uso offline**: a rede de um alimentador já aberto fica guardada no aparelho e funciona sem internet. Abra a inspeção com internet antes de ir a campo.
- **Relatório**: a página de estatísticas mostra a distribuidora.
- **Dados separados**: a 2.0 guarda os seus dados num banco próprio (`inspecao-redes-v2`) e na pasta `InspecaoRedes2/`. Assim ela não interfere na 1.0, que fica no mesmo endereço do github.io. Em "Backup dos dados", o botão **Copiar inspeções da versão 1.0** traz para cá as inspeções da 1.0 que estiverem no aparelho. Os backups .json das duas versões são compatíveis.

## Uso
1. **Nova inspeção**: escolha a distribuidora, o alimentador e a qualidade das fotos no relatório. A qualidade pode ser baixa (cerca de 0,1 MB por foto), média (0,35 MB) ou alta (0,7 MB). Tudo isso pode ser trocado depois em "Alterar".
2. **Novo registro**: preencha alimentador, tipo de irregularidade, descrição, data/hora, localização e foto.
   - A localização vem do GPS, que continua buscando até a precisão ficar abaixo de 5 m. Também dá para digitá-la ou escolhê-la no mapa, com a rede.
3. **Relatório .docx / .pdf**: **Compartilhar** ou **Salvar no aparelho**.
4. **Pastas do app**: `Relatorios/`, `Registros/` (um .csv por inspeção) e `Fotos/`. **Exportar tudo (.zip)** leva as pastas para Downloads.
5. **Backup dos dados**: exporta e importa todas as inspeções, com fotos, num arquivo .json.

## Dados da rede (pasta `dados/`)
- **Fonte**: ANEEL, Base de Dados Geográfica da Distribuidora (BDGD), data-base 31/12/2025, publicada em ago/2026 em https://dadosabertos-aneel.opendata.arcgis.com/search?tags=distribuicao. São dados abertos.
- **Por que os dados são pré-processados**: a ANEEL publica a BDGD como File Geodatabase (.zip de até 1,9 GB por distribuidora), sem serviço de consulta. Por isso os dados foram convertidos com `ferramentas/processar.py` em um arquivo pequeno por alimentador, publicado junto com o app. O arquivo típico tem cerca de 35 KB, ou 10 KB compactado na transmissão.
- **Tamanho**: 6.511 alimentadores, 344 MB no total. O celular baixa só o alimentador escolhido.
- **Camadas da BDGD usadas**: CTMT (circuitos), SSDMT (rede MT), UNTRMT (transformadores), UNSEMT (chaves), UNREMT (reguladores), UNCRMT (capacitores), PONNOT (postes ligados à rede MT) e SUB (subestações).
  - Ficam de fora os equipamentos desativados (SIT_ATIV = DS).
  - Nenhum dado de consumidor é usado.
- **Códigos dos tipos de chave** (campo TIP_UNID): seguem a tabela do Módulo 10 do PRODIST. Um código fora da tabela aparece como "Equipamento de manobra (tipo N)".
- **Coordenadas**: SIRGAS 2000, arredondadas a 5 casas decimais (cerca de 1 m).
- **Como atualizar para um novo ano da BDGD**:
  1. Baixe os .zip.
  2. Rode `ferramentas/processar_sp.sh <pasta dos zips> <app-v2/dados/AAAA>`.
  3. Gere `dados/distribuidoras.json` a partir do `resumo.jsonl`.
  4. Troque o ano em `sw.js` (`DADOS` e o caminho `dados/AAAA/`).
  5. Altere `VERSAO`.

## Hospedagem
Publicado no GitHub Pages, em https e num repositório próprio, separado da 1.0. Ao publicar uma nova versão, altere `VERSAO` em `sw.js`.

Os caches do service worker começam com `v2-`, porque as duas versões estão no mesmo domínio (fabio-d-001.github.io). Se a 1.0 for atualizada um dia, o service worker dela apaga os caches que não são dela. Nesse caso, a 2.0 baixa tudo de novo na próxima abertura com internet.

## Mapa offline
O mapa de fundo (OpenStreetMap / satélite Esri) precisa de internet. As áreas já vistas ficam guardadas.

## Teste local
```bash
python3 -m http.server 8766 --directory app-v2
```
