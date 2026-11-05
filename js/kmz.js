// Arquivo .kmz da inspeção (abre no Google Earth, Google My Maps e QGIS): a rede dos alimentadores
// carregados, separada por tipo de equipamento, e os registros com a foto de cada um.
const Kmz = (() => {
  const TIPO = 'application/vnd.google-earth.kmz';
  const esc = t => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cdata = t => `<![CDATA[${String(t).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  // #rrggbb → aabbggrr (ordem de cores do KML)
  const corKml = (hex, alfa = 'ff') => alfa + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
  const c6 = v => (+v).toFixed(6);
  const xy = (lat, lon) => `${c6(lon)},${c6(lat)},0`;

  // Ícone redondo (PNG) com a cor da camada, como no mapa do app.
  function icone(cor, borda, tamanho = 32) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = tamanho;
    const g = cv.getContext('2d');
    g.beginPath();
    g.arc(tamanho / 2, tamanho / 2, tamanho / 2 - 3, 0, 2 * Math.PI);
    g.fillStyle = cor; g.fill();
    g.lineWidth = 3; g.strokeStyle = borda || '#ffffff'; g.stroke();
    return new Promise(ok => cv.toBlob(ok, 'image/png'));
  }

  const tabela = linhas => '<table>' + linhas.filter(l => l[1]).map(([r, v]) => `<tr><td><b>${esc(r)}</b></td><td>${esc(v)}</td></tr>`).join('') + '</table>';
  const dados = campos => '<ExtendedData>' + campos.filter(c => c[1] !== '' && c[1] != null)
    .map(([n, v]) => `<Data name="${esc(n)}"><value>${esc(v)}</value></Data>`).join('') + '</ExtendedData>';

  async function gerar(insp, regs, redes) {
    const fotos = [];
    const fmt = Relatorio.formatarDataHora;
    const estilos = [], pastas = [];
    const icones = {};

    // Registros (irregularidades), na ordem do relatório, com a foto em qualidade baixa.
    estilos.push(`<Style id="registro"><IconStyle><scale>1.1</scale><Icon><href>files/icones/registro.png</href></Icon></IconStyle>` +
      `<LabelStyle><scale>0.9</scale></LabelStyle></Style>`,
      `<Style id="percurso"><LineStyle><color>${corKml('#ea7501', 'cc')}</color><width>2</width></LineStyle></Style>`);
    icones.registro = icone('#ea7501', '#ffffff', 40);
    const marcas = [];
    for (const [i, r] of regs.entries()) {
      const n = i + 1;
      const foto = `files/fotos/Foto_${String(n).padStart(2, '0')}.jpg`;
      fotos.push([foto, (await Relatorio.ajustarFoto(r, 'baixa')).blob]);
      const alim = r.alimentador || insp.alimentador;
      const linhas = [['Tipo', r.tipo], ['Descrição', r.descricao], ['Alimentador', alim], ['Data/hora', fmt(r.dataHora)],
        ['Coordenadas', `${c6(r.lat)}, ${c6(r.lon)}`], ['Precisão do GPS', r.precisao ? `±${Math.round(r.precisao)} m` : '']];
      marcas.push(`<Placemark><name>Foto ${n}</name><styleUrl>#registro</styleUrl>` +
        `<description>${cdata(`<b>Foto ${n} - ${esc(r.tipo)}</b>${tabela(linhas)}<img src="${foto}" width="420">`)}</description>` +
        dados([['Foto', n], ['Tipo', r.tipo], ['Descricao', r.descricao], ['Alimentador', alim], ['DataHora', fmt(r.dataHora)],
          ['Latitude', c6(r.lat)], ['Longitude', c6(r.lon)], ['PrecisaoGPS_m', r.precisao ? Math.round(r.precisao) : '']]) +
        `<Point><coordinates>${xy(r.lat, r.lon)}</coordinates></Point></Placemark>`);
    }
    if (regs.length > 1) marcas.push(`<Placemark><name>Percurso (ordem dos registros)</name><visibility>0</visibility><styleUrl>#percurso</styleUrl>` +
      `<LineString><tessellate>1</tessellate><coordinates>${regs.map(r => xy(r.lat, r.lon)).join(' ')}</coordinates></LineString></Placemark>`);
    pastas.push(`<Folder><name>Registros (irregularidades)</name><open>1</open>${marcas.join('')}</Folder>`);

    // Rede de cada alimentador carregado (BDGD/ANEEL).
    for (const d of redes) {
      const sub = [];
      for (const c of Rede.exportar(d)) {
        const id = `rede-${c.chave}`;
        if (!icones[c.chave] && !c.linhas) {
          icones[c.chave] = icone(c.cor, c.borda, c.chave === 'postes' ? 16 : 32);
          estilos.push(`<Style id="${id}"><IconStyle><scale>${c.chave === 'postes' ? 0.4 : c.chave === 'sub' ? 1 : 0.6}</scale>` +
            `<Icon><href>files/icones/${c.chave}.png</href></Icon></IconStyle><LabelStyle><scale>0.6</scale></LabelStyle></Style>`);
        } else if (c.linhas && !icones[c.chave]) {
          icones[c.chave] = null;
          estilos.push(`<Style id="${id}"><LineStyle><color>${corKml(c.cor)}</color><width>${c.chave === 'rede3' ? 3 : 2}</width></LineStyle></Style>`);
        }
        let corpo;
        if (c.linhas) {
          corpo = `<Placemark><name>${esc(c.rotulo)}</name><styleUrl>#${id}</styleUrl><MultiGeometry>` +
            c.linhas.map(l => `<LineString><tessellate>1</tessellate><coordinates>${l.map(p => xy(p[0], p[1])).join(' ')}</coordinates></LineString>`).join('') +
            '</MultiGeometry></Placemark>';
        } else if (c.postes) {
          corpo = `<Placemark><name>Postes</name><styleUrl>#${id}</styleUrl><MultiGeometry>` +
            c.postes.map(p => `<Point><coordinates>${xy(p[0], p[1])}</coordinates></Point>`).join('') + '</MultiGeometry></Placemark>';
        } else {
          corpo = c.pontos.map(it => `<Placemark><name>${esc(it.cod)}</name><styleUrl>#${id}</styleUrl>` +
            `<description>${cdata(`<b>${esc(it.titulo)}</b>${tabela(it.linhas)}`)}</description>` +
            dados([['Tipo', it.titulo]].concat(it.linhas)) +
            `<Point><coordinates>${xy(it.ll.lat, it.ll.lng)}</coordinates></Point></Placemark>`).join('');
        }
        const n = (c.linhas || c.postes || c.pontos).length;
        sub.push(`<Folder><name>${esc(c.rotulo)}${c.linhas ? '' : ` (${n})`}</name>${c.chave === 'postes' ? '<visibility>0</visibility>' : ''}${corpo}</Folder>`);
      }
      const nome = `Rede do alimentador ${d.nome || d.cod}${d.subNome ? ` - SE ${d.subNome}` : ''}`;
      pastas.push(`<Folder><name>${esc(nome)}</name><description>${esc(`${d.dist}. Fonte: ANEEL, BDGD (${d.fonte}).`)}</description>${sub.join('')}</Folder>`);
    }

    const titulo = `Inspeção - Alim. ${insp.alimentador}`;
    const desc = [insp.distribuidora ? insp.distribuidora.nome : '', `${regs.length} ${regs.length === 1 ? 'registro' : 'registros'}`,
      `Gerado em ${fmt(Date.now())}`].filter(Boolean).join(' · ');
    const kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
      `<name>${esc(titulo)}</name><description>${esc(desc)}</description><open>1</open>${estilos.join('')}${pastas.join('')}</Document></kml>`;

    // doc.kml precisa ser o primeiro arquivo do .kmz
    const zip = new JSZip();
    zip.file('doc.kml', kml);
    for (const [chave, p] of Object.entries(icones)) if (p) zip.file(`files/icones/${chave}.png`, await p);
    for (const [nome, blob] of fotos) zip.file(nome, blob);
    return zip.generateAsync({ type: 'blob', mimeType: TIPO, compression: 'DEFLATE' });
  }

  return { gerar, TIPO };
})();
