/* ============================================================
   plano.js — montagem do plano alimentar

   Reaproveita TacoBase (js/taco.js) para busca e soma de nutrientes,
   que é o mesmo módulo usado pela ficha técnica — os dois cálculos não
   podem divergir.

   URL:
     plano.html?paciente=ID            → plano novo
     plano.html?paciente=ID&plano=PID  → abre um plano salvo
   ============================================================ */

'use strict';

(async () => {

  if (!(await Auth.exigirLogin())) return;
  await Shell.montarCabecalho('pacientes');

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = Shell.escapar;

  const params = new URLSearchParams(location.search);
  const pacienteId = params.get('paciente') || '';
  let planoId = params.get('plano') || '';

  function falhar(texto) {
    $('#erro-texto').textContent = texto;
    $('#erro-carga').hidden = false;
    $('#barra-paciente').hidden = true;
  }

  const paciente = pacienteId ? await PacientesStore.obterPaciente(pacienteId) : null;
  if (!paciente) {
    falhar('Plano alimentar precisa de um paciente. Abra pelo prontuário.');
    return;
  }

  try {
    await TacoBase.carregar();
  } catch (e) {
    falhar('Não foi possível carregar a base TACO. Verifique a conexão e recarregue.');
    return;
  }

  $('#conteudo').hidden = false;
  $('#bp-avatar').textContent = Shell.iniciais(paciente.nome);
  $('#bp-link').textContent = paciente.nome;
  $('#bp-link').href = 'paciente.html?id=' + encodeURIComponent(paciente.id);

  /* ───────────── Estado ───────────── */

  let plano = null;
  let metas = null;
  let alterado = false;

  const n0 = (v) => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('pt-BR'));
  const n1 = (v) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const num = (v) => {
    const n = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/[^0-9.]/g, ''));
    return isFinite(n) && n >= 0 ? n : null;
  };

  function marcarAlterado() {
    if (alterado) return;
    alterado = true;
    $('#bp-alteracoes').hidden = false;
  }

  /* ───────────── Carga ───────────── */

  if (planoId) {
    plano = await PlanosStore.obterPlano(planoId);
    if (!plano) {
      Shell.toast('Plano não encontrado. Criando um novo.');
      planoId = '';
    }
  }
  if (!plano) {
    plano = {
      pacienteId: paciente.id,
      nome: '',
      data: new Date().toISOString().slice(0, 10),
      observacoes: '',
      refeicoes: PlanosStore.refeicoesPadrao()
    };
  }

  metas = await PlanosStore.obterMetas(paciente.id) ||
    Object.assign({ pacienteId: paciente.id, pesoMeta: '', kcalMeta: '', observacoes: '' },
      { pctProteina: String(PlanosStore.MACROS_PADRAO.pctProteina),
        pctCarboidrato: String(PlanosStore.MACROS_PADRAO.pctCarboidrato),
        pctLipidio: String(PlanosStore.MACROS_PADRAO.pctLipidio) });

  $('#pl-nome').value = plano.nome;
  $('#pl-data').value = plano.data;
  $('#pl-observacoes').value = plano.observacoes;
  $$('[data-meta]').forEach((i) => { i.value = metas[i.dataset.meta] || ''; });

  function atualizarBarra() {
    $('#bp-estado').textContent = planoId
      ? 'Plano salvo em ' + Shell.formatarDataHora(plano.atualizadoEm)
      : 'Novo plano';
    $('#btn-salvar').textContent = planoId ? 'Salvar alterações' : 'Salvar plano';
  }

  /* ───────────── Cálculo ───────────── */

  /** Soma de uma refeição e do dia inteiro, usando o mesmo motor da ficha. */
  function calcular() {
    const porRefeicao = plano.refeicoes.map((r) => TacoBase.somar(r.itens));
    const todosItens = plano.refeicoes.flatMap((r) => r.itens);
    const dia = TacoBase.somar(todosItens);
    return { porRefeicao, dia };
  }

  /* ───────────── Metas ───────────── */

  function lerMetasDoFormulario() {
    const dados = {};
    $$('[data-meta]').forEach((i) => { dados[i.dataset.meta] = i.value; });
    return dados;
  }

  async function ultimaAvaliacao() {
    const lista = await ProntuarioStore.listarAvaliacoes(paciente.id);
    return lista[0] || null;
  }

  function desenharMetas() {
    Object.assign(metas, lerMetasDoFormulario());

    const emGramas = PlanosStore.metasEmGramas(metas);
    const soma = emGramas ? emGramas.soma : null;

    const campoSoma = $('#m-soma');
    if (emGramas) {
      campoSoma.value = n0(soma) + '%';
      campoSoma.classList.toggle('valor-invalido', Math.abs(soma - 100) > 0.5);
    } else {
      campoSoma.value = '—';
      campoSoma.classList.remove('valor-invalido');
    }

    const alvo = $('#metas-resultado');
    if (!emGramas) {
      alvo.innerHTML = '<p class="dica">Defina a meta calórica para ver os gramas de cada macronutriente.</p>';
      return;
    }

    const aviso = Math.abs(soma - 100) > 0.5
      ? `<p class="aviso-inline">A soma dos percentuais está em ${n1(soma)}%. Ajuste para 100% —
         os gramas abaixo são calculados sobre a meta calórica, então uma soma diferente de 100%
         não corresponde ao total do dia.</p>`
      : '';

    alvo.innerHTML = aviso + `
      <dl class="lista-resultados">
        <div><dt>Meta calórica</dt><dd>${n0(emGramas.kcal)} kcal/dia</dd></div>
        <div><dt>Proteínas</dt><dd>${n0(emGramas.proteinas.gramas)} g <span class="ref">${n0(emGramas.proteinas.pct)}%</span></dd></div>
        <div><dt>Carboidratos</dt><dd>${n0(emGramas.carboidratos.gramas)} g <span class="ref">${n0(emGramas.carboidratos.pct)}%</span></dd></div>
        <div><dt>Lipídios</dt><dd>${n0(emGramas.gordurasTotais.gramas)} g <span class="ref">${n0(emGramas.gordurasTotais.pct)}%</span></dd></div>
      </dl>`;
  }

  async function desenharDicasMeta() {
    const av = await ultimaAvaliacao();
    const pesoAtual = av ? Antropometria.num(av.peso) : null;
    const pesoMeta = num(metas.pesoMeta);

    if (pesoAtual != null && pesoMeta != null) {
      const d = pesoMeta - pesoAtual;
      const texto = Math.abs(d) < 0.05
        ? 'Igual ao peso atual.'
        : `${n1(Math.abs(d))} kg ${d < 0 ? 'abaixo' : 'acima'} do peso atual (${n1(pesoAtual)} kg em ${Shell.formatarData(av.data)}).`;
      $('#dica-peso').textContent = texto;
    } else if (pesoAtual != null) {
      $('#dica-peso').textContent = `Peso atual: ${n1(pesoAtual)} kg (${Shell.formatarData(av.data)}).`;
    } else {
      $('#dica-peso').textContent = 'Sem avaliação antropométrica registrada.';
    }
  }

  $$('[data-meta]').forEach((i) => i.addEventListener('input', () => {
    desenharMetas();
    desenharTotal();
    desenharDicasMeta();
    marcarAlterado();
  }));

  /* Sugestão de meta calórica a partir da última avaliação. */
  $('#btn-sugerir').addEventListener('click', async () => {
    const av = await ultimaAvaliacao();
    if (!av) { Shell.toast('Registre uma avaliação antropométrica primeiro.'); return; }
    if (!paciente.sexo) { Shell.toast('Informe o sexo do paciente no cadastro — a equação depende dele.'); return; }

    const idade = Antropometria.idadeNaData(paciente.nascimento, av.data);
    const tmb = Antropometria.tmb(av.peso, av.altura, idade, paciente.sexo);
    if (tmb == null) { Shell.toast('Faltam peso, altura ou data de nascimento.'); return; }

    const opcoes = Antropometria.FATORES_ATIVIDADE
      .map((f, i) => `${i + 1}) ${f.rotulo} — ${n0(tmb * f.valor)} kcal`).join('\n');

    // Escolha por lista simples, sem depender de prompt nativo.
    const escolha = await escolherFator(tmb, opcoes);
    if (escolha == null) return;

    $('#m-kcal').value = String(Math.round(tmb * escolha));
    desenharMetas();
    desenharTotal();
    marcarAlterado();
    Shell.toast('Meta calórica sugerida. Ajuste como preferir.');
  });

  /** Diálogo simples de escolha do fator de atividade. */
  function escolherFator(tmb) {
    return new Promise((resolver) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'dialogo';
      dlg.innerHTML = `
        <div class="dialogo-topo">
          <h2>Nível de atividade física</h2>
        </div>
        <div class="dialogo-corpo">
          <p class="dica">
            Taxa metabólica basal estimada em <strong>${n0(tmb)} kcal/dia</strong>
            pela equação de Mifflin-St Jeor. Escolha o fator de atividade para
            chegar ao gasto energético total.
          </p>
          <div class="lista-opcoes">
            ${Antropometria.FATORES_ATIVIDADE.map((f) => `
              <button type="button" class="opcao-fator" data-fator="${f.valor}">
                <span>${esc(f.rotulo)}</span>
                <strong>${n0(tmb * f.valor)} kcal</strong>
              </button>`).join('')}
          </div>
          <p class="dica">
            É uma estimativa por equação preditiva, não uma medida. Serve de ponto
            de partida clínico.
          </p>
        </div>
        <div class="dialogo-acoes">
          <button type="button" class="btn btn-ghost" data-cancelar>Cancelar</button>
        </div>`;
      document.body.appendChild(dlg);

      dlg.addEventListener('click', (ev) => {
        const opcao = ev.target.closest('[data-fator]');
        if (opcao) { dlg.close(); dlg.remove(); resolver(Number(opcao.dataset.fator)); return; }
        if (ev.target.closest('[data-cancelar]')) { dlg.close(); dlg.remove(); resolver(null); }
      });
      dlg.addEventListener('cancel', () => { dlg.remove(); resolver(null); });
      dlg.showModal();
    });
  }

  /* ───────────── Total do dia ───────────── */

  function desenharTotal() {
    const { dia } = calcular();
    const emGramas = PlanosStore.metasEmGramas(metas);
    const t = dia.totais;

    const barra = (rotulo, atual, alvo, unidade, casas) => {
      const temAlvo = alvo != null && alvo > 0;
      const pct = temAlvo ? Math.min(200, (atual / alvo) * 100) : 0;
      const restante = temAlvo ? alvo - atual : null;

      let situacao = '';
      if (temAlvo) {
        const desvio = (atual - alvo) / alvo;
        if (Math.abs(desvio) <= 0.05) situacao = '<span class="tag tag-ok">na meta</span>';
        else if (desvio < 0) situacao = `<span class="tag tag-atencao">faltam ${casas ? n1(restante) : n0(restante)} ${unidade}</span>`;
        else situacao = `<span class="tag tag-alto">${casas ? n1(-restante) : n0(-restante)} ${unidade} acima</span>`;
      }

      return `
        <div class="barra-meta">
          <div class="barra-meta-topo">
            <span class="metrica-rotulo">${rotulo}</span>
            <span class="barra-meta-valor">
              <strong>${casas ? n1(atual) : n0(atual)}</strong>${temAlvo ? ' / ' + (casas ? n1(alvo) : n0(alvo)) : ''} ${unidade}
            </span>
          </div>
          ${temAlvo ? `<div class="barra-trilho"><span class="barra-preenchida ${pct > 105 ? 'passou' : ''}" style="width:${Math.min(100, pct)}%"></span></div>` : ''}
          ${situacao}
        </div>`;
    };

    const itens = plano.refeicoes.reduce((soma, r) => soma + r.itens.length, 0);

    $('#painel-total').innerHTML = `
      <p class="dica">${itens} ${itens === 1 ? 'alimento' : 'alimentos'} em
         ${plano.refeicoes.length} ${plano.refeicoes.length === 1 ? 'refeição' : 'refeições'}
         · peso total ${n0(dia.peso)} g</p>
      <div class="grade-barras">
        ${barra('Energia', t.kcal, emGramas ? emGramas.kcal : null, 'kcal', false)}
        ${barra('Proteínas', t.proteinas, emGramas ? emGramas.proteinas.gramas : null, 'g', true)}
        ${barra('Carboidratos', t.carboidratos, emGramas ? emGramas.carboidratos.gramas : null, 'g', true)}
        ${barra('Lipídios', t.gordurasTotais, emGramas ? emGramas.gordurasTotais.gramas : null, 'g', true)}
      </div>
      <dl class="lista-resultados lista-extra">
        <div><dt>Fibra alimentar</dt><dd>${n1(t.fibras)} g</dd></div>
        <div><dt>Gorduras saturadas</dt><dd>${n1(t.gordurasSaturadas)} g</dd></div>
        <div><dt>Açúcares totais</dt><dd>${n1(t.acucares)} g</dd></div>
        <div><dt>Sódio</dt><dd>${n0(t.sodio)} mg</dd></div>
      </dl>`;
  }

  /* ───────────── Refeições ───────────── */

  function desenharRefeicoes() {
    const { porRefeicao } = calcular();

    $('#refeicoes').innerHTML = plano.refeicoes.map((r, ri) => {
      const soma = porRefeicao[ri];
      const itens = soma.linhas.map((linha, ii) => `
        <li class="item-alimento">
          <div class="item-info">
            <span class="item-nome">${esc(linha.alimento.nome)}</span>
            <span class="item-detalhe">
              ${n0(linha.gramas)} g${linha.item.medida ? ' · ' + esc(linha.item.medida) : ''}
              · ${n0(linha.valores.kcal)} kcal
              · P ${n1(linha.valores.proteinas)} g
              · C ${n1(linha.valores.carboidratos)} g
              · L ${n1(linha.valores.gordurasTotais)} g
            </span>
          </div>
          <div class="item-acoes naoimprimir">
            <button class="btn-editar" type="button" data-editar-item="${ri}:${ii}" aria-label="Editar ${esc(linha.alimento.nome)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
              </svg>
            </button>
            <button class="btn-remover-ficha" type="button" data-remover-item="${ri}:${ii}" aria-label="Remover ${esc(linha.alimento.nome)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                <path d="M5 5l14 14M19 5L5 19"/>
              </svg>
            </button>
          </div>
        </li>`).join('');

      return `
        <div class="card card-refeicao">
          <div class="refeicao-topo">
            <div class="refeicao-identidade">
              <input class="input-refeicao-nome" type="text" value="${esc(r.nome)}"
                     data-nome-refeicao="${ri}" aria-label="Nome da refeição" maxlength="60">
              <input class="input-refeicao-hora" type="time" value="${esc(r.horario)}"
                     data-hora-refeicao="${ri}" aria-label="Horário">
            </div>
            <div class="refeicao-resumo">
              <span class="chip chip-kcal">${n0(soma.totais.kcal)} kcal</span>
              <button class="btn-remover-ficha naoimprimir" type="button" data-remover-refeicao="${ri}"
                      aria-label="Remover refeição ${esc(r.nome)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                  <path d="M5 5l14 14M19 5L5 19"/>
                </svg>
              </button>
            </div>
          </div>

          <ul class="lista-alimentos">${itens}</ul>
          ${soma.linhas.length === 0 ? '<p class="empty empty-refeicao">Nenhum alimento nesta refeição.</p>' : ''}

          ${soma.linhas.length ? `
            <p class="refeicao-macros">
              P ${n1(soma.totais.proteinas)} g · C ${n1(soma.totais.carboidratos)} g
              · L ${n1(soma.totais.gordurasTotais)} g · Fibra ${n1(soma.totais.fibras)} g
            </p>` : ''}

          <input class="input input-obs-refeicao naoimprimir" type="text" value="${esc(r.observacoes)}"
                 data-obs-refeicao="${ri}" placeholder="Observação desta refeição" maxlength="300">

          <button class="btn btn-ghost btn-sm naoimprimir" type="button" data-add-alimento="${ri}">
            + Adicionar alimento
          </button>
        </div>`;
    }).join('');
  }

  function redesenhar() {
    desenharRefeicoes();
    desenharTotal();
    atualizarBarra();
  }

  /* ── Edição inline das refeições ── */

  $('#refeicoes').addEventListener('input', (ev) => {
    const nome = ev.target.closest('[data-nome-refeicao]');
    if (nome) { plano.refeicoes[+nome.dataset.nomeRefeicao].nome = nome.value; marcarAlterado(); return; }

    const hora = ev.target.closest('[data-hora-refeicao]');
    if (hora) { plano.refeicoes[+hora.dataset.horaRefeicao].horario = hora.value; marcarAlterado(); return; }

    const obs = ev.target.closest('[data-obs-refeicao]');
    if (obs) { plano.refeicoes[+obs.dataset.obsRefeicao].observacoes = obs.value; marcarAlterado(); }
  });

  $('#refeicoes').addEventListener('click', async (ev) => {
    const add = ev.target.closest('[data-add-alimento]');
    if (add) { abrirDialogoAlimento(+add.dataset.addAlimento, null); return; }

    const editar = ev.target.closest('[data-editar-item]');
    if (editar) {
      const [ri, ii] = editar.dataset.editarItem.split(':').map(Number);
      abrirDialogoAlimento(ri, ii);
      return;
    }

    const remover = ev.target.closest('[data-remover-item]');
    if (remover) {
      const [ri, ii] = remover.dataset.removerItem.split(':').map(Number);
      plano.refeicoes[ri].itens.splice(ii, 1);
      marcarAlterado();
      redesenhar();
      return;
    }

    // Remover refeição inteira: dois toques, como no resto do sistema.
    const removerRef = ev.target.closest('[data-remover-refeicao]');
    if (!removerRef) return;

    if (removerRef.dataset.armado === 'sim') {
      plano.refeicoes.splice(+removerRef.dataset.removerRefeicao, 1);
      marcarAlterado();
      redesenhar();
      return;
    }
    removerRef.dataset.armado = 'sim';
    removerRef.classList.add('confirmando');
    setTimeout(() => {
      if (!removerRef.isConnected) return;
      removerRef.dataset.armado = '';
      removerRef.classList.remove('confirmando');
    }, 4000);
  });

  $('#btn-nova-refeicao').addEventListener('click', () => {
    plano.refeicoes.push({
      id: 'r_' + Date.now().toString(36),
      nome: 'Nova refeição', horario: '', observacoes: '', itens: []
    });
    marcarAlterado();
    redesenhar();
  });

  /* ───────────── Diálogo de alimento ───────────── */

  const dlgAlimento = $('#dialogo-alimento');
  let selecionado = null;
  let indiceSugestao = -1;
  let sugestoes = [];

  function fecharSugestoes() {
    $('#sugestoes').hidden = true;
    $('#sugestoes').innerHTML = '';
    sugestoes = [];
    indiceSugestao = -1;
  }

  function renderSugestoes(termo) {
    sugestoes = TacoBase.buscar(termo, 10);
    indiceSugestao = -1;
    if (!termo.trim()) { fecharSugestoes(); return; }

    $('#sugestoes').innerHTML = sugestoes.length
      ? sugestoes.map((a, i) => `
          <li class="sugestao" role="option" data-idx="${i}" aria-selected="false">
            <span class="sugestao-nome">${TacoBase.destacar(a.nome, termo)}
              <span class="sugestao-cat">${esc(a.categoria)}</span>
            </span>
            <span class="sugestao-kcal">${n0(a.por100g.kcal)} kcal<br>/100 g</span>
          </li>`).join('')
      : `<li class="sugestoes-vazio">Nenhum alimento encontrado para “${esc(termo)}”.</li>`;
    $('#sugestoes').hidden = false;
  }

  function escolherAlimento(alimento) {
    selecionado = alimento;
    fecharSugestoes();
    $('#busca').value = alimento.nome;
    $('#al-escolhido').textContent = alimento.categoria + ' · ' +
      n0(alimento.por100g.kcal) + ' kcal por 100 g';

    const medidas = alimento.medidas || [];
    $('#al-medida').innerHTML = '<option value="g">gramas (g)</option>' +
      medidas.map((m, i) => `<option value="${i}">${esc(m.nome)} (${n0(m.gramas)} g)</option>`).join('');
    $('#al-medida').value = 'g';
    atualizarPrevia();
    $('#al-quantidade').focus();
    $('#al-quantidade').select();
  }

  function gramasDoDialogo() {
    const valor = num($('#al-quantidade').value) || 0;
    const sel = $('#al-medida').value;
    if (sel === 'g' || !selecionado) return valor;
    const medida = (selecionado.medidas || [])[Number(sel)];
    return medida ? valor * medida.gramas : valor;
  }

  function textoMedida() {
    const sel = $('#al-medida').value;
    if (sel === 'g' || !selecionado) return '';
    const medida = (selecionado.medidas || [])[Number(sel)];
    if (!medida) return '';
    const q = num($('#al-quantidade').value) || 0;
    return `${n1(q)} × ${medida.nome.toLowerCase()}`;
  }

  function atualizarPrevia() {
    if (!selecionado) {
      $('#al-previa').innerHTML = '<p class="dica">Escolha um alimento para ver os valores.</p>';
      return;
    }
    const gramas = gramasDoDialogo();
    const v = TacoBase.nutrientesDe(selecionado.id, gramas);
    $('#al-previa').innerHTML = `
      <dl class="lista-resultados">
        <div><dt>Quantidade</dt><dd>${n0(gramas)} g</dd></div>
        <div><dt>Energia</dt><dd>${n0(v.kcal)} kcal</dd></div>
        <div><dt>Proteínas</dt><dd>${n1(v.proteinas)} g</dd></div>
        <div><dt>Carboidratos</dt><dd>${n1(v.carboidratos)} g</dd></div>
        <div><dt>Lipídios</dt><dd>${n1(v.gordurasTotais)} g</dd></div>
        <div><dt>Fibra</dt><dd>${n1(v.fibras)} g</dd></div>
      </dl>`;
  }

  $('#busca').addEventListener('input', () => { selecionado = null; renderSugestoes($('#busca').value); atualizarPrevia(); });
  $('#busca').addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!sugestoes.length) return;
      indiceSugestao = (indiceSugestao + (ev.key === 'ArrowDown' ? 1 : -1) + sugestoes.length) % sugestoes.length;
      $$('#sugestoes .sugestao').forEach((li, i) => li.setAttribute('aria-selected', String(i === indiceSugestao)));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const alimento = sugestoes[indiceSugestao >= 0 ? indiceSugestao : 0];
      if (alimento) escolherAlimento(alimento);
    } else if (ev.key === 'Escape') {
      fecharSugestoes();
    }
  });
  $('#sugestoes').addEventListener('mousedown', (ev) => {
    const li = ev.target.closest('.sugestao');
    if (!li) return;
    ev.preventDefault();
    escolherAlimento(sugestoes[+li.dataset.idx]);
  });

  $('#al-quantidade').addEventListener('input', atualizarPrevia);
  $('#al-medida').addEventListener('change', () => {
    $('#al-quantidade').value = $('#al-medida').value === 'g' ? '100' : '1';
    atualizarPrevia();
  });

  function abrirDialogoAlimento(refeicaoIndice, itemIndice) {
    const refeicao = plano.refeicoes[refeicaoIndice];
    $('#al-refeicao').value = refeicaoIndice;
    $('#al-indice').value = itemIndice == null ? '' : itemIndice;
    $('#al-refeicao-nome').value = refeicao.nome;
    $('#titulo-alimento').textContent = itemIndice == null ? 'Adicionar alimento' : 'Editar alimento';
    $('#confirmar-alimento').textContent = itemIndice == null ? 'Adicionar' : 'Salvar';
    $('#erro-alimento').hidden = true;
    fecharSugestoes();

    if (itemIndice == null) {
      selecionado = null;
      $('#busca').value = '';
      $('#al-escolhido').textContent = 'Nenhum alimento selecionado.';
      $('#al-quantidade').value = '100';
      $('#al-medida').innerHTML = '<option value="g">gramas (g)</option>';
      atualizarPrevia();
      dlgAlimento.showModal();
      $('#busca').focus();
    } else {
      const item = refeicao.itens[itemIndice];
      const alimento = TacoBase.obter(item.foodId);
      dlgAlimento.showModal();
      if (alimento) {
        escolherAlimento(alimento);
        $('#al-medida').value = 'g';
        $('#al-quantidade').value = String(item.gramas);
        atualizarPrevia();
      }
    }
  }

  $('#cancelar-alimento').addEventListener('click', () => dlgAlimento.close());
  $('#fechar-alimento').addEventListener('click', () => dlgAlimento.close());

  $('#form-alimento').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const erro = $('#erro-alimento');

    if (!selecionado) {
      erro.textContent = 'Escolha um alimento na busca.';
      erro.hidden = false;
      return;
    }
    const gramas = gramasDoDialogo();
    if (gramas <= 0) {
      erro.textContent = 'Informe uma quantidade maior que zero.';
      erro.hidden = false;
      return;
    }

    const ri = +$('#al-refeicao').value;
    const ii = $('#al-indice').value === '' ? null : +$('#al-indice').value;
    const registro = { foodId: selecionado.id, gramas, medida: textoMedida() };

    if (ii == null) plano.refeicoes[ri].itens.push(registro);
    else plano.refeicoes[ri].itens[ii] = registro;

    dlgAlimento.close();
    marcarAlterado();
    redesenhar();
  });

  /* ───────────── Salvar ───────────── */

  $('#pl-nome').addEventListener('input', () => { plano.nome = $('#pl-nome').value; marcarAlterado(); });
  $('#pl-data').addEventListener('input', () => { plano.data = $('#pl-data').value; marcarAlterado(); });
  $('#pl-observacoes').addEventListener('input', () => { plano.observacoes = $('#pl-observacoes').value; marcarAlterado(); });

  $('#btn-salvar').addEventListener('click', async () => {
    const totalItens = plano.refeicoes.reduce((s, r) => s + r.itens.length, 0);
    if (totalItens === 0 && !plano.nome.trim()) {
      Shell.toast('Dê um nome ao plano ou adicione um alimento antes de salvar.');
      return;
    }

    $('#btn-salvar').disabled = true;

    await PlanosStore.salvarMetas(paciente.id, lerMetasDoFormulario());

    const { dia } = calcular();
    const resultado = await PlanosStore.salvarPlano(Object.assign({}, plano, {
      id: planoId || undefined,
      resumo: {
        kcal: dia.totais.kcal,
        proteinas: dia.totais.proteinas,
        carboidratos: dia.totais.carboidratos,
        gordurasTotais: dia.totais.gordurasTotais,
        itens: totalItens,
        refeicoes: plano.refeicoes.length
      }
    }));

    $('#btn-salvar').disabled = false;

    if (!resultado.ok) { Shell.toast(resultado.erro); return; }

    const eraNovo = !planoId;
    plano = resultado.plano;
    planoId = resultado.plano.id;
    alterado = false;
    $('#bp-alteracoes').hidden = true;
    atualizarBarra();
    Shell.toast(eraNovo ? 'Plano salvo.' : 'Alterações salvas.');

    if (eraNovo) {
      history.replaceState(null, '',
        'plano.html?paciente=' + encodeURIComponent(paciente.id) +
        '&plano=' + encodeURIComponent(planoId));
    }
  });

  $('#btn-imprimir').addEventListener('click', () => window.print());

  window.addEventListener('beforeunload', (ev) => {
    if (!alterado) return;
    ev.preventDefault();
    ev.returnValue = '';
  });

  /* ───────────── Início ───────────── */

  desenharMetas();
  await desenharDicasMeta();
  redesenhar();
  alterado = false;
  $('#bp-alteracoes').hidden = true;
})();
