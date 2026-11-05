// Geração do relatório fotográfico (.docx e .pdf) no layout do modelo:
// A4, margens estreitas, 6 fotos por página (3 colunas: linha de fotos + linha de legendas)
// e, ao final, a página "ESTATÍSTICAS DA INSPEÇÃO".
const Relatorio = (() => {
  const FOTOS_POR_PAGINA = 6;

  const dois = n => String(n).padStart(2, '0');
  function formatarDataHora(ms) {
    const d = new Date(ms);
    return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()} ` +
      `${dois(d.getHours())}:${dois(d.getMinutes())}:${dois(d.getSeconds())}`;
  }
  const coord = v => Number(v).toFixed(6);

  // Legenda em duas partes: prefixo em negrito e restante normal (igual ao modelo).
  function legenda(reg, n, alimentador) {
    const desc = (reg.descricao || '').trim().replace(/\.+$/, '');
    const corpo = (desc ? `${reg.tipo}, ${desc}.` : `${reg.tipo}.`) +
      ` (${coord(reg.lat)}, ${coord(reg.lon)})`;
    const rotulo = reg.foto ? `Foto ${n}` : `Registro ${n} (sem foto)`;
    return { negrito: `${rotulo} - Alim. ${reg.alimentador || alimentador}: `, normal: corpo };
  }

  function distanciaKm(a, b) {
    const rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  }

  const qtd = n => `${n} ${n === 1 ? 'registro' : 'registros'}`;
  const pct = (n, total) => `${(100 * n / total).toFixed(1).replace('.', ',')}%`;

  // Página "ESTATÍSTICAS DA INSPEÇÃO" (como no modelo), descrita como linhas com estilo,
  // para o .docx e o .pdf mostrarem o mesmo conteúdo.
  //   titulo | destaque (negrito 12) | nota (itálico 8) | secao / item (negrito itálico 8) | espaco
  function estatisticas(regs, tipos, alimPadrao, distribuidora) {
    let duracaoMin = 0, km = 0;
    if (regs.length > 1) {
      duracaoMin = Math.round((regs[regs.length - 1].dataHora - regs[0].dataHora) / 60000);
      for (let i = 1; i < regs.length; i++) km += distanciaKm(regs[i - 1], regs[i]);
    }
    const contar = chave => {
      const m = new Map();
      for (const r of regs) m.set(chave(r), (m.get(chave(r)) || 0) + 1);
      return [...m];
    };
    // Mais frequentes primeiro; empate segue a ordem da lista de tipos.
    const porTipo = contar(r => r.tipo).sort((a, b) => b[1] - a[1] || tipos.indexOf(a[0]) - tipos.indexOf(b[0]));
    const porAlim = contar(r => r.alimentador || alimPadrao).sort((a, b) => b[1] - a[1]);
    const total = regs.length;
    const semFoto = regs.filter(r => !r.foto).length;

    const L = [
      ['titulo', 'ESTATÍSTICAS DA INSPEÇÃO'],
      ['espaco'],
      ...(distribuidora ? [['destaque', `Distribuidora: ${distribuidora}`]] : []),
      ['destaque', `Duração Total: ${Math.floor(duracaoMin / 60)}h ${dois(duracaoMin % 60)}min`],
      ['destaque', `Percurso Estimado: ${km.toFixed(2).replace('.', ',')} km`],
      ['nota', '(Soma das distâncias em linha reta entre registros consecutivos, em ordem de data/hora)'],
      ['espaco'],
      ['secao', `Irregularidades encontradas: ${qtd(total)} de ${porTipo.length} ${porTipo.length === 1 ? 'tipo' : 'tipos'}`],
      ...(semFoto ? [['nota', `(${semFoto === 1 ? '1 registro sem foto' : `${semFoto} registros sem foto`})`]] : []),
      ['espaco'],
      ['secao', 'Resumo por Tipo:'],
      ...porTipo.map(([t, n]) => ['item', ` • ${t}: ${qtd(n)} (${pct(n, total)})`]),
    ];
    if (porAlim.length > 1) L.push(['espaco'], ['secao', 'Resumo por Alimentador:'],
      ...porAlim.map(([a, n]) => ['item', ` • ${a}: ${qtd(n)} (${pct(n, total)})`]));
    return L;
  }

  // Qualidade das fotos no relatório (escolhida na inspeção). O app guarda as fotos em
  // alta e reduz na hora de gerar, então dá para trocar a qualidade depois.
  // maxRegistros: fotos que cabem num relatório de LIMITE_MB (limite comum de anexo de e-mail), pelo
  // tamanho médio da foto, deixando ~1 MB para o restante do arquivo.
  const LIMITE_MB = 25;
  const QUALIDADES = {
    baixa: { rotulo: 'Baixa', max: 1024, q: 0.6, mb: 0.1, dica: 'arquivo leve, bom para WhatsApp (~0,1 MB por foto)' },
    media: { rotulo: 'Média', max: 1600, q: 0.75, mb: 0.3, dica: 'equilíbrio entre nitidez e tamanho (~0,3 MB por foto)' },
    alta: { rotulo: 'Alta', max: 2400, q: 0.88, mb: 1, dica: 'máximo de detalhe, arquivo grande (~1 MB por foto)' },
  };
  for (const q of Object.values(QUALIDADES)) q.maxRegistros = Math.floor((LIMITE_MB - 1) / q.mb);

  async function ajustarFoto(r, nivel) {
    if (!r.foto) return null; // registro sem foto
    const { max, q } = QUALIDADES[nivel] || QUALIDADES.media;
    const larg = r.fotoLargura || 3, alt = r.fotoAltura || 4;
    if (nivel === 'alta' && Math.max(larg, alt) <= max) return { blob: r.foto, largura: larg, altura: alt };
    const img = await createImageBitmap(r.foto);
    const f = Math.min(1, max / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * f); cv.height = Math.round(img.height * f);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    img.close();
    const blob = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', q));
    return { blob, largura: cv.width, altura: cv.height };
  }

  // Cabe a foto numa caixa mantendo a proporção.
  function caber(larg, alt, maxL, maxA) {
    const f = Math.min(maxL / larg, maxA / alt);
    return [larg * f, alt * f];
  }

  function paginas(regs) {
    const p = [];
    for (let i = 0; i < regs.length; i += FOTOS_POR_PAGINA) p.push(regs.slice(i, i + FOTOS_POR_PAGINA));
    return p;
  }

  function nomeArquivo(alimentador, ext) {
    const d = new Date();
    const alim = alimentador.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '_');
    return `Relatorio_Fotografico_${alim}_${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}_${dois(d.getHours())}${dois(d.getMinutes())}.${ext}`;
  }

  /* ---------------------------- DOCX ---------------------------- */

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const COR_TITULO = 'B35500', COR_LINHA = 'EA7501'; // laranja da Energia Elétrica (ARSESP)
  const COL_TWIPS = 3570;                       // 3 colunas na área útil (11909 - 2 × 600)
  const FOTO_MAX_L = 2160000, FOTO_MAX_A = 2946400; // caixa da foto em EMU (altura igual ao modelo)

  const run = (texto, { negrito = false, italico = false, tam = 18, cor = null } = {}) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>` + (cor ? `<w:color w:val="${cor}"/>` : '') +
    (negrito ? '<w:b/><w:bCs/>' : '') + (italico ? '<w:i/><w:iCs/>' : '') +
    `<w:sz w:val="${tam}"/><w:szCs w:val="${tam}"/></w:rPr><w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`;

  const par = (conteudo, { alinh = 'left', depois = 0 } = {}) =>
    `<w:p><w:pPr><w:spacing w:before="0" w:after="${depois}" w:line="240" w:lineRule="auto"/><w:jc w:val="${alinh}"/></w:pPr>${conteudo}</w:p>`;

  const quebraPagina = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

  function imagemXml(rid, id, cx, cy) {
    cx = Math.round(cx); cy = Math.round(cy);
    return `<w:r><w:drawing><wp:inline distT="19050" distB="19050" distL="19050" distR="19050">` +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
      `<wp:docPr id="${id}" name="Foto ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
      `<pic:nvPicPr><pic:cNvPr id="${id}" name="foto${id}.jpg"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  const celula = conteudo =>
    `<w:tc><w:tcPr><w:tcW w:w="${COL_TWIPS}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${conteudo}</w:tc>`;

  const linhaTabela = celulas =>
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${celulas.join('')}</w:tr>`;

  function tabelaPagina(grupo, inicio, alimentador) {
    const borda = t => `<w:${t} w:val="single" w:sz="8" w:space="0" w:color="000000"/>`;
    let xml = `<w:tbl><w:tblPr><w:tblW w:w="${COL_TWIPS * 3}" w:type="dxa"/><w:jc w:val="left"/>` +
      `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(borda).join('')}</w:tblBorders>` +
      `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid>${'<w:gridCol w:w="' + COL_TWIPS + '"/>'.repeat(3)}</w:tblGrid>`;
    for (let i = 0; i < grupo.length; i += 3) {
      const trio = grupo.slice(i, i + 3);
      while (trio.length < 3) trio.push(null);
      xml += linhaTabela(trio.map(r => celula(r ? par(r._imgXml, { alinh: 'center' }) : par(''))));
      xml += linhaTabela(trio.map((r, k) => {
        if (!r) return celula(par(''));
        const l = legenda(r, inicio + i + k + 1, alimentador);
        return celula(par(run(l.negrito, { negrito: true }) + run(l.normal), { alinh: 'center' }));
      }));
    }
    return xml + '</w:tbl>';
  }

  function paginaEstatisticas(linhas) {
    const estilo = {
      titulo: [{ tam: 24, negrito: true, cor: COR_TITULO }, { alinh: 'center', depois: 60 }],
      destaque: [{ tam: 24, negrito: true }, { depois: 40 }],
      nota: [{ tam: 16, italico: true }, {}],
      secao: [{ tam: 16, negrito: true, italico: true }, { depois: 40 }],
      item: [{ tam: 16, negrito: true, italico: true }, {}],
    };
    return linhas.map(([tipo, texto]) => {
      if (tipo === 'espaco') return par('', { depois: 120 });
      const [fonte, paragrafo] = estilo[tipo];
      let xml = par(run(texto, fonte), paragrafo);
      if (tipo === 'titulo')
        xml += par(run('_______________________________________________________', { tam: 24, cor: COR_LINHA }), { alinh: 'center', depois: 240 });
      return xml;
    }).join('');
  }

  async function gerarDocx(inspecao, regs, tipos) {
    const fotos = [];
    for (const r of regs) fotos.push(await ajustarFoto(r, inspecao.qualidade));
    const zip = new JSZip();
    let rels = '';
    regs.forEach((r, i) => {
      if (!fotos[i]) {
        r._imgXml = run('Registro sem foto', { italico: true, cor: '808080' });
        return;
      }
      const rid = `rIdFoto${i + 1}`;
      zip.file(`word/media/foto${i + 1}.jpg`, fotos[i].blob);
      rels += `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/foto${i + 1}.jpg"/>`;
      const [cx, cy] = caber(fotos[i].largura, fotos[i].altura, FOTO_MAX_L, FOTO_MAX_A);
      r._imgXml = imagemXml(rid, i + 1, cx, cy);
    });

    let corpo = '';
    paginas(regs).forEach((grupo, p) => {
      if (p > 0) corpo += quebraPagina;
      corpo += tabelaPagina(grupo, p * FOTOS_POR_PAGINA, inspecao.alimentador) + par('');
    });
    if (regs.length) corpo += quebraPagina;
    corpo += paginaEstatisticas(estatisticas(regs, tipos, inspecao.alimentador, inspecao.distribuidora && inspecao.distribuidora.nome));

    const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${corpo}` +
      `<w:sectPr><w:pgSz w:w="11909" w:h="16834"/><w:pgMar w:top="600" w:right="600" w:bottom="600" w:left="600" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
      `</w:body></w:document>`;

    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rIdEstilos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels}</Relationships>`);
    zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults>` +
      `<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault>` +
      `<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`);
    zip.file('word/document.xml', documento);

    regs.forEach(r => delete r._imgXml);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ---------------------------- PDF ---------------------------- */

  async function gerarPdf(inspecao, regs, tipos) {
    const fotos = new Map();
    for (const r of regs) fotos.set(r, await ajustarFoto(r, inspecao.qualidade));
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const M = 10.58, LARG = 210 - 2 * M, COL = LARG / 3;
    const FOTO_A = 81.8, FOTO_L = COL - 4, PAD = 1.5;
    const FONTE = 9, LINHA = FONTE * 0.3528 * 1.2;
    const MAX_LINHAS = 11;

    // Quebra de linha com trechos em negrito/normal, centralizada.
    function quebrar(trechos, largura) {
      const linhas = [[]]; let atual = 0;
      for (const t of trechos) {
        doc.setFont('helvetica', t.negrito ? 'bold' : 'normal');
        for (const palavra of (t.texto.match(/[^ ]+ *| +/g) || [])) {
          const w = doc.getTextWidth(palavra);
          if (atual + w > largura && atual > 0) { linhas.push([]); atual = 0; }
          linhas[linhas.length - 1].push({ texto: palavra, negrito: t.negrito, w });
          atual += w;
        }
      }
      return linhas;
    }

    function desenharLegenda(linhas, x, y) {
      linhas.forEach((ln, i) => {
        const ultimo = ln[ln.length - 1];
        const total = ln.reduce((s, p) => s + p.w, 0) - (ultimo && ultimo.texto.endsWith(' ') ? doc.getTextWidth(' ') : 0);
        let cx = x + (COL - total) / 2;
        for (const p of ln) {
          doc.setFont('helvetica', p.negrito ? 'bold' : 'normal');
          doc.text(p.texto, cx, y + PAD + LINHA * (i + 0.8));
          cx += p.w;
        }
      });
    }

    doc.setFontSize(FONTE);
    doc.setLineWidth(0.3);
    const grupos = paginas(regs);
    for (let p = 0; p < grupos.length; p++) {
      if (p > 0) doc.addPage();
      let y = M;
      const grupo = grupos[p];
      for (let i = 0; i < grupo.length; i += 3) {
        const trio = grupo.slice(i, i + 3);
        while (trio.length < 3) trio.push(null);
        // fotos (linha baixa quando nenhum dos três tem foto)
        const altFoto = trio.some(r => r && fotos.get(r)) ? FOTO_A + 2 * PAD : 12;
        for (let k = 0; k < 3; k++) {
          const x = M + k * COL;
          doc.rect(x, y, COL, altFoto);
          const r = trio[k];
          if (!r) continue;
          const foto = fotos.get(r);
          if (!foto) {
            doc.setFont('helvetica', 'italic'); doc.setTextColor(128, 128, 128);
            doc.text('Registro sem foto', x + COL / 2, y + altFoto / 2 + 1, { align: 'center' });
            doc.setTextColor(0, 0, 0);
            continue;
          }
          const [w, h] = caber(foto.largura, foto.altura, FOTO_L, FOTO_A);
          const bytes = new Uint8Array(await foto.blob.arrayBuffer());
          doc.addImage(bytes, 'JPEG', x + (COL - w) / 2, y + PAD, w, h, `foto${p}_${i + k}`, 'FAST');
        }
        y += altFoto;
        // legendas
        doc.setFontSize(FONTE);
        const blocos = trio.map((r, k) => {
          if (!r) return [];
          const l = legenda(r, p * FOTOS_POR_PAGINA + i + k + 1, inspecao.alimentador);
          let ls = quebrar([{ texto: l.negrito, negrito: true }, { texto: l.normal, negrito: false }], COL - 2 * PAD - 1);
          if (ls.length > MAX_LINHAS) { ls = ls.slice(0, MAX_LINHAS); ls[MAX_LINHAS - 1].push({ texto: '…', negrito: false, w: doc.getTextWidth('…') }); }
          return ls;
        });
        const altLeg = Math.max(...blocos.map(b => b.length), 1) * LINHA + 2 * PAD + 0.5;
        for (let k = 0; k < 3; k++) {
          doc.rect(M + k * COL, y, COL, altLeg);
          desenharLegenda(blocos[k], M + k * COL, y);
        }
        y += altLeg;
      }
    }

    // estatísticas
    if (regs.length) doc.addPage();
    const estilo = {
      titulo: { tam: 12, fonte: 'bold', depois: 3 },
      destaque: { tam: 12, fonte: 'bold', depois: 6 },
      nota: { tam: 8, fonte: 'italic', depois: 4 },
      secao: { tam: 8, fonte: 'bolditalic', depois: 4 },
      item: { tam: 8, fonte: 'bolditalic', depois: 4 },
    };
    let y = M + 8;
    for (const [tipo, texto] of estatisticas(regs, tipos, inspecao.alimentador, inspecao.distribuidora && inspecao.distribuidora.nome)) {
      if (tipo === 'espaco') { y += 5; continue; }
      const e = estilo[tipo];
      doc.setFont('helvetica', e.fonte); doc.setFontSize(e.tam);
      if (tipo === 'titulo') {
        doc.setTextColor(0xb3, 0x55, 0x00);
        doc.text(texto, 105, y, { align: 'center' });
        doc.setTextColor(0, 0, 0);
        y += e.depois;
        doc.setDrawColor(0xea, 0x75, 0x01); doc.setLineWidth(0.6);
        doc.line(45, y, 165, y);
        doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.3);
        y += 9;
        continue;
      }
      if (y > 287) { doc.addPage(); y = M + 8; }
      doc.text(texto, M, y);
      y += e.depois;
    }

    return doc.output('blob');
  }

  return { gerarDocx, gerarPdf, nomeArquivo, formatarDataHora, ajustarFoto, QUALIDADES, LIMITE_MB };
})();
