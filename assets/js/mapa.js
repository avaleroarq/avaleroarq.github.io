// Mapa de proyectos: lee assets/data/proyectos.csv y dibuja provincias, puntos, filtros y fichas.
// Depende de d3-geo, d3-composite-projections y topojson-client (assets/js/vendor).
(() => {
  const svg = document.getElementById('mapa');
  if (!svg || !window.d3 || !window.topojson) return;

  const NS = 'http://www.w3.org/2000/svg';
  const W = 800;
  const tip = document.getElementById('mapa-tip');
  const list = document.getElementById('proyectos-lista');
  const empty = document.getElementById('proyectos-vacio');
  const summary = document.getElementById('proyectos-resumen');
  const filters = [...document.querySelectorAll('.filter')];

  const CAT_LABEL = { edificacion: 'Edificación', reforma: 'Reforma', concurso: 'Concurso' };

  // ---------- Utilidades ----------
  const slug = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const toNum = (s) => { const n = parseFloat(String(s || '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const yes = (s) => ['si', 's', 'yes', 'true', '1', 'x'].includes(slug(s));
  const catOf = (s) => {
    const k = slug(s).replace(/s$/, '');
    return k.startsWith('edific') ? 'edificacion' : k.startsWith('reform') ? 'reforma' : k.startsWith('concurs') ? 'concurso' : null;
  };
  const SVG_TAGS = new Set(['path', 'circle', 'g', 'title']);
  const el = (tag, attrs = {}, text, svgNS = SVG_TAGS.has(tag)) => {
    const n = svgNS ? document.createElementNS(NS, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    return n;
  };

  // CSV con comillas; separador , o ; (Excel en español guarda con ;)
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.slice(0, text.indexOf('\n'));
    const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some((v) => v.trim() !== '')) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some((v) => v.trim() !== '')) rows.push(row);
    // Cabeceras normalizadas: «nº viviendas» → nviviendas, «protección» → proteccion…
    const head = rows.shift().map(slug);
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }

  function toProject(r, i) {
    return {
      id: i,
      nombre: r.nombre,
      descripcion: r.descripcion,
      cat: catOf(r.categoria),
      municipio: r.municipio,
      provincia: r.provincia,
      lat: toNum(r.latitud),
      lon: toNum(r.longitud),
      estudio: r.estudio,
      tipo: r.tipo,
      bim: r.bim,
      proteccion: r.proteccion || (yes(r.vpo) ? 'VPO' : ''),
      promotora: r.promotora,
      viviendas: toNum(r.nviviendas || r.viviendas),
      locales: toNum(r.locales),
    };
  }

  // ---------- Mapa ----------
  const ZMAX = 40;          // zoom máximo (separa los proyectos del centro de Madrid)
  const CLUSTER_PX = 22;    // puntos a menos de esto (en pantalla) se agrupan
  const LINE_MAX = 1;       // las líneas del mapa no engordan con el zoom: mismo grosor en pantalla

  function drawMap(topo, projects) {
    const provs = topojson.feature(topo, topo.objects.provinces).features;
    const all = { type: 'FeatureCollection', features: provs };
    const projection = d3.geoConicConformalSpain();
    projection.fitWidth ? projection.fitWidth(W, all) : projection.fitSize([W, W * 0.8], all);
    const path = d3.geoPath(projection);
    const b = path.bounds(all);
    const Y0 = Math.floor(b[0][1]) - 4, H = Math.ceil(b[1][1] - b[0][1]) + 8;
    svg.setAttribute('viewBox', `0 ${Y0} ${W} ${H}`);

    // Todo lo que se amplía va dentro de gZoom; las líneas no engordan (vector-effect en CSS)
    const gZoom = el('g', { class: 'zoom' });
    const gProv = el('g');
    const provEls = provs.map((f) => {
      const p = el('path', { class: 'prov', d: path(f) });
      p.appendChild(el('title', {}, f.properties.name));
      gProv.appendChild(p);
      return p;
    });
    gZoom.appendChild(gProv);
    gZoom.appendChild(el('path', { class: 'ccaa', d: path(topojson.mesh(topo, topo.objects.autonomous_regions, (a, z) => a !== z)) }));
    gZoom.appendChild(el('path', { class: 'border', d: path(topojson.mesh(topo, topo.objects.provinces, (a, z) => a === z)) }));
    if (projection.getCompositionBorders) gZoom.appendChild(el('path', { class: 'canarias', d: projection.getCompositionBorders() }));
    svg.appendChild(gZoom);

    // Provincia de cada proyecto, por posición (no depende de cómo se escriba el nombre)
    projects.forEach((p) => {
      if (p.lat == null || p.lon == null) return;
      p.prov = provs.findIndex((f) => d3.geoContains(f, [p.lon, p.lat]));
    });

    const gPts = el('g');
    const gClusters = el('g');
    projects.forEach((p) => {
      const xy = p.lat != null && p.lon != null ? projection([p.lon, p.lat]) : null;
      if (!xy) return;
      p.xy = xy;
      const c = el('circle', {
        class: `pt pt--${p.cat || 'edificacion'}`, tabindex: 0, role: 'button', 'aria-label': `${p.nombre}, ${p.municipio}`,
      });
      c.addEventListener('pointerenter', () => activate(p.id, true));
      c.addEventListener('pointerleave', () => activate(null));
      c.addEventListener('focus', () => activate(p.id, true));
      c.addEventListener('blur', () => activate(null));
      c.addEventListener('click', () => p.card && p.card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.dispatchEvent(new Event('click')); } });
      p.dot = c;
      gPts.appendChild(c);
    });
    gZoom.appendChild(gPts);
    gZoom.appendChild(gClusters);

    // ---- Zoom y desplazamiento ----
    const view = { z: 1, tx: 0, ty: 0 };
    const clamp = (v) => {
      v.z = Math.min(ZMAX, Math.max(1, v.z));
      v.tx = Math.min(0, Math.max(W * (1 - v.z), v.tx));
      v.ty = Math.min(Y0 * (1 - v.z), Math.max((Y0 + H) * (1 - v.z), v.ty));
      return v;
    };
    const apply = () => {
      gZoom.setAttribute('transform', `translate(${view.tx.toFixed(2)} ${view.ty.toFixed(2)}) scale(${view.z.toFixed(4)})`);
      gZoom.style.setProperty('--line-k', (Math.min(view.z, LINE_MAX) / view.z).toFixed(4));
      svg.parentElement.classList.toggle('is-zoomed', view.z > 1.01);
      tip.hidden = true;
      layout();
    };
    let anim = 0;
    // Centra el punto (x, y) del mapa con el zoom z, con una transición corta
    const zoomTo = (x, y, z) => {
      const zz = Math.min(ZMAX, Math.max(1, z));
      const to = clamp({ z: zz, tx: W / 2 - x * zz, ty: Y0 + H / 2 - y * zz });
      const from = { ...view }, t0 = performance.now(), dur = 350;
      cancelAnimationFrame(anim);
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        view.z = from.z + (to.z - from.z) * e; view.tx = from.tx + (to.tx - from.tx) * e; view.ty = from.ty + (to.ty - from.ty) * e;
        apply();
        if (k < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    };
    const centre = () => [(W / 2 - view.tx) / view.z, (Y0 + H / 2 - view.ty) / view.z];
    const unitsPerPx = () => W / (svg.clientWidth || W);
    // Coordenadas del mapa (sin zoom) bajo un punto de la pantalla
    const toMap = (clientX, clientY) => {
      const r = svg.getBoundingClientRect(), k = unitsPerPx();
      return [((clientX - r.left) * k - view.tx) / view.z, ((clientY - r.top) * k + Y0 - view.ty) / view.z];
    };

    // Botones
    const ctr = el('div', { class: 'pmap__zoom', role: 'group', 'aria-label': 'Zoom del mapa' }, null, false);
    const btn = (label, text, fn) => {
      const x = el('button', { type: 'button', 'aria-label': label, title: label }, text, false);
      x.addEventListener('click', fn); ctr.append(x);
    };
    btn('Acercar', '+', () => { const [x, y] = centre(); zoomTo(x, y, view.z * 2); });
    btn('Alejar', '−', () => { const [x, y] = centre(); zoomTo(x, y, view.z / 2); });
    btn('Ver toda España', '⤢', () => zoomTo(W / 2, Y0 + H / 2, 1));
    svg.parentElement.append(ctr);

    // Doble clic: acercar en ese punto
    svg.addEventListener('dblclick', (e) => { e.preventDefault(); const [x, y] = toMap(e.clientX, e.clientY); zoomTo(x, y, view.z * 2); });

    // Arrastrar para desplazarse (solo con zoom)
    let drag = null;
    svg.addEventListener('pointerdown', (e) => {
      if (view.z <= 1.01 || e.target.closest('.pt, .cluster')) return;
      drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, id: e.pointerId };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const k = unitsPerPx();
      view.tx = drag.tx + (e.clientX - drag.x) * k; view.ty = drag.ty + (e.clientY - drag.y) * k;
      clamp(view); apply();
    });
    const endDrag = () => { drag = null; };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    // Rueda: zoom en el cursor. En los límites (España entera / zoom máximo) la página sigue desplazándose
    svg.addEventListener('wheel', (e) => {
      const zoomIn = e.deltaY < 0;
      if ((!zoomIn && view.z <= 1.001) || (zoomIn && view.z >= ZMAX - 0.001)) return;
      e.preventDefault();
      const [x, y] = toMap(e.clientX, e.clientY);
      const z = Math.min(ZMAX, Math.max(1, view.z * Math.pow(1.0025, -e.deltaY)));   // ~×1.28 por clic de rueda
      const r = svg.getBoundingClientRect(), k = unitsPerPx();
      view.tx = (e.clientX - r.left) * k - x * z; view.ty = (e.clientY - r.top) * k + Y0 - y * z; view.z = z;
      clamp(view); apply();
    }, { passive: false });

    // ---- Agrupación de puntos ----
    // Con el zoom actual, los puntos cercanos se juntan en un círculo con el número de proyectos.
    // Al pulsarlo, el mapa se acerca a ellos. Si comparten ubicación exacta, se reparten en corro.
    function layout() {
      const s = view.z / unitsPerPx();                 // píxeles de pantalla por unidad del mapa
      const r = 7 / s;                                  // radio de punto ≈ 7 px en pantalla
      gPts.style.strokeWidth = (2 / s).toFixed(3);
      gClusters.style.strokeWidth = (2 / s).toFixed(3);
      const pts = projects.filter((p) => p.dot && p.visible);
      projects.forEach((p) => { if (p.dot) p.dot.style.display = 'none'; p.cluster = null; });
      const groups = [];
      pts.forEach((p) => {
        const g = groups.find((g) => Math.hypot(g.x - p.xy[0], g.y - p.xy[1]) * s < CLUSTER_PX);
        if (g) { g.items.push(p); const n = g.items.length; g.x += (p.xy[0] - g.x) / n; g.y += (p.xy[1] - g.y) / n; }
        else groups.push({ x: p.xy[0], y: p.xy[1], items: [p] });
      });
      gClusters.replaceChildren();
      groups.forEach((g) => {
        const n = g.items.length;
        const spread = Math.max(...g.items.map((p) => Math.hypot(p.xy[0] - g.x, p.xy[1] - g.y)));
        const sameSpot = spread * s < 3;
        if (n === 1 || (sameSpot && view.z >= 4) || view.z >= ZMAX - 0.01) {
          const R = n === 1 ? 0 : Math.max(r * 1.4, (n * r * 2.4) / (2 * Math.PI));
          g.items.forEach((p, i) => {
            const a = (2 * Math.PI * i) / n - Math.PI / 2;
            p.dot.setAttribute('cx', (g.x + R * Math.cos(a)).toFixed(3));
            p.dot.setAttribute('cy', (g.y + R * Math.sin(a)).toFixed(3));
            p.dot.setAttribute('r', r.toFixed(3));
            p.dot.style.display = '';
          });
          return;
        }
        // Grupo: un solo círculo con el número
        const cats = new Set(g.items.map((p) => p.cat || 'edificacion'));
        const cl = el('g', {
          class: `cluster ${cats.size === 1 ? `cluster--${[...cats][0]}` : 'cluster--mix'}`, tabindex: 0, role: 'button',
          'aria-label': `${n} proyectos en ${g.items[0].municipio}. Acercar`,
        });
        const rc = (12 + Math.min(n, 10)) / s;
        cl.append(el('circle', { cx: g.x.toFixed(3), cy: g.y.toFixed(3), r: rc.toFixed(3) }));
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', g.x.toFixed(3)); t.setAttribute('y', g.y.toFixed(3));
        t.setAttribute('font-size', (14 / s).toFixed(3));
        t.setAttribute('fill', '#fff');   // por si la hoja de estilos aún no ha cargado
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('dy', '0.39em');   // centra verticalmente las cifras de Inter (alto ≈ 0.78em)
        t.textContent = n;
        cl.append(t);
        const go = () => {
          const xs = g.items.map((p) => p.xy[0]), ys = g.items.map((p) => p.xy[1]);
          const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
          const fit = Math.min(w ? W / (w * 3) : ZMAX, h ? H / (h * 3) : ZMAX);
          tip.hidden = true;
          zoomTo((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2, Math.max(view.z * 2.5, fit));
        };
        cl.addEventListener('click', go);
        cl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        // Desglose por tipo, p. ej. «8 reformas · 2 edificación · 1 concurso»
        const PLURAL = { edificacion: ['edificación', 'edificación'], reforma: ['reforma', 'reformas'], concurso: ['concurso', 'concursos'] };
        const detail = ['edificacion', 'reforma', 'concurso']
          .map((c) => [c, g.items.filter((p) => (p.cat || 'edificacion') === c).length])
          .filter(([, k]) => k).map(([c, k]) => `${k} ${PLURAL[c][k === 1 ? 0 : 1]}`).join(' · ');
        cl.setAttribute('aria-label', `${n} proyectos: ${detail}. Acercar`);
        cl.addEventListener('pointerenter', () => showTip(cl, `${n} proyectos · ${detail}`, 'Pulsa para acercar'));
        cl.addEventListener('focus', () => showTip(cl, `${n} proyectos · ${detail}`, 'Pulsa para acercar'));
        cl.addEventListener('blur', () => { tip.hidden = true; });
        cl.addEventListener('pointerleave', () => { tip.hidden = true; });
        g.items.forEach((p) => { p.cluster = cl; });
        gClusters.append(cl);
      });
    }
    layoutDots = layout;
    window.addEventListener('resize', layout);
    apply();
    return provEls;
  }

  // ---------- Fichas ----------
  function drawCards(projects) {
    projects.forEach((p) => {
      const li = el('li', { class: 'pcard' });
      const cat = el('span', { class: 'pcard__cat' });
      cat.append(el('span', { class: `dot dot--${p.cat || 'edificacion'}`, 'aria-hidden': 'true' }), CAT_LABEL[p.cat] || 'Sin categoría');
      li.append(cat, el('h3', { class: 'pcard__title' }, p.nombre));
      const place = p.provincia && slug(p.provincia) !== slug(p.municipio) ? `${p.municipio} · ${p.provincia}` : p.municipio;
      if (place) li.append(el('p', { class: 'pcard__place' }, place));
      if (p.descripcion) li.append(el('p', { class: 'pcard__desc' }, p.descripcion));

      const tags = el('ul', { class: 'tags', 'aria-label': 'Etiquetas' });
      const tag = (label, value) => {
        if (!value) return;
        const t = el('li');
        if (label) t.append(el('span', {}, `${label} `));
        t.append(value);
        tags.append(t);
      };
      tag('Estudio', p.estudio);
      tag('Tipo', p.tipo);
      tag('Viviendas', p.viviendas ? String(p.viviendas) : '');
      tag('Locales', p.locales ? String(p.locales) : '');
      if (p.bim) tag('', yes(p.bim) ? 'BIM' : 'Sin BIM');
      tag('Protección', p.proteccion);
      tag('Promotora', p.promotora);
      if (tags.children.length) li.append(tags);

      li.addEventListener('pointerenter', () => activate(p.id));
      li.addEventListener('pointerleave', () => activate(null));
      p.card = li;
      list.append(li);
    });
  }

  // ---------- Estado ----------
  let projects = [], provEls = [], layoutDots = () => {};

  // Tooltip sobre un elemento del mapa (punto o grupo)
  function showTip(target, title, sub) {
    const box = svg.parentElement.getBoundingClientRect(), r = target.getBoundingClientRect();
    tip.replaceChildren(document.createTextNode(title), el('small', {}, sub));
    tip.style.left = `${r.left + r.width / 2 - box.left}px`;
    tip.style.top = `${r.top - box.top}px`;
    tip.hidden = false;
  }

  function activate(id, withTip) {
    projects.forEach((p) => {
      const on = p.id === id;
      p.card && p.card.classList.toggle('is-active', on);
      p.dot && p.dot.classList.toggle('is-active', on);
    });
    document.querySelectorAll('.cluster.is-active').forEach((c) => c.classList.remove('is-active'));
    const p = projects.find((x) => x.id === id);
    if (p && p.cluster) p.cluster.classList.add('is-active');   // su punto está dentro de un grupo
    if (!p || !withTip || !p.dot || p.dot.style.display === 'none') { tip.hidden = true; return; }
    showTip(p.dot, p.nombre, p.municipio);
  }

  // ---------- Filtros ----------
  // Cada filtro guarda los valores marcados; un proyecto se ve si cumple todos.
  // «Categoría» es el mismo filtro que los botones de colores del mapa.
  const BIM_LABEL = (v) => (v ? (yes(v) ? 'Sí' : 'No') : 'Sin dato');
  const FILTERS = [
    { key: 'cat', label: 'Categoría', value: (p) => p.cat || 'edificacion', text: (v) => CAT_LABEL[v] || v },
    { key: 'estudio', label: 'Estudio', value: (p) => p.estudio || 'Sin dato' },
    { key: 'promotora', label: 'Promotora', value: (p) => p.promotora || 'Sin dato' },
    { key: 'tipo', label: 'Tipo', value: (p) => p.tipo || 'Sin dato' },
    { key: 'bim', label: 'BIM', value: (p) => BIM_LABEL(p.bim) },
    { key: 'proteccion', label: 'Protección', value: (p) => p.proteccion || 'Vivienda libre' },
  ];
  const sel = {};          // key → Set de valores marcados
  const dds = [];          // desplegables (para sincronizarlos)

  const passes = (p) => FILTERS.every((f) => sel[f.key].has(f.value(p)));

  function update() {
    const visible = projects.filter(passes);
    const hl = new Set(visible.map((p) => p.prov).filter((i) => i >= 0));
    provEls.forEach((e, i) => e.classList.toggle('is-hl', hl.has(i)));
    projects.forEach((p) => {
      p.visible = visible.includes(p);
      if (p.card) p.card.hidden = !p.visible;
    });
    empty.hidden = visible.length > 0;
    if (resultCount) resultCount.textContent = visible.length === projects.length
      ? `${projects.length} proyectos` : `${visible.length} de ${projects.length} proyectos`;
    if (clearBtn) clearBtn.hidden = FILTERS.every((f) => sel[f.key].size === f.options.length);
    // Botones de colores del mapa = filtro Categoría
    filters.forEach((b) => b.setAttribute('aria-pressed', String(sel.cat.has(b.dataset.cat))));
    dds.forEach((d) => d.sync());
    layoutDots();
  }

  filters.forEach((b) => b.addEventListener('click', () => {
    const c = b.dataset.cat;
    sel.cat.has(c) ? sel.cat.delete(c) : sel.cat.add(c);
    activate(null);
    update();
  }));

  let resultCount = null, clearBtn = null;
  function drawFilters() {
    const bar = document.getElementById('proyectos-filtros');
    if (!bar) return;
    FILTERS.forEach((f) => {
      // Opciones: valores presentes en los datos, ordenados por número de proyectos
      const counts = new Map();
      projects.forEach((p) => counts.set(f.value(p), (counts.get(f.value(p)) || 0) + 1));
      f.options = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'es'));
      if (f.key === 'cat') {
        // Siempre las tres categorías, aunque alguna tenga 0
        f.options = ['edificacion', 'reforma', 'concurso'].map((c) => [c, counts.get(c) || 0]);
      }
      sel[f.key] = new Set(f.options.map(([v]) => v));

      const wrap = el('div', { class: 'dd' });
      const btn = el('button', { class: 'dd__btn', type: 'button', 'aria-expanded': 'false', 'aria-haspopup': 'true' });
      const btnLabel = el('span', {}, f.label);
      const btnState = el('span', { class: 'dd__state' });
      btn.append(btnLabel, btnState, el('span', { class: 'dd__arrow', 'aria-hidden': 'true' }));
      const panel = el('div', { class: 'dd__panel', role: 'group', 'aria-label': f.label });
      panel.hidden = true;

      const boxes = f.options.map(([v, n]) => {
        const lab = el('label', { class: 'dd__opt' });
        const cb = el('input', { type: 'checkbox' });
        cb.checked = true;
        cb.addEventListener('change', () => { cb.checked ? sel[f.key].add(v) : sel[f.key].delete(v); activate(null); update(); });
        const name = el('span', {}, f.text ? f.text(v) : v);
        if (f.key === 'cat') name.prepend(el('span', { class: `dot dot--${v}`, 'aria-hidden': 'true' }));
        lab.append(cb, name, el('span', { class: 'dd__n' }, String(n)));
        panel.append(lab);
        return [v, cb];
      });
      const acts = el('div', { class: 'dd__actions' });
      const all = el('button', { type: 'button' }, 'Todos');
      const none = el('button', { type: 'button' }, 'Ninguno');
      all.addEventListener('click', () => { f.options.forEach(([v]) => sel[f.key].add(v)); update(); });
      none.addEventListener('click', () => { sel[f.key].clear(); update(); });
      acts.append(all, none);
      panel.append(acts);

      const open = (on) => {
        dds.forEach((d) => d !== api && d.close());
        panel.hidden = !on; btn.setAttribute('aria-expanded', String(on)); wrap.classList.toggle('is-open', on);
      };
      btn.addEventListener('click', () => open(panel.hidden));
      const api = {
        close: () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); wrap.classList.remove('is-open'); },
        // Refleja la selección: casillas marcadas y resumen en el botón
        sync: () => {
          boxes.forEach(([v, cb]) => { cb.checked = sel[f.key].has(v); });
          const k = sel[f.key].size, total = f.options.length;
          btnState.textContent = k === total ? '' : k === 0 ? '· ninguno' : k === 1 ? `· ${f.text ? f.text([...sel[f.key]][0]) : [...sel[f.key]][0]}` : `· ${k}`;
          wrap.classList.toggle('is-filtered', k !== total);
        },
      };
      dds.push(api);
      wrap.append(btn, panel);
      bar.append(wrap);
    });

    clearBtn = el('button', { class: 'pfilters__clear', type: 'button' }, 'Quitar filtros');
    clearBtn.addEventListener('click', () => { FILTERS.forEach((f) => f.options.forEach(([v]) => sel[f.key].add(v))); update(); });
    resultCount = el('span', { class: 'pfilters__count', 'aria-live': 'polite' });
    bar.append(clearBtn, resultCount);

    // Cerrar al pulsar fuera o con Esc
    document.addEventListener('click', (e) => { if (!e.target.closest('.dd')) dds.forEach((d) => d.close()); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dds.forEach((d) => d.close()); });
  }

  Promise.all([
    fetch('assets/data/es-provincias.json').then((r) => r.json()),
    fetch('assets/data/proyectos.csv').then((r) => r.text()),
  ]).then(([topo, csv]) => {
    projects = parseCSV(csv).filter((r) => r.nombre).map(toProject);
    // Orden de las fichas: Edificación → Reformas → Concursos y, dentro de cada una, alfabético
    const ORDER = { edificacion: 0, reforma: 1, concurso: 2 };
    projects.sort((x, y) => (ORDER[x.cat || 'edificacion'] - ORDER[y.cat || 'edificacion'])
      || x.nombre.localeCompare(y.nombre, 'es', { sensitivity: 'base' }));
    projects.filter((p) => p.lat == null).forEach((p) => console.warn(`Proyecto sin coordenadas: ${p.nombre}`));

    filters.forEach((f) => {
      f.querySelector('.filter__n').textContent = projects.filter((p) => (p.cat || 'edificacion') === f.dataset.cat).length;
    });
    const sum = (k) => projects.reduce((s, p) => s + (p[k] || 0), 0);
    const nProv = new Set(projects.map((p) => slug(p.provincia)).filter(Boolean)).size;
    const parts = [`${projects.length} proyectos`, `${sum('viviendas').toLocaleString('es-ES')} viviendas`];
    if (sum('locales')) parts.push(`${sum('locales')} ${sum('locales') === 1 ? 'local' : 'locales'}`);
    parts.push(`${nProv} provincias`);
    summary.textContent = `${parts.join(' · ')}.`;

    provEls = drawMap(topo, projects);
    drawCards(projects);
    drawFilters();
    update();
  }).catch((err) => {
    console.error(err);
    empty.textContent = 'No se ha podido cargar el mapa de proyectos.';
    empty.hidden = false;
  });
})();
