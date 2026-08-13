/* ============================================================
   Ficha Técnica de Preparo — app.js
   Sem framework, sem build. Toda a base TACO é carregada de
   data/taco.json em tempo de execução (ver README).

   O usuário digita apenas o que não dá para deduzir: nome do
   alimento, pesos e preço. Todo o resto — índices, totais,
   composição nutricional, per capita e percentuais — é derivado.
   ============================================================ */

'use strict';

/* Versão exibida no rodapé. Serve para saber, olhando o app, se o aparelho já
   recebeu a atualização — sem isso não dá para distinguir "o bug voltou" de
   "o celular ainda está com a versão antiga em cache".
   Ao mudar, atualize também CACHE em sw.js. */
const VERSAO_APP = '3.0';

const CHAVE_ANTIGA = 'calc-nutri:receita:v1';
const MAX_SUGESTOES = 10;

/* Rascunho automático — o que está na tela agora, salvo a cada tecla.
   É diferente da ficha salva no prontuário (js/fichas-storage.js).

   A chave muda conforme o contexto para que o rascunho de um paciente não
   apareça na ficha de outro: abrir "nova ficha" do paciente B mostraria o
   que ficou pela metade no paciente A. */
function chaveRascunho() {
  const params = new URLSearchParams(location.search);
  const ficha = params.get('ficha');
  const paciente = params.get('paciente');
  if (ficha) return 'calc-nutri:rascunho:f:' + ficha;
  if (paciente) return 'calc-nutri:rascunho:p:' + paciente;
  return 'calc-nutri:ficha:v2';   // ferramenta avulsa: mantém a chave histórica
}

const CHAVE_STORAGE = chaveRascunho();

/* Coeficientes de Atwater: kcal por grama de cada macronutriente.
   Usados só para repartir as calorias entre os macros no bloco
   "valor nutritivo per capita" (a coluna %). */
const ATWATER = { proteinas: 4, lipidios: 9, glicidios: 4 };

/* Base de alimentos, busca e definição dos nutrientes vêm de js/taco.js.
   O plano alimentar usa o mesmo módulo: manter duas cópias da conta faria
   as duas telas divergirem para o mesmo alimento. */
const NUTRIENTES = TacoBase.NUTRIENTES;

/* Campos de texto da ficha ligados por data-campo. */
const CAMPOS_FICHA = [
  'tema', 'nome', 'descricao', 'tempo', 'temperatura', 'tecnica',
  'rendimento', 'porcoes', 'medidaPreparacao', 'baseNutricional', 'modoPreparo',
  'cor', 'sabor', 'cheiro', 'consistencia', 'aceitacao'
];

/* ───────────── Estado ───────────── */

const estado = {
  base: [],
  porId: new Map(),
  vd: {},
  fonteBase: '',
  ficha: {
    tema: '', nome: '', descricao: '', tempo: '', temperatura: '', tecnica: '',
    rendimento: '', porcoes: '1', medidaPreparacao: '', baseNutricional: 'plIn',
    modoPreparo: '', cor: '', sabor: '', cheiro: '', consistencia: '', aceitacao: '',
    dificuldade: ''
  },
  // { uid, foodId, pb, plIn, plFin, ir, precoKg, medidaCaseira, medidaManual }
  ingredientes: [],
  selecionado: null,
  indiceSugestao: -1,
  sugestoesAtuais: []
};

let proximoUid = 1;

/* Confirmação em dois toques do botão "Limpar tudo".
   Declarado aqui, e não junto do handler, porque renderIngredientes() lê a
   variável e roda antes — com `let` mais abaixo isso cairia na zona morta. */
let temporizadorLimpar = null;

/* ───────────── Atalhos de DOM ───────────── */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

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
  percapita: $('#f-percapita'),
  dicaRendimento: $('#dica-rendimento'),
  qtdAlimentos: $('#qtd-alimentos'),
  versaoApp: $('#versao-app'),
  toast: $('#toast'),
  btnInstalar: $('#btn-instalar')
};

if (el.versaoApp) el.versaoApp.textContent = VERSAO_APP;

/* ───────────── Utilidades ───────────── */

const normalizar = TacoBase.normalizar;

/** Aceita "1,5" e "1.5"; devolve número finito >= 0 (0 quando vazio/inválido). */
function paraNumero(valor) {
  const n = parseFloat(String(valor == null ? '' : valor).replace(',', '.').replace(/[^0-9.]/g, ''));
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(n, 1000000);
}

