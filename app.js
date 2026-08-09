/* ============================================================
   Calculadora Nutricional — app.js
   Sem framework, sem build. Toda a base TACO é carregada de
   data/taco.json em tempo de execução (ver README: "Expandindo a base").
   ============================================================ */

'use strict';

const CHAVE_STORAGE = 'calc-nutri:receita:v1';
const MAX_SUGESTOES = 10;

/* Nutrientes na ordem em que aparecem no rótulo.
   `recuo`   → sub-item indentado (padrão ANVISA)
   `vd`      → chave em valoresDiarios; null = nutriente sem %VD definido */
const NUTRIENTES = [
  { chave: 'kcal',              rotulo: 'Valor energético',   unidade: 'kcal', casas: 0, vd: 'kcal',              destaque: true },
  { chave: 'carboidratos',      rotulo: 'Carboidratos totais', unidade: 'g',   casas: 1, vd: 'carboidratos' },
  { chave: 'acucares',          rotulo: 'Açúcares totais',     unidade: 'g',   casas: 1, vd: null, recuo: true },
  { chave: 'proteinas',         rotulo: 'Proteínas',           unidade: 'g',   casas: 1, vd: 'proteinas' },
  { chave: 'gordurasTotais',    rotulo: 'Gorduras totais',     unidade: 'g',   casas: 1, vd: 'gordurasTotais' },
  { chave: 'gordurasSaturadas', rotulo: 'Gorduras saturadas',  unidade: 'g',   casas: 1, vd: 'gordurasSaturadas', recuo: true },
  { chave: 'fibras',            rotulo: 'Fibra alimentar',     unidade: 'g',   casas: 1, vd: 'fibras' },
  { chave: 'sodio',             rotulo: 'Sódio',               unidade: 'mg',  casas: 0, vd: 'sodio' }
];

/* ───────────── Estado ───────────── */

const estado = {
  base: [],            // alimentos carregados do JSON
  porId: new Map(),
  vd: {},
  nomeReceita: '',
  ingredientes: [],    // { uid, foodId, gramas, medida: {nome, gramas}|null }
  porcoes: 1,
  selecionado: null,   // alimento escolhido no autocomplete, aguardando quantidade
  indiceSugestao: -1,
  sugestoesAtuais: []
};

let proximoUid = 1;

/* ───────────── Atalhos de DOM ───────────── */

const $ = (sel) => document.querySelector(sel);

const el = {
  busca: $('#busca'),
  limparBusca: $('#btn-limpar-busca'),
  combo: $('.combo'),
  sugestoes: $('#sugestoes'),
  painel: $('#painel-qtd'),
  painelNome: $('#painel-qtd-nome'),
  painelValor: $('#painel-qtd-valor'),
  painelSufixo: $('#painel-qtd-sufixo'),
  painelMedida: $('#painel-qtd-medida'),
  painelEquiv: $('#painel-qtd-equiv'),
  painelAdd: $('#painel-qtd-add'),
  painelCancelar: $('#painel-qtd-cancelar'),
  lista: $('#lista-ingredientes'),
  vazio: $('#vazio-ingredientes'),
  contador: $('#contador-ingredientes'),
  limparTudo: $('#btn-limpar-tudo'),
  resumoPeso: $('#resumo-peso'),
  pesoTotal: $('#peso-total'),
  nomeReceita: $('#nome-receita'),
  porcoes: $('#num-porcoes'),
  porcoesUnid: $('#porcoes-unid'),
  porcoesHint: $('#porcoes-hint'),
  rotuloPorcao: $('#rotulo-porcao'),
  thPorcaoG: $('#th-porcao-g'),
  rotuloCorpo: $('#rotulo-corpo'),
  notaAcucares: $('#nota-acucares'),
  qtdAlimentos: $('#qtd-alimentos'),
  toast: $('#toast'),
  btnInstalar: $('#btn-instalar'),
  btnCopiar: $('#btn-copiar'),
  btnImprimir: $('#btn-imprimir')
};