function formatar(n, casas) {
  const v = Number(n) || 0;
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Gramas: inteiro acima de 10 g, uma casa abaixo disso. */
function formatarGramas(g) {
  const v = Number(g) || 0;
  return v >= 10 || v === 0 ? formatar(Math.round(v), 0) : formatar(v, 1);
}

function formatarIndice(v) {
  return v == null || !isFinite(v) || v <= 0 ? '—' : formatar(v, 2);
}

function formatarDinheiro(v) {
  return v == null || !isFinite(v) || v <= 0 ? '—' : formatar(v, 2);
}

function escaparHtml(txt) {
  return String(txt == null ? '' : txt).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let timerToast;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('visivel');
  clearTimeout(timerToast);
  timerToast = setTimeout(() => el.toast.classList.remove('visivel'), 2600);
}

/* ───────────── Carregamento da base ───────────── */

async function carregarBase() {
  await TacoBase.carregar();
  estado.base = TacoBase.todos();
  estado.porId = TacoBase.porId();
  estado.vd = TacoBase.valoresDiarios();
  estado.fonteBase = TacoBase.fonte();
  el.qtdAlimentos.textContent = estado.base.length;
}

/* ───────────── Busca / autocomplete ───────────── */

const buscar = (termo) => TacoBase.buscar(termo, MAX_SUGESTOES);
const destacar = TacoBase.destacar;

function renderSugestoes(lista, termo) {
  estado.sugestoesAtuais = lista;
  estado.indiceSugestao = -1;

  if (!termo.trim()) { fecharSugestoes(); return; }

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
  $$('#sugestoes .sugestao').forEach((li, i) => {
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
  if (gramas <= 0) { el.painelEquiv.textContent = ''; return; }
  const kcal = (alimento.por100g.kcal * gramas) / 100;
  const prefixo = medida ? `= ${formatarGramas(gramas)} g · ` : '';
  el.painelEquiv.textContent = `${prefixo}${formatar(Math.round(kcal), 0)} kcal`;
}

function fecharPainel() {
  el.painel.hidden = true;
  estado.selecionado = null;
}

/** Plural do português, suficiente para os nomes de medida caseira da base. */
function pluralizarPalavra(p) {
  if (/s$/.test(p)) return p;
  if (/ão$/.test(p)) return p.replace(/ão$/, 'ões');
  if (/[rz]$/.test(p)) return p + 'es';
  if (/[aeou]l$/.test(p)) return p.slice(0, -1) + 'is';
  if (/il$/.test(p)) return p.slice(0, -2) + 'is';
  if (/m$/.test(p)) return p.slice(0, -1) + 'ns';
  return p + 's';
}

/* Adjetivos que qualificam a própria medida e por isso concordam com ela.
   Ficam de fora palavras que descrevem o alimento ("ralado", "picada"). */
const ADJETIVOS_MEDIDA = new Set([
  'cheia', 'cheio', 'rasa', 'raso', 'média', 'médio',
  'pequena', 'pequeno', 'grande', 'americano', 'americana',
  'drenada', 'drenado'
]);

/** "filé médio" + plural → "filés médios"; "colher de sopa cheia" → "colheres de sopa cheias". */
function pluralizarMedida(nome) {
  const palavras = nome.split(' ');
  palavras[0] = pluralizarPalavra(palavras[0]);
  const ultimo = palavras.length - 1;
  if (ultimo > 0 && ADJETIVOS_MEDIDA.has(palavras[ultimo])) {
    palavras[ultimo] = pluralizarPalavra(palavras[ultimo]);
  }
  return palavras.join(' ');
}

/** Descreve N gramas na melhor medida caseira do alimento ("2 colheres de sopa"). */
function medidaCaseiraAuto(alimento, gramas) {
  const medidas = alimento.medidas || [];
  if (!medidas.length || gramas <= 0) return '';

  // Escolhe a medida cuja contagem fica mais próxima de um número "redondo".
  let melhor = null;
  for (const m of medidas) {
    if (!m.gramas || m.gramas <= 0) continue;
    const qtd = gramas / m.gramas;
    const arred = Math.round(qtd * 2) / 2;          // meias unidades
    if (arred < 0.5) continue;
    const erro = Math.abs(qtd - arred) / qtd;
    if (!melhor || erro < melhor.erro) melhor = { m, qtd: arred, erro };
  }
  if (!melhor) return '';

  const q = melhor.qtd;
  const texto = formatar(q, q % 1 === 0 ? 0 : 1);
  const nome = melhor.m.nome.toLowerCase();
  return `${texto} ${q > 1 ? pluralizarMedida(nome) : nome}`;
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

  estado.ingredientes.push({
    uid: proximoUid++,
    foodId: alimento.id,
    pb: gramas,          // por padrão bruto = líquido; o usuário refina depois
    plIn: gramas,
    plFin: 0,
    ir: 0,
    precoKg: 0,
    medidaCaseira: medidaCaseiraAuto(alimento, gramas),
    medidaManual: false
  });

  fecharPainel();
  el.busca.value = '';
  el.limparBusca.hidden = true;
  atualizarTudo();
  toast(`${alimento.nome} adicionado.`);
  el.busca.focus();
}

/* ============================================================
   CÁLCULO — o coração do preenchimento automático
   ============================================================ */

/** Peso de cada ingrediente que alimenta o cálculo nutricional. */
function quantNutricional(item) {
  const base = estado.ficha.baseNutricional;
  if (base === 'pb') return item.pb || item.plIn || 0;
  if (base === 'plFin') return item.plFin || item.plIn || item.pb || 0;
  return item.plIn || item.pb || 0; // 'plIn' (padrão)
}

/** Índices derivados de um ingrediente. Devolve null quando não dá para calcular. */
function indicesDoIngrediente(item) {
  const ic = item.pb > 0 && item.plIn > 0 ? item.pb / item.plIn : null;
  const fc = item.plIn > 0 && item.plFin > 0 ? item.plFin / item.plIn : null;
  const cb = item.precoKg > 0 && item.pb > 0 ? (item.pb / 1000) * item.precoKg : null;
  return { ic, fc, cb };
}

/** Todos os números da ficha, num só lugar. */
function calcular() {
  const somas = { pb: 0, plIn: 0, plFin: 0, cb: 0, quant: 0 };
  const nutri = {};
  NUTRIENTES.forEach((n) => { nutri[n.chave] = 0; });

  const linhas = [];

  for (const item of estado.ingredientes) {
    const alimento = estado.porId.get(item.foodId);
    if (!alimento) continue;

    const { ic, fc, cb } = indicesDoIngrediente(item);
    const quant = quantNutricional(item);
    const fator = quant / 100;

    const valores = {};
    for (const n of NUTRIENTES) {
      valores[n.chave] = (alimento.por100g[n.chave] || 0) * fator;
      nutri[n.chave] += valores[n.chave];
    }

    somas.pb += item.pb;
    somas.plIn += item.plIn;
    // Sem peso final informado, o ingrediente entra com o líquido inicial.
    somas.plFin += item.plFin > 0 ? item.plFin : item.plIn;
    somas.quant += quant;
    if (cb) somas.cb += cb;

    linhas.push({ item, alimento, ic, fc, cb, quant, valores });
  }

  // Rendimento: o peso pesado na balança tem prioridade sobre o calculado.
  const rendimentoAuto = somas.plFin;
  const rendimentoManual = paraNumero(estado.ficha.rendimento);
  const rendimento = rendimentoManual > 0 ? rendimentoManual : rendimentoAuto;

  const porcoes = Math.max(1, paraNumero(estado.ficha.porcoes) || 1);
  const perCapita = rendimento / porcoes;

  // Fator de cocção da preparação inteira: quanto o peso mudou do cru ao pronto.
  const fcPreparacao = somas.plIn > 0 ? rendimento / somas.plIn : null;

  // Repartição calórica per capita pelos coeficientes de Atwater.
  const pcProt = nutri.proteinas / porcoes;
  const pcLip = nutri.gordurasTotais / porcoes;
  const pcCarb = nutri.carboidratos / porcoes;
  const kcalProt = pcProt * ATWATER.proteinas;
  const kcalLip = pcLip * ATWATER.lipidios;
  const kcalCarb = pcCarb * ATWATER.glicidios;
  const kcalMacros = kcalProt + kcalLip + kcalCarb;

  const perc = (v) => (kcalMacros > 0 ? (v / kcalMacros) * 100 : 0);

  return {
    linhas, somas, nutri, rendimento, rendimentoAuto, porcoes, perCapita,
    fcPreparacao,
    custoTotal: somas.cb,
    custoPorcao: porcoes > 0 ? somas.cb / porcoes : 0,
    kcalPorcao: nutri.kcal / porcoes,
    perCapitaNutri: {
      proteinas: { g: pcProt, kcal: kcalProt, pct: perc(kcalProt) },
      lipidios: { g: pcLip, kcal: kcalLip, pct: perc(kcalLip) },
      glicidios: { g: pcCarb, kcal: kcalCarb, pct: perc(kcalCarb) },
      sodio: { g: nutri.sodio / porcoes },
      fibras: { g: nutri.fibras / porcoes },
      totalKcal: kcalMacros
    }
  };
}

/* ============================================================
   RENDERIZAÇÃO
   ============================================================ */

/* ── Cartões de ingrediente (aba Montar) ── */

function renderIngredientes(calc) {
  const n = estado.ingredientes.length;
  el.contador.textContent = n;
  el.vazio.hidden = n > 0;
  el.limparTudo.hidden = n === 0;
  // Sem itens o botão some; ao reaparecer não pode estar preso em "Confirmar?".
  if (n === 0 && temporizadorLimpar) resetarBotaoLimpar();

  el.lista.innerHTML = calc.linhas.map(({ item, alimento, ic, fc, cb }) => {
    const kcal = (alimento.por100g.kcal * quantNutricional(item)) / 100;
    const chips = [
      ic ? `<span class="chip">IC ${formatar(ic, 2)}</span>` : '',
      fc ? `<span class="chip">FC ${formatar(fc, 2)}</span>` : '',
      cb ? `<span class="chip">CB R$ ${formatar(cb, 2)}</span>` : '',
      `<span class="chip chip-kcal">${formatar(Math.round(kcal), 0)} kcal</span>`
    ].filter(Boolean).join('');

    const campo = (nome, rotulo, valor, sufixo, dica) => `
      <label class="mini-campo" title="${escaparHtml(dica || '')}">
        <span>${rotulo}</span>
        <span class="mini-wrap">
          <input type="text" inputmode="decimal" data-uid="${item.uid}" data-prop="${nome}"
                 value="${valor > 0 ? escaparHtml(formatarGramas(valor)) : ''}"
                 placeholder="—" aria-label="${escaparHtml(rotulo)} de ${escaparHtml(alimento.nome)}">
          ${sufixo ? `<em>${sufixo}</em>` : ''}
        </span>
      </label>`;

    return `
      <div class="ing-card" data-uid="${item.uid}">
        <div class="ing-card-topo">
          <div class="ing-nome">${escaparHtml(alimento.nome)}</div>
          <button class="ing-remover" type="button" data-uid="${item.uid}"
                  aria-label="Remover ${escaparHtml(alimento.nome)}">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M5 5l14 14M19 5L5 19"/>
            </svg>
          </button>
        </div>

        <div class="ing-campos">
          ${campo('pb', 'Peso bruto', item.pb, 'g', 'Como veio: com casca, osso, aparas')}
          ${campo('plIn', 'Líq. inicial', item.plIn, 'g', 'Limpo, pronto para ir à panela')}
          ${campo('plFin', 'Líq. final', item.plFin, 'g', 'Depois de pronto (opcional)')}
          ${campo('ir', 'IR', item.ir, '', 'Indicador de reidratação — só para alimentos secos que hidratam')}
          <label class="mini-campo" title="Preço pago por quilo">
            <span>Preço</span>
            <span class="mini-wrap">
              <em class="prefixo">R$</em>
              <input type="text" inputmode="decimal" data-uid="${item.uid}" data-prop="precoKg"
                     value="${item.precoKg > 0 ? escaparHtml(formatar(item.precoKg, 2)) : ''}"
                     placeholder="—" aria-label="Preço por quilo de ${escaparHtml(alimento.nome)}">
              <em>/kg</em>
            </span>
          </label>
        </div>

        <label class="mini-campo mini-largo">
          <span>Medida caseira</span>
          <span class="mini-wrap">
            <input type="text" data-uid="${item.uid}" data-prop="medidaCaseira"
                   value="${escaparHtml(item.medidaCaseira)}" placeholder="—"
                   aria-label="Medida caseira de ${escaparHtml(alimento.nome)}">
          </span>
        </label>

        <div class="ing-chips">${chips}</div>
      </div>`;
  }).join('');
}

/* ── Folha 1: identificação + ingredientes ── */

function renderFolha1(calc) {
  const f = estado.ficha;
  const vazio = '—';

  $('#v-tema').textContent = f.tema || vazio;
  $('#v-nome').textContent = f.nome || vazio;
  $('#v-descricao').textContent = f.descricao || vazio;
  $('#v-rendimento').textContent = formatarGramas(calc.rendimento);
  $('#v-percapita').textContent = formatarGramas(calc.perCapita);
  $('#v-porcoes').textContent = formatar(calc.porcoes, calc.porcoes % 1 === 0 ? 0 : 1);
  $('#v-tempo').textContent = f.tempo || vazio;
  $('#v-medida-prep').textContent = f.medidaPreparacao || vazio;

  $$('.v-tema-2, .v-tema-3').forEach((e) => { e.textContent = f.tema || vazio; });
  $$('.v-nome-2, .v-nome-3').forEach((e) => { e.textContent = f.nome || vazio; });
  $$('.v-rendimento-2').forEach((e) => { e.textContent = formatarGramas(calc.rendimento); });
  $$('.v-percapita-2, .v-percapita-3').forEach((e) => { e.textContent = formatarGramas(calc.perCapita); });
  $$('.v-porcoes-2, .v-porcoes-3').forEach((e) => {
    e.textContent = formatar(calc.porcoes, calc.porcoes % 1 === 0 ? 0 : 1);
  });
  $$('.v-tempo-3').forEach((e) => { e.textContent = f.tempo || vazio; });
  $$('.v-medida-prep-3').forEach((e) => { e.textContent = f.medidaPreparacao || vazio; });

  $('#ft-corpo').innerHTML = calc.linhas.length
    ? calc.linhas.map(({ item, alimento, ic, fc, cb }) => `
        <tr>
          <td class="col-ing">${escaparHtml(alimento.nome)}</td>
          <td>${item.pb > 0 ? formatarGramas(item.pb) : '—'}</td>
          <td>${item.plIn > 0 ? formatarGramas(item.plIn) : '—'}</td>
          <td>${item.plFin > 0
                ? formatarGramas(item.plFin)
                : (item.plIn > 0
                    ? `<span class="assumido">(${formatarGramas(item.plIn)})</span>`
                    : '—')}</td>
          <td>${formatarIndice(fc)}</td>
          <td>${formatarIndice(ic)}</td>
          <td>${formatarIndice(item.ir)}</td>
          <td>${formatarDinheiro(cb)}</td>
          <td>${formatarDinheiro(cb ? cb / calc.porcoes : null)}</td>
          <td class="col-medida">${escaparHtml(item.medidaCaseira || '—')}</td>
        </tr>`).join('')
    : '<tr class="linha-vazia"><td colspan="10">Nenhum ingrediente adicionado.</td></tr>';

  $('#t-pb').textContent = formatarGramas(calc.somas.pb);
  $('#t-plin').textContent = formatarGramas(calc.somas.plIn);
  $('#t-plfin').textContent = formatarGramas(calc.somas.plFin);
  $('#t-cb').textContent = formatarDinheiro(calc.custoTotal);
  $('#t-cp').textContent = formatarDinheiro(calc.custoPorcao);
}

/* ── Folha 2: composição nutricional ── */

function renderFolha2(calc) {
  $('#nut-corpo').innerHTML = calc.linhas.length
    ? calc.linhas.map(({ alimento, quant, valores }) => `
        <tr>
          <td class="col-ing">${escaparHtml(alimento.nome)}</td>
          <td>${formatarGramas(quant)}</td>
          <td>${formatar(valores.kcal, 1)}</td>
          <td>${formatar(valores.carboidratos, 1)}</td>
          <td>${formatar(valores.proteinas, 1)}</td>
          <td>${formatar(valores.gordurasTotais, 1)}</td>
          <td>${formatar(valores.fibras, 1)}</td>
          <td>${formatar(valores.sodio, 1)}</td>
        </tr>`).join('')
    : '<tr class="linha-vazia"><td colspan="8">Nenhum ingrediente adicionado.</td></tr>';

  $('#n-quant').textContent = formatarGramas(calc.somas.quant);
  $('#n-kcal').textContent = formatar(calc.nutri.kcal, 1);
  $('#n-carb').textContent = formatar(calc.nutri.carboidratos, 1);
  $('#n-prot').textContent = formatar(calc.nutri.proteinas, 1);
  $('#n-lip').textContent = formatar(calc.nutri.gordurasTotais, 1);
  $('#n-fibra').textContent = formatar(calc.nutri.fibras, 1);
  $('#n-na').textContent = formatar(calc.nutri.sodio, 1);

  const pc = calc.perCapitaNutri;
  const linha = (nome, g, unidade, kcal, pct) => `
    <tr>
      <th class="col-ing">${nome}</th>
      <td>${formatar(g, 1)} ${unidade}</td>
      <td>${kcal == null ? '—' : formatar(kcal, 1)}</td>
      <td>${pct == null ? '—' : formatar(pct, 1) + '%'}</td>
    </tr>`;

  $('#pc-corpo').innerHTML =
    linha('Proteínas', pc.proteinas.g, 'g', pc.proteinas.kcal, pc.proteinas.pct) +
    linha('Lipídios', pc.lipidios.g, 'g', pc.lipidios.kcal, pc.lipidios.pct) +
    linha('Glícídios', pc.glicidios.g, 'g', pc.glicidios.kcal, pc.glicidios.pct) +
    linha('Sódio', pc.sodio.g, 'mg', null, null) +
    linha('Fibras', pc.fibras.g, 'g', null, null) +
    `<tr class="linha-total">
      <th class="col-ing">Total</th>
      <td>—</td>
      <td>${formatar(pc.totalKcal, 1)}</td>
      <td>100,0%</td>
    </tr>`;

  $('#v-fontes').textContent = estado.fonteBase;
}

/* ── Folha 3: modo de preparo e análise sensorial ── */

function renderFolha3(calc) {
  const f = estado.ficha;
  const vazio = '—';

  $('#v-modo').textContent = f.modoPreparo || vazio;
  $('#v-tecnica').textContent = f.tecnica || vazio;
  $('#v-temperatura').textContent = f.temperatura || vazio;
  $('#v-pb-total').textContent = formatarGramas(calc.somas.pb);
  $('#v-plin-total').textContent = formatarGramas(calc.somas.plIn);
  $('#v-plfin-total').textContent = formatarGramas(calc.somas.plFin);
  $('#v-fc-preparacao').textContent = formatarIndice(calc.fcPreparacao);
  $('#v-kcal-porcao').textContent = formatar(calc.kcalPorcao, 1);

  $('#v-cor').textContent = f.cor || vazio;
  $('#v-sabor').textContent = f.sabor || vazio;
  $('#v-cheiro').textContent = f.cheiro || vazio;
  $('#v-consistencia').textContent = f.consistencia || vazio;
  $('#v-aceitacao').textContent = f.aceitacao || vazio;

  $$('.marca').forEach((m) => {
    m.textContent = m.dataset.dif === f.dificuldade ? '( X )' : '(    )';
  });
}

/* ── Rótulo ANVISA ── */

function renderRotulo(calc) {
  const porcoes = calc.porcoes;
  const pesoTotal = calc.somas.quant;
  const pesoPorcao = pesoTotal / porcoes;

  $('#rotulo-porcao').textContent =
    `Porções por receita: ${formatar(porcoes, porcoes % 1 === 0 ? 0 : 1)} ` +
    `${porcoes === 1 ? 'porção' : 'porções'} de ${formatarGramas(pesoPorcao)} g`;
  $('#th-porcao-g').textContent = `(${formatarGramas(pesoPorcao)} g)`;

  // Base "por 100 g" da preparação pronta: totais normalizados pelo peso total.
  const fator100 = pesoTotal > 0 ? 100 / pesoTotal : 0;

  $('#rotulo-corpo').innerHTML = NUTRIENTES.map((n) => {
    const total = calc.nutri[n.chave];
    const por100 = total * fator100;
    const porPorcao = total / porcoes;
    const vdRef = n.vd ? estado.vd[n.vd] : null;
    const pctVd = vdRef ? Math.round((porPorcao / vdRef) * 100) : null;

    const classes = [];
    if (n.destaque) classes.push('linha-destaque');
    if (pctVd === null) classes.push('sem-vd');

    return `
      <tr class="${classes.join(' ')}">
        <td class="c-nome${n.recuo ? ' recuo' : ''}">${n.rotulo}${n.chave === 'acucares' ? '<sup>†</sup>' : ''}</td>
        <td class="c-num">${formatar(por100, n.casas)} ${n.unidade}</td>
        <td class="c-num">${formatar(porPorcao, n.casas)} ${n.unidade}</td>
        <td class="c-num">${pctVd === null ? '—' : pctVd + '%'}</td>
      </tr>`;
  }).join('');

  const temEstimado = estado.ingredientes.some((i) => {
    const a = estado.porId.get(i.foodId);
    return a && a.acucaresEstimado;
  });
  $('#nota-acucares').hidden = !temEstimado;
}

/* ── Campos que o app preenche de volta na aba Montar ── */

function renderCamposDerivados(calc) {
  // Per capita só é escrito quando o campo não está em edição.
  if (document.activeElement !== el.percapita) {
    el.percapita.value = calc.rendimento > 0 ? formatarGramas(calc.perCapita) : '';
  }
  el.dicaRendimento.textContent = estado.ficha.rendimento
    ? `Peso informado. O total dos ingredientes dá ${formatarGramas(calc.rendimentoAuto)} g.`
    : `Usando o total dos ingredientes: ${formatarGramas(calc.rendimentoAuto)} g. Informe o peso da balança para mais precisão.`;
}

function atualizarTudo() {
  const calc = calcular();
  renderIngredientes(calc);
  renderFolha1(calc);
  renderFolha2(calc);
  renderFolha3(calc);
  renderRotulo(calc);
  renderCamposDerivados(calc);
  salvar();
  notificarMudanca();
}

/* ───────────── Persistência ───────────── */

function salvar() {
  try {
    localStorage.setItem(CHAVE_STORAGE, JSON.stringify({
      ficha: estado.ficha,
      itens: estado.ingredientes.map((i) => ({
        foodId: i.foodId, pb: i.pb, plIn: i.plIn, plFin: i.plFin,
        ir: i.ir, precoKg: i.precoKg,
        medidaCaseira: i.medidaCaseira, medidaManual: i.medidaManual
      }))
    }));
  } catch (e) {
    // Modo privado / cota cheia: seguir sem persistir.
  }
}

/** Copia o estado da ficha para os campos visíveis da aba Montar. */
function refletirFichaNosCampos() {
  CAMPOS_FICHA.forEach((campo) => {
    const input = document.querySelector(`[data-campo="${campo}"]`);
    if (input) input.value = estado.ficha[campo] || '';
  });
  $$('input[name="dificuldade"]').forEach((r) => {
    r.checked = r.value === estado.ficha.dificuldade;
  });
}

function restaurar() {
  let dados = null;
  try { dados = JSON.parse(localStorage.getItem(CHAVE_STORAGE) || 'null'); } catch (e) {}
  FichaTool.tinhaRascunho = !!dados;

  // Migração da versão anterior do app, que só guardava gramas por ingrediente.
  // Só faz sentido na ferramenta avulsa: fichas de paciente nunca existiram lá.
  if (!dados && CHAVE_STORAGE === 'calc-nutri:ficha:v2') {
    let antigo = null;
    try { antigo = JSON.parse(localStorage.getItem(CHAVE_ANTIGA) || 'null'); } catch (e) {}
    if (antigo && Array.isArray(antigo.itens)) {
      dados = {
        ficha: { nome: antigo.nome || '', porcoes: String(antigo.porcoes || 1) },
        itens: antigo.itens.map((i) => ({
          foodId: i.foodId, pb: paraNumero(i.gramas), plIn: paraNumero(i.gramas),
          plFin: 0, ir: 0, precoKg: 0,
          medidaCaseira: '', medidaManual: false
        }))
      };
      toast('Receita da versão anterior importada para a ficha técnica.');
    }
  }

  if (!dados) return;

  Object.assign(estado.ficha, dados.ficha || {});

  let descartados = 0;
  estado.ingredientes = (dados.itens || []).reduce((acc, i) => {
    // Um alimento pode ter sumido da base entre versões — ignora em vez de quebrar.
    if (!estado.porId.has(i.foodId)) { descartados++; return acc; }
    acc.push({
      uid: proximoUid++,
      foodId: i.foodId,
      pb: paraNumero(i.pb),
      plIn: paraNumero(i.plIn),
      plFin: paraNumero(i.plFin),
      ir: paraNumero(i.ir),
      precoKg: paraNumero(i.precoKg),
      medidaCaseira: i.medidaCaseira || '',
      medidaManual: !!i.medidaManual
    });
    return acc;
  }, []);

  refletirFichaNosCampos();

  if (descartados > 0) {
    toast(`${descartados} ingrediente(s) não existem mais na base e foram removidos.`);
  }
}

/* ───────────── Exportar como texto ───────────── */

function fichaComoTexto() {
  const calc = calcular();
  const f = estado.ficha;
  const L = [];
  const rot = (k, v) => L.push(k.padEnd(32) + (v || '—'));

  L.push('FICHA TÉCNICA DE PREPARO');
  L.push('='.repeat(78));
  rot('Tema da aula:', f.tema);
  rot('Nome da preparação:', f.nome);
  rot('Descrição:', f.descricao);
  rot('Rendimento da receita:', formatarGramas(calc.rendimento) + ' g');
  rot('Peso da porção (per capita):', formatarGramas(calc.perCapita) + ' g');
  rot('Rendimento da porção:', formatar(calc.porcoes, 0) + ' porções');
  rot('Tempo de preparo:', (f.tempo || '—') + ' min');
  rot('Medida caseira da preparação:', f.medidaPreparacao);

  L.push('');
  L.push('INGREDIENTES');
  L.push('Alimento'.padEnd(38) + 'PB'.padStart(8) + 'PL in'.padStart(8) +
         'PL fin'.padStart(8) + 'FC'.padStart(7) + 'IC'.padStart(7) + 'CB'.padStart(9));
  for (const { item, alimento, ic, fc, cb } of calc.linhas) {
    L.push(
      alimento.nome.slice(0, 37).padEnd(38) +
      (item.pb > 0 ? formatarGramas(item.pb) : '—').padStart(8) +
      (item.plIn > 0 ? formatarGramas(item.plIn) : '—').padStart(8) +
      (item.plFin > 0 ? formatarGramas(item.plFin) : '—').padStart(8) +
      formatarIndice(fc).padStart(7) +
      formatarIndice(ic).padStart(7) +
      formatarDinheiro(cb).padStart(9)
    );
  }
  L.push('TOTAL'.padEnd(38) +
    formatarGramas(calc.somas.pb).padStart(8) +
    formatarGramas(calc.somas.plIn).padStart(8) +
    formatarGramas(calc.somas.plFin).padStart(8) +
    '****'.padStart(7) + '****'.padStart(7) +
    formatarDinheiro(calc.custoTotal).padStart(9));

  L.push('');
  L.push('COMPOSIÇÃO NUTRICIONAL');
  L.push('Alimento'.padEnd(38) + 'Quant'.padStart(8) + 'Kcal'.padStart(9) +
         'Carb'.padStart(8) + 'Prot'.padStart(8) + 'Lip'.padStart(8) +
         'Fibra'.padStart(8) + 'Na'.padStart(9));
  for (const { alimento, quant, valores } of calc.linhas) {
    L.push(
      alimento.nome.slice(0, 37).padEnd(38) +
      formatarGramas(quant).padStart(8) +
      formatar(valores.kcal, 1).padStart(9) +
      formatar(valores.carboidratos, 1).padStart(8) +
      formatar(valores.proteinas, 1).padStart(8) +
      formatar(valores.gordurasTotais, 1).padStart(8) +
      formatar(valores.fibras, 1).padStart(8) +
      formatar(valores.sodio, 1).padStart(9)
    );
  }
  L.push('TOTAL'.padEnd(38) +
    formatarGramas(calc.somas.quant).padStart(8) +
    formatar(calc.nutri.kcal, 1).padStart(9) +
    formatar(calc.nutri.carboidratos, 1).padStart(8) +
    formatar(calc.nutri.proteinas, 1).padStart(8) +
    formatar(calc.nutri.gordurasTotais, 1).padStart(8) +
    formatar(calc.nutri.fibras, 1).padStart(8) +
    formatar(calc.nutri.sodio, 1).padStart(9));

  const pc = calc.perCapitaNutri;
  L.push('');
  L.push('VALOR NUTRITIVO PER CAPITA');
  L.push('Nutriente'.padEnd(20) + 'Quantidade'.padStart(14) + 'Kcal'.padStart(10) + '%'.padStart(9));
  const lpc = (nome, g, un, kcal, pct) => L.push(
    nome.padEnd(20) +
    (formatar(g, 1) + ' ' + un).padStart(14) +
    (kcal == null ? '—' : formatar(kcal, 1)).padStart(10) +
    (pct == null ? '—' : formatar(pct, 1) + '%').padStart(9));
  lpc('Proteínas', pc.proteinas.g, 'g', pc.proteinas.kcal, pc.proteinas.pct);
  lpc('Lipídios', pc.lipidios.g, 'g', pc.lipidios.kcal, pc.lipidios.pct);
  lpc('Glícídios', pc.glicidios.g, 'g', pc.glicidios.kcal, pc.glicidios.pct);
  lpc('Sódio', pc.sodio.g, 'mg', null, null);
  lpc('Fibras', pc.fibras.g, 'g', null, null);
  L.push('Total'.padEnd(20) + '—'.padStart(14) + formatar(pc.totalKcal, 1).padStart(10) + '100,0%'.padStart(9));

  L.push('');
  L.push('MODO DE PREPARO');
  L.push(f.modoPreparo || '—');
  L.push('');
  rot('Técnica utilizada:', f.tecnica);
  rot('Temperatura de cocção:', f.temperatura);
  rot('Peso bruto total:', formatarGramas(calc.somas.pb) + ' g');
  rot('Peso líquido inicial:', formatarGramas(calc.somas.plIn) + ' g');
  rot('Peso líquido final:', formatarGramas(calc.somas.plFin) + ' g');
  rot('Fator de cocção da preparação:', formatarIndice(calc.fcPreparacao));
  rot('Valor calórico da porção:', formatar(calc.kcalPorcao, 1) + ' kcal');
  rot('Nível de dificuldade:', f.dificuldade);

  L.push('');
  L.push('ANÁLISE SENSORIAL');
  rot('Cor:', f.cor);
  rot('Sabor:', f.sabor);
  rot('Cheiro:', f.cheiro);
  rot('Consistência:', f.consistencia);
  rot('Aceitação:', f.aceitacao);

  L.push('');
  L.push('Fonte: ' + estado.fonteBase);
  return L.join('\n');
}

function rotuloComoTexto() {
  const calc = calcular();
  const pesoTotal = calc.somas.quant;
  const fator100 = pesoTotal > 0 ? 100 / pesoTotal : 0;
  const L = [];

  L.push(estado.ficha.nome || 'Preparação sem nome');
  L.push('='.repeat(40));
  L.push(`Peso total: ${formatarGramas(pesoTotal)} g`);
  L.push(`Rende: ${formatar(calc.porcoes, 0)} porção(ões) de ${formatarGramas(pesoTotal / calc.porcoes)} g`);
  L.push('');
  L.push('INFORMAÇÃO NUTRICIONAL');
  L.push('Nutriente'.padEnd(24) + '100 g'.padStart(11) + 'Porção'.padStart(11) + '%VD'.padStart(6));
  NUTRIENTES.forEach((n) => {
    const porPorcao = calc.nutri[n.chave] / calc.porcoes;
    const por100 = calc.nutri[n.chave] * fator100;
    const vdRef = n.vd ? estado.vd[n.vd] : null;
    const pct = vdRef ? Math.round((porPorcao / vdRef) * 100) + '%' : '—';
    L.push(
      n.rotulo.padEnd(24) +
      `${formatar(por100, n.casas)} ${n.unidade}`.padStart(11) +
      `${formatar(porPorcao, n.casas)} ${n.unidade}`.padStart(11) +
      pct.padStart(6)
    );
  });
  L.push('');
  L.push('*%VD com base em dieta de 2.000 kcal (RDC 429/2020).');
  L.push('Fonte: ' + estado.fonteBase);
  return L.join('\n');
}

async function copiar(texto, mensagem) {
  if (estado.ingredientes.length === 0) {
    toast('Adicione ingredientes primeiro.');
    return;
  }
  try {
    await navigator.clipboard.writeText(texto);
    toast(mensagem);
  } catch (e) {
    // clipboard API exige contexto seguro; fallback para textarea + execCommand.
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(mensagem); }
    catch (e2) { toast('Não foi possível copiar automaticamente.'); }
    ta.remove();
  }
}

/* ───────────── Abas ───────────── */

function trocarAba(nome) {
  $$('.aba').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
  $$('.painel-aba').forEach((p) => {
    const ativa = p.id === 'aba-' + nome;
    p.hidden = !ativa;
    p.classList.toggle('ativa', ativa);
  });
  document.body.dataset.aba = nome;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/* ───────────── Eventos ───────────── */

function resetarBotaoLimpar() {
  clearTimeout(temporizadorLimpar);
  temporizadorLimpar = null;
  el.limparTudo.textContent = 'Limpar tudo';
  el.limparTudo.classList.remove('confirmando');
}

function ligarEventos() {

  // — Abas —
  $$('.aba').forEach((btn) => btn.addEventListener('click', () => trocarAba(btn.dataset.aba)));

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
    } else if (ev.key === 'Escape') fecharSugestoes();
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
    // Clicar em qualquer outro lugar desarma o "Confirmar?".
    if (temporizadorLimpar && !el.limparTudo.contains(ev.target)) resetarBotaoLimpar();
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

  // — Cartões de ingrediente —
  el.lista.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.ing-remover');
    if (!btn) return;
    estado.ingredientes = estado.ingredientes.filter((i) => i.uid !== Number(btn.dataset.uid));
    atualizarTudo();
  });

  el.lista.addEventListener('input', (ev) => {
    const input = ev.target.closest('input[data-prop]');
    if (!input) return;
    const item = estado.ingredientes.find((i) => i.uid === Number(input.dataset.uid));
    if (!item) return;

    const prop = input.dataset.prop;
    if (prop === 'medidaCaseira') {
      item.medidaCaseira = input.value;
      item.medidaManual = true;
    } else {
      item[prop] = paraNumero(input.value);
      // Peso bruto digitado antes do líquido: assume que são iguais até o
      // usuário dizer o contrário, para não zerar o cálculo nutricional.
      if (prop === 'pb' && item.plIn === 0) item.plIn = item.pb;
      // Medida caseira acompanha o peso, a menos que tenha sido editada à mão.
      if (prop === 'plIn' && !item.medidaManual) {
        const alimento = estado.porId.get(item.foodId);
        if (alimento) item.medidaCaseira = medidaCaseiraAuto(alimento, item.plIn);
      }
    }

    // Redesenhar a lista aqui roubaria o foco do campo em edição, então só
    // atualizamos as partes derivadas e os "chips" deste cartão.
    const calc = calcular();
    renderFolha1(calc);
    renderFolha2(calc);
    renderFolha3(calc);
    renderRotulo(calc);
    renderCamposDerivados(calc);
    salvar();

    const cartao = input.closest('.ing-card');
    const linha = calc.linhas.find((l) => l.item.uid === item.uid);
    if (cartao && linha) {
      const kcal = (linha.alimento.por100g.kcal * quantNutricional(item)) / 100;
      cartao.querySelector('.ing-chips').innerHTML = [
        linha.ic ? `<span class="chip">IC ${formatar(linha.ic, 2)}</span>` : '',
        linha.fc ? `<span class="chip">FC ${formatar(linha.fc, 2)}</span>` : '',
        linha.cb ? `<span class="chip">CB R$ ${formatar(linha.cb, 2)}</span>` : '',
        `<span class="chip chip-kcal">${formatar(Math.round(kcal), 0)} kcal</span>`
      ].filter(Boolean).join('');

      const campoMedida = cartao.querySelector('input[data-prop="medidaCaseira"]');
      if (campoMedida && !item.medidaManual && document.activeElement !== campoMedida) {
        campoMedida.value = item.medidaCaseira;
      }
    }
  });

  // Confirmação em dois toques no próprio botão.
  //
  // Antes isto usava window.confirm(). Não dá: em PWA instalado e em vários
  // navegadores o diálogo nativo é suprimido e a chamada devolve false na hora,
  // então o botão não fazia absolutamente nada — sem erro, sem aviso.
  el.limparTudo.addEventListener('click', () => {
    if (!temporizadorLimpar) {
      el.limparTudo.textContent = 'Confirmar?';
      el.limparTudo.classList.add('confirmando');
      temporizadorLimpar = setTimeout(resetarBotaoLimpar, 4000);
      return;
    }
    const quantos = estado.ingredientes.length;
    resetarBotaoLimpar();
    estado.ingredientes = [];
    atualizarTudo();
    toast(`${quantos} ingrediente${quantos === 1 ? '' : 's'} removido${quantos === 1 ? '' : 's'}.`);
  });

  // — Campos de texto da ficha —
  $$('[data-campo]').forEach((input) => {
    input.addEventListener('input', () => {
      estado.ficha[input.dataset.campo] = input.value;
      atualizarTudo();
    });
  });

  // Per capita não é armazenado: digitar aqui recalcula o nº de porções.
  el.percapita.addEventListener('input', () => {
    const alvo = paraNumero(el.percapita.value);
    if (alvo <= 0) return;
    const calc = calcular();
    if (calc.rendimento <= 0) return;
    const porcoes = calc.rendimento / alvo;
    estado.ficha.porcoes = String(Math.round(porcoes * 100) / 100).replace('.', ',');
    const campoPorcoes = document.querySelector('[data-campo="porcoes"]');
    if (campoPorcoes) campoPorcoes.value = estado.ficha.porcoes;
    atualizarTudo();
  });
  el.percapita.addEventListener('blur', () => atualizarTudo());

  $$('input[name="dificuldade"]').forEach((r) => {
    r.addEventListener('change', () => {
      estado.ficha.dificuldade = r.value;
      atualizarTudo();
    });
  });

  // — Ações —
  $('#btn-imprimir-ficha').addEventListener('click', () => window.print());
  $('#btn-copiar-ficha').addEventListener('click', () => copiar(fichaComoTexto(), 'Ficha técnica copiada.'));
  $('#btn-imprimir').addEventListener('click', () => window.print());
  $('#btn-copiar').addEventListener('click', () => copiar(rotuloComoTexto(), 'Tabela copiada.'));
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

    /* Atualização automática.

       Quando uma versão nova é publicada, o service worker novo instala e
       assume o controle — mas a página aberta continua rodando o código
       velho, e o usuário só via a correção se abrisse o app uma segunda vez.
       No celular isso passa despercebido: parece que a correção não saiu.

       Ao trocar de controlador, recarregamos uma vez.

       A primeira posse não conta: numa visita inicial a página carrega sem
       controlador e o clients.claim() dispara um controllerchange que não
       significa versão nova — os arquivos vieram da rede agora mesmo. Por isso
       `jaControlado` é atualizado dentro do próprio listener, e não lido uma
       única vez na inicialização: se fosse fixo, uma página que começou sem
       controlador nunca mais recarregaria em atualização nenhuma. */
    let jaControlado = !!navigator.serviceWorker.controller;
    let recarregando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!jaControlado) { jaControlado = true; return; }
      if (recarregando) return;
      recarregando = true;
      window.location.reload();
    });
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
    $('#ft-corpo').innerHTML =
      '<tr><td colspan="10">Não foi possível carregar data/taco.json. ' +
      'Abra o app por um servidor HTTP (veja o README), não por file://.</td></tr>';
    console.error('Falha ao carregar a base TACO:', erro);
    throw erro;
  }

  restaurar();
  ligarEventos();
  trocarAba('montar');
  atualizarTudo();
  ligarPWA();
}