/* ───────────── Utilidades ───────────── */

/** Remove acentos e caixa para busca tolerante ("acucar" acha "Açúcar"). */
function normalizar(txt) {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // tira os diacríticos do NFD
    .replace(/\s+/g, ' ');
}

/** Aceita "1,5" e "1.5"; devolve número finito >= 0. */
function paraNumero(valor) {
  const n = parseFloat(String(valor).replace(',', '.').replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(n, 100000);
}

function formatar(n, casas) {
  const v = Number(n) || 0;
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Gramas: sem casas decimais acima de 10 g, uma casa abaixo disso. */
function formatarGramas(g) {
  return g >= 10 || g === 0 ? formatar(Math.round(g), 0) : formatar(g, 1);
}

function escaparHtml(txt) {
  return String(txt).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let timerToast;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('visivel');
  clearTimeout(timerToast);
  timerToast = setTimeout(() => el.toast.classList.remove('visivel'), 2400);
}

/* ───────────── Carregamento da base ───────────── */

async function carregarBase() {
  const resp = await fetch('data/taco.json', { cache: 'no-cache' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const dados = await resp.json();

  estado.base = dados.alimentos || [];
  estado.vd = dados.valoresDiarios || {};
  estado.porId = new Map(estado.base.map((a) => [a.id, a]));

  // Índice de busca pré-calculado (nome + categoria sem acento).
  estado.base.forEach((a) => {
    a._busca = normalizar(a.nome + ' ' + a.categoria);
    a._palavras = a._busca.split(/[\s,()\-—/]+/).filter(Boolean);
  });

  el.qtdAlimentos.textContent = estado.base.length;
}

/* ───────────── Busca / autocomplete ───────────── */

function buscar(termo) {
  const q = normalizar(termo).trim();
  if (q.length < 1) return [];

  const termos = q.split(/\s+/).filter(Boolean);
  const achados = [];

  for (const alimento of estado.base) {
    // Todos os termos digitados precisam aparecer no alimento (busca "E").
    if (!termos.every((t) => alimento._busca.includes(t))) continue;

    // Pontuação: começo do nome > começo de alguma palavra > qualquer posição.
    const primeiro = termos[0];
    let pontos = 2;
    if (alimento._busca.startsWith(primeiro)) pontos = 0;
    else if (alimento._palavras.some((p) => p.startsWith(primeiro))) pontos = 1;

    achados.push({ alimento, pontos });
  }

  achados.sort((a, b) => a.pontos - b.pontos || a.alimento.nome.localeCompare(b.alimento.nome, 'pt-BR'));
  return achados.slice(0, MAX_SUGESTOES).map((r) => r.alimento);
}

/** Envolve em <mark> a primeira ocorrência do termo, ignorando acentos. */
function destacar(nome, termo) {
  const q = normalizar(termo).trim().split(/\s+/)[0];
  if (!q) return escaparHtml(nome);
  const i = normalizar(nome).indexOf(q);
  if (i < 0) return escaparHtml(nome);
  return escaparHtml(nome.slice(0, i)) +
         '<mark>' + escaparHtml(nome.slice(i, i + q.length)) + '</mark>' +
         escaparHtml(nome.slice(i + q.length));
}

function renderSugestoes(lista, termo) {
  estado.sugestoesAtuais = lista;
  estado.indiceSugestao = -1;

  if (!termo.trim()) {
    fecharSugestoes();
    return;
  }

  if (lista.length === 0) {
    el.sugestoes.innerHTML = '<li class="sugestoes-vazio">Nenhum alimento encontrado para “' +
      escaparHtml(termo) + '”.</li>';
  } else {
    el.sugestoes.innerHTML = lista.map((a, i) => `
      <li class="sugestao" role="option" id="sug-${i}" data-idx="${i}" aria-selected="false">
        <span class="sugestao-nome">${destacar(a.nome, termo)}
          <span class="sugestao-cat">${escaparHtml(a.categoria)}</span>
        </span>
        <span class="sugestao-kcal">${formatar(a.por100g.kcal, 0)} kcal<br>/100 g</span>
      </li>`).join('');
  }

  el.sugestoes.hidden = false;
  el.combo.setAttribute('aria-expanded', 'true');
}

function fecharSugestoes() {
  el.sugestoes.hidden = true;
  el.sugestoes.innerHTML = '';
  el.combo.setAttribute('aria-expanded', 'false');
  el.busca.removeAttribute('aria-activedescendant');
  estado.indiceSugestao = -1;
  estado.sugestoesAtuais = [];
}

function moverSelecao(delta) {
  const total = estado.sugestoesAtuais.length;
  if (!total) return;

  estado.indiceSugestao = (estado.indiceSugestao + delta + total) % total;

  el.sugestoes.querySelectorAll('.sugestao').forEach((li, i) => {
    const ativo = i === estado.indiceSugestao;
    li.setAttribute('aria-selected', ativo ? 'true' : 'false');
    if (ativo) {
      li.scrollIntoView({ block: 'nearest' });
      el.busca.setAttribute('aria-activedescendant', li.id);
    }
  });
}

/* ───────────── Painel de quantidade ───────────── */

function selecionarAlimento(alimento) {
  estado.selecionado = alimento;
  fecharSugestoes();

  el.painelNome.textContent = alimento.nome;
  el.painel.hidden = false;

  // Opções de medida: gramas + medidas caseiras do alimento, quando houver.
  const medidas = alimento.medidas || [];
  el.painelMedida.innerHTML =
    '<option value="g">gramas (g)</option>' +
    medidas.map((m, i) =>
      `<option value="${i}">${escaparHtml(m.nome)} (${formatarGramas(m.gramas)} g)</option>`
    ).join('');
  el.painelMedida.value = 'g';
  el.painelMedida.hidden = medidas.length === 0;

  el.painelValor.value = '100';
  el.painelSufixo.textContent = 'g';
  atualizarEquivalencia();

  el.painelValor.focus();
  el.painelValor.select();
}

function medidaAtual() {
  const v = el.painelMedida.value;
  if (v === 'g' || !estado.selecionado) return null;
  return (estado.selecionado.medidas || [])[Number(v)] || null;
}

function gramasDoPainel() {
  const valor = paraNumero(el.painelValor.value);
  const medida = medidaAtual();
  return medida ? valor * medida.gramas : valor;
}

function atualizarEquivalencia() {
  const alimento = estado.selecionado;
  if (!alimento) return;

  const gramas = gramasDoPainel();
  const medida = medidaAtual();

  el.painelSufixo.textContent = medida ? '×' : 'g';

  if (gramas <= 0) {
    el.painelEquiv.textContent = '';
    return;
  }

  const kcal = (alimento.por100g.kcal * gramas) / 100;
  const prefixo = medida ? `= ${formatarGramas(gramas)} g · ` : '';
  el.painelEquiv.textContent = `${prefixo}${formatar(Math.round(kcal), 0)} kcal`;
}

function fecharPainel() {
  el.painel.hidden = true;
  estado.selecionado = null;
}

function adicionarSelecionado() {
  const alimento = estado.selecionado;
  if (!alimento) return;

  const gramas = gramasDoPainel();
  if (gramas <= 0) {
    toast('Informe uma quantidade maior que zero.');
    el.painelValor.focus();
    return;
  }

  const medida = medidaAtual();
  estado.ingredientes.push({
    uid: proximoUid++,
    foodId: alimento.id,
    gramas,
    medida: medida ? { nome: medida.nome, gramas: medida.gramas } : null
  });

  fecharPainel();
  el.busca.value = '';
  el.limparBusca.hidden = true;
  atualizarTudo();
  toast(`${alimento.nome} adicionado.`);
  el.busca.focus();
}

/* ───────────── Cálculo ───────────── */

/** Soma proporcional de todos os ingredientes. Devolve totais absolutos. */
function calcularTotais() {
  const totais = {};
  NUTRIENTES.forEach((n) => { totais[n.chave] = 0; });
  let pesoTotal = 0;

  for (const item of estado.ingredientes) {
    const alimento = estado.porId.get(item.foodId);
    if (!alimento) continue;

    const fator = item.gramas / 100;
    pesoTotal += item.gramas;

    for (const n of NUTRIENTES) {
      totais[n.chave] += (alimento.por100g[n.chave] || 0) * fator;
    }
  }

  return { totais, pesoTotal };
}

function kcalDoIngrediente(item) {
  const alimento = estado.porId.get(item.foodId);
  if (!alimento) return 0;
  return (alimento.por100g.kcal * item.gramas) / 100;
}

/* ───────────── Renderização: lista de ingredientes ───────────── */

function renderIngredientes() {
  const n = estado.ingredientes.length;
  el.contador.textContent = n;
  el.vazio.hidden = n > 0;
  el.limparTudo.hidden = n === 0;
  el.resumoPeso.hidden = n === 0;

  el.lista.innerHTML = estado.ingredientes.map((item) => {
    const alimento = estado.porId.get(item.foodId);
    if (!alimento) return '';

    const kcal = kcalDoIngrediente(item);
    let meta = `${formatar(Math.round(kcal), 0)} kcal`;

    // Se o ingrediente foi adicionado por medida caseira, mostra o equivalente
    // recalculado a partir das gramas atuais (o usuário pode ter editado).
    if (item.medida && item.medida.gramas > 0) {
      const qtdMedidas = item.gramas / item.medida.gramas;
      const arred = Math.round(qtdMedidas * 10) / 10;
      meta = `≈ ${formatar(arred, arred % 1 === 0 ? 0 : 1)} ${item.medida.nome.toLowerCase()} · ${meta}`;
    }

    return `
      <li class="ingrediente" data-uid="${item.uid}">
        <div class="ing-info">
          <div class="ing-nome">${escaparHtml(alimento.nome)}</div>
          <div class="ing-meta">${escaparHtml(meta)}</div>
        </div>
        <div class="ing-qtd">
          <input type="text" inputmode="decimal" value="${formatarGramas(item.gramas)}"
                 data-uid="${item.uid}" aria-label="Quantidade em gramas de ${escaparHtml(alimento.nome)}">
          <span>g</span>
        </div>
        <button class="ing-remover" type="button" data-uid="${item.uid}"
                aria-label="Remover ${escaparHtml(alimento.nome)}">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="M5 5l14 14M19 5L5 19"/>
          </svg>
        </button>
      </li>`;
  }).join('');
}

/* ───────────── Renderização: rótulo ───────────── */

function renderRotulo() {
  const { totais, pesoTotal } = calcularTotais();
  const porcoes = Math.max(1, Math.round(paraNumero(el.porcoes.value) || 1));
  const pesoPorcao = pesoTotal / porcoes;

  // Peso total e resumo de porções
  el.pesoTotal.textContent = `${formatarGramas(pesoTotal)} g`;
  el.porcoesUnid.textContent = porcoes === 1 ? 'porção' : 'porções';
  el.porcoesHint.innerHTML = `Cada porção: <strong>${formatarGramas(pesoPorcao)} g</strong>`;
  el.rotuloPorcao.textContent =
    `Porções por receita: ${porcoes} ${porcoes === 1 ? 'porção' : 'porções'} de ${formatarGramas(pesoPorcao)} g`;
  el.thPorcaoG.textContent = `(${formatarGramas(pesoPorcao)} g)`;

  // Base "por 100 g" da receita pronta: totais divididos pelo peso total.
  const fator100 = pesoTotal > 0 ? 100 / pesoTotal : 0;

  el.rotuloCorpo.innerHTML = NUTRIENTES.map((n) => {
    const totalNutriente = totais[n.chave];
    const por100 = totalNutriente * fator100;
    const porPorcao = totalNutriente / porcoes;

    const vdRef = n.vd ? estado.vd[n.vd] : null;
    const pctVd = vdRef ? Math.round((porPorcao / vdRef) * 100) : null;

    const classes = [];
    if (n.destaque) classes.push('linha-destaque');
    if (pctVd === null) classes.push('sem-vd');

    const marcaEstimado = n.chave === 'acucares' ? '<sup>†</sup>' : '';

    return `
      <tr class="${classes.join(' ')}">
        <td class="c-nome${n.recuo ? ' recuo' : ''}">${n.rotulo}${marcaEstimado}</td>
        <td class="c-num">${formatar(por100, n.casas)} ${n.unidade}</td>
        <td class="c-num">${formatar(porPorcao, n.casas)} ${n.unidade}</td>
        <td class="c-num">${pctVd === null ? '—' : pctVd + '%'}</td>
      </tr>`;
  }).join('');

  // A nota do † só faz sentido se algum ingrediente tiver açúcar estimado.
  const temEstimado = estado.ingredientes.some((i) => {
    const a = estado.porId.get(i.foodId);
    return a && a.acucaresEstimado;
  });
  el.notaAcucares.hidden = !temEstimado;
}

function atualizarTudo() {
  renderIngredientes();
  renderRotulo();
  salvar();
}

/* ───────────── Persistência (localStorage) ───────────── */

function salvar() {
  try {
    localStorage.setItem(CHAVE_STORAGE, JSON.stringify({
      nome: estado.nomeReceita,
      porcoes: Math.max(1, Math.round(paraNumero(el.porcoes.value) || 1)),
      itens: estado.ingredientes.map((i) => ({
        foodId: i.foodId,
        gramas: i.gramas,
        medida: i.medida
      }))
    }));
  } catch (e) {
    // Modo privado / cota cheia: seguir sem persistir.
  }
}

function restaurar() {
  let dados;
  try {
    dados = JSON.parse(localStorage.getItem(CHAVE_STORAGE) || 'null');
  } catch (e) {
    return;
  }
  if (!dados || !Array.isArray(dados.itens)) return;

  let descartados = 0;
  estado.ingredientes = dados.itens.reduce((acc, i) => {
    // Um alimento pode ter sumido da base entre versões — ignora em vez de quebrar.
    if (!estado.porId.has(i.foodId)) { descartados++; return acc; }
    acc.push({
      uid: proximoUid++,
      foodId: i.foodId,
      gramas: paraNumero(i.gramas),
      medida: i.medida || null
    });
    return acc;
  }, []);

  estado.nomeReceita = dados.nome || '';
  el.nomeReceita.value = estado.nomeReceita;
  el.porcoes.value = Math.max(1, Math.round(paraNumero(dados.porcoes) || 1));

  if (descartados > 0) {
    toast(`${descartados} ingrediente(s) não existem mais na base e foram removidos.`);
  }
}

/* ───────────── Exportar como texto ───────────── */

function rotuloComoTexto() {
  const { totais, pesoTotal } = calcularTotais();
  const porcoes = Math.max(1, Math.round(paraNumero(el.porcoes.value) || 1));
  const fator100 = pesoTotal > 0 ? 100 / pesoTotal : 0;

  const linhas = [];
  linhas.push(estado.nomeReceita || 'Receita sem nome');
  linhas.push('='.repeat(40));
  linhas.push(`Peso total: ${formatarGramas(pesoTotal)} g`);
  linhas.push(`Rende: ${porcoes} porção(ões) de ${formatarGramas(pesoTotal / porcoes)} g`);
  linhas.push('');
  linhas.push('INGREDIENTES');
  estado.ingredientes.forEach((i) => {
    const a = estado.porId.get(i.foodId);
    if (a) linhas.push(`- ${a.nome}: ${formatarGramas(i.gramas)} g`);
  });
  linhas.push('');
  linhas.push('INFORMAÇÃO NUTRICIONAL');
  linhas.push('Nutriente'.padEnd(24) + '100 g'.padStart(11) + 'Porção'.padStart(11) + '%VD'.padStart(6));

  NUTRIENTES.forEach((n) => {
    const porPorcao = totais[n.chave] / porcoes;
    const por100 = totais[n.chave] * fator100;
    const vdRef = n.vd ? estado.vd[n.vd] : null;
    const pct = vdRef ? Math.round((porPorcao / vdRef) * 100) + '%' : '—';
    linhas.push(
      n.rotulo.padEnd(24) +
      `${formatar(por100, n.casas)} ${n.unidade}`.padStart(11) +
      `${formatar(porPorcao, n.casas)} ${n.unidade}`.padStart(11) +
      pct.padStart(6)
    );
  });

  linhas.push('');
  linhas.push('*%VD com base em dieta de 2.000 kcal (RDC 429/2020).');
  linhas.push('Fonte: Tabela TACO — NEPA/UNICAMP, 4a ed.');
  return linhas.join('\n');
}

async function copiarRotulo() {
  if (estado.ingredientes.length === 0) {
    toast('Adicione ingredientes primeiro.');
    return;
  }
  const texto = rotuloComoTexto();
  try {
    await navigator.clipboard.writeText(texto);
    toast('Tabela copiada para a área de transferência.');
  } catch (e) {
    // clipboard API exige contexto seguro; fallback para textarea + execCommand.
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast('Tabela copiada.');
    } catch (e2) {
      toast('Não foi possível copiar automaticamente.');
    }
    ta.remove();
  }
}

/* ───────────── Eventos ───────────── */

function ligarEventos() {

  // — Busca —
  el.busca.addEventListener('input', () => {
    const termo = el.busca.value;
    el.limparBusca.hidden = termo.length === 0;
    renderSugestoes(buscar(termo), termo);
  });

  el.busca.addEventListener('focus', () => {
    if (el.busca.value.trim()) renderSugestoes(buscar(el.busca.value), el.busca.value);
  });

  el.busca.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); moverSelecao(1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); moverSelecao(-1); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      const idx = estado.indiceSugestao >= 0 ? estado.indiceSugestao : 0;
      const alimento = estado.sugestoesAtuais[idx];
      if (alimento) selecionarAlimento(alimento);
    } else if (ev.key === 'Escape') {
      fecharSugestoes();
    }
  });

  el.sugestoes.addEventListener('mousedown', (ev) => {
    // mousedown (e não click) para o item ser escolhido antes do blur do input.
    const li = ev.target.closest('.sugestao');
    if (!li) return;
    ev.preventDefault();
    const alimento = estado.sugestoesAtuais[Number(li.dataset.idx)];
    if (alimento) selecionarAlimento(alimento);
  });

  el.limparBusca.addEventListener('click', () => {
    el.busca.value = '';
    el.limparBusca.hidden = true;
    fecharSugestoes();
    el.busca.focus();
  });

  document.addEventListener('click', (ev) => {
    if (!el.combo.contains(ev.target)) fecharSugestoes();
  });

  // — Painel de quantidade —
  el.painelValor.addEventListener('input', atualizarEquivalencia);
  el.painelMedida.addEventListener('change', () => {
    // Ao trocar de medida caseira, 1 unidade é um padrão mais útil que 100.
    el.painelValor.value = el.painelMedida.value === 'g' ? '100' : '1';
    atualizarEquivalencia();
    el.painelValor.focus();
    el.painelValor.select();
  });
  el.painelValor.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); adicionarSelecionado(); }
    if (ev.key === 'Escape') { fecharPainel(); el.busca.focus(); }
  });
  el.painelAdd.addEventListener('click', adicionarSelecionado);
  el.painelCancelar.addEventListener('click', () => { fecharPainel(); el.busca.focus(); });

  // — Lista de ingredientes (delegação) —
  el.lista.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.ing-remover');
    if (!btn) return;
    const uid = Number(btn.dataset.uid);
    estado.ingredientes = estado.ingredientes.filter((i) => i.uid !== uid);
    atualizarTudo();
  });

  el.lista.addEventListener('input', (ev) => {
    const input = ev.target.closest('.ing-qtd input');
    if (!input) return;
    const item = estado.ingredientes.find((i) => i.uid === Number(input.dataset.uid));
    if (!item) return;
    item.gramas = paraNumero(input.value);
    // Só o rótulo é redesenhado: recriar a lista aqui roubaria o foco do campo.
    renderRotulo();
    salvar();
    const li = input.closest('.ingrediente');
    const meta = li && li.querySelector('.ing-meta');
    if (meta) {
      const kcal = Math.round(kcalDoIngrediente(item));
      let txt = `${formatar(kcal, 0)} kcal`;
      if (item.medida && item.medida.gramas > 0) {
        const q = Math.round((item.gramas / item.medida.gramas) * 10) / 10;
        txt = `≈ ${formatar(q, q % 1 === 0 ? 0 : 1)} ${item.medida.nome.toLowerCase()} · ${txt}`;
      }
      meta.textContent = txt;
    }
  });

  el.lista.addEventListener('blur', (ev) => {
    const input = ev.target.closest && ev.target.closest('.ing-qtd input');
    if (!input) return;
    const item = estado.ingredientes.find((i) => i.uid === Number(input.dataset.uid));
    if (!item) return;
    if (item.gramas <= 0) {
      estado.ingredientes = estado.ingredientes.filter((i) => i.uid !== item.uid);
      toast('Ingrediente removido (quantidade zerada).');
      atualizarTudo();
    } else {
      input.value = formatarGramas(item.gramas); // normaliza "0080" → "80"
    }
  }, true);

  el.limparTudo.addEventListener('click', () => {
    if (!confirm('Remover todos os ingredientes da receita?')) return;
    estado.ingredientes = [];
    atualizarTudo();
  });

  // — Receita / porções —
  el.nomeReceita.addEventListener('input', () => {
    estado.nomeReceita = el.nomeReceita.value;
    salvar();
  });

  el.porcoes.addEventListener('input', () => { renderRotulo(); salvar(); });

  document.querySelectorAll('[data-porcao]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const atual = Math.max(1, Math.round(paraNumero(el.porcoes.value) || 1));
      const novo = Math.min(99, Math.max(1, atual + Number(btn.dataset.porcao)));
      el.porcoes.value = novo;
      renderRotulo();
      salvar();
    });
  });

  // — Ações do rótulo —
  el.btnCopiar.addEventListener('click', copiarRotulo);
  el.btnImprimir.addEventListener('click', () => window.print());
}

/* ───────────── PWA: service worker + instalação ───────────── */

function ligarPWA() {
  if ('serviceWorker' in navigator) {
    const registrar = () => navigator.serviceWorker.register('sw.js').catch(() => {
      // Sem SW (ex.: aberto via file://) o app continua funcionando online.
    });
    // iniciar() é assíncrono, então 'load' pode já ter disparado quando
    // chegamos aqui — nesse caso o listener nunca rodaria.
    if (document.readyState === 'complete') registrar();
    else window.addEventListener('load', registrar, { once: true });
  }

  let promptInstalacao = null;

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    promptInstalacao = ev;
    el.btnInstalar.hidden = false;
  });

  el.btnInstalar.addEventListener('click', async () => {
    if (!promptInstalacao) return;
    promptInstalacao.prompt();
    await promptInstalacao.userChoice;
    promptInstalacao = null;
    el.btnInstalar.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    el.btnInstalar.hidden = true;
    toast('App instalado.');
  });
}

/* ───────────── Início ───────────── */

async function iniciar() {
  try {
    await carregarBase();
  } catch (erro) {
    el.rotuloCorpo.innerHTML =
      '<tr><td colspan="4">Não foi possível carregar data/taco.json. ' +
      'Abra o app por um servidor HTTP (veja o README), não por file://.</td></tr>';
    console.error('Falha ao carregar a base TACO:', erro);
    return;
  }

  restaurar();
  ligarEventos();
  atualizarTudo();
  ligarPWA();
}

iniciar();