/* ============================================================
   FichaTool — interface pública da ferramenta

   É por aqui que a camada de pacientes (js/ficha-paciente.js) lê e
   escreve o conteúdo da ficha. Existe para que aquela camada não
   precise mexer em `estado` nem conhecer o funcionamento interno —
   quando o backend entrar, só ela muda.
   ============================================================ */

const ouvintesMudanca = [];

function notificarMudanca() {
  for (const fn of ouvintesMudanca) {
    try { fn(); } catch (e) { console.error(e); }
  }
}

const FichaTool = {
  /** Promise que resolve quando a base carregou e a tela está montada. */
  pronto: iniciar(),

  /** true se havia rascunho salvo para este contexto ao abrir a página. */
  tinhaRascunho: false,

  /** Conteúdo completo, no formato guardado no prontuário. */
  exportar() {
    return {
      ficha: Object.assign({}, estado.ficha),
      ingredientes: estado.ingredientes.map((i) => ({
        foodId: i.foodId, pb: i.pb, plIn: i.plIn, plFin: i.plFin,
        ir: i.ir, precoKg: i.precoKg,
        medidaCaseira: i.medidaCaseira, medidaManual: i.medidaManual
      }))
    };
  },

  /** Substitui o conteúdo da tela. Ingredientes que sumiram da base são ignorados. */
  importar(dados) {
    if (!dados) return;
    Object.assign(estado.ficha, dados.ficha || {});
    estado.ingredientes = (dados.ingredientes || []).reduce((acc, i) => {
      if (!estado.porId.has(i.foodId)) return acc;
      acc.push({
        uid: proximoUid++,
        foodId: i.foodId,
        pb: paraNumero(i.pb),
        plIn: paraNumero(i.plIn),
        plFin: paraNumero(i.plFin),
        ir: paraNumero(i.ir),
        precoKg: paraNumero(i.precoKg),
        medidaCaseira: i.medidaCaseira || '',
        medidaManual: !!i.medidaManual
      });
      return acc;
    }, []);
    refletirFichaNosCampos();
    atualizarTudo();
  },

  /** Números já calculados, para a listagem de fichas não refazer as contas. */
  resumo() {
    const calc = calcular();
    return {
      kcalPorcao: calc.kcalPorcao,
      porcoes: calc.porcoes,
      rendimento: calc.rendimento,
      ingredientes: calc.linhas.length
    };
  },

  /** Nome da preparação, usado como título da ficha salva. */
  titulo() {
    return estado.ficha.nome || '';
  },

  vazia() {
    return estado.ingredientes.length === 0 && !estado.ficha.nome;
  },

  /** Registra um callback disparado a cada alteração do conteúdo. */
  aoMudar(fn) {
    if (typeof fn === 'function') ouvintesMudanca.push(fn);
  }
};

