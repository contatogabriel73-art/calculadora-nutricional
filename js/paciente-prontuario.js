/* ============================================================
   paciente-prontuario.js — a tela do paciente

   Junta num só lugar: dados cadastrais, anamnese, avaliações
   antropométricas, fichas técnicas e a linha do tempo.

   Só orquestra. Os cálculos vivem em antropometria.js e a
   persistência nos módulos *-storage.js.
   ============================================================ */

'use strict';

(async () => {

  if (!(await Auth.exigirLogin())) return;
  await Shell.montarCabecalho('pacientes');

  const id = new URLSearchParams(location.search).get('id') || '';
  let paciente = await PacientesStore.obterPaciente(id);

  if (!paciente) {
    document.querySelector('#nao-encontrado').hidden = false;
    return;
  }
  document.querySelector('#conteudo').hidden = false;

  // Catálogo de tipos de dieta, só pra rotular o chip na lista de planos
  // — não é crítico, então não trava a tela esperando (ver uso em
  // recarregarPlanos()).
  TiposDieta.carregar().catch(() => {});

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = Shell.escapar;

  const SEXO_TEXTO = { F: 'Feminino', M: 'Masculino', '': 'Não informado' };

  let anamnese = null;
  let avaliacoes = [];
  let fichas = [];
  let consultas = [];

  /* ───────────── Abas ───────────── */

  function trocarAba(nome) {
    $$('.aba-p').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.aba === nome)));
    $$('.painel-p').forEach((p) => { p.hidden = p.id !== 'p-' + nome; });
  }
  $$('.aba-p').forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.aba)));

  /* ───────────── Formatação ───────────── */

  const n1 = (v) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const n2 = (v) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  /** Variação entre duas medidas, já com sinal e cor. */
  function delta(atual, anterior, casas) {
    if (atual == null || anterior == null || !isFinite(atual) || !isFinite(anterior)) return '';
    const d = atual - anterior;
    if (Math.abs(d) < 0.05) return '<span class="delta delta-igual">estável</span>';
    const sinal = d > 0 ? '+' : '−';
    const texto = sinal + Math.abs(d).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
    return `<span class="delta ${d > 0 ? 'delta-sobe' : 'delta-desce'}">${texto}</span>`;
  }

  /* ───────────── Cabeçalho ───────────── */

  function desenharPaciente() {
    const idade = Shell.calcularIdade(paciente.nascimento);
    document.title = paciente.nome + ' — NutriBloom';
    $('#avatar').textContent = Shell.iniciais(paciente.nome);
    $('#nome').textContent = paciente.nome;
    $('#subtitulo').textContent = [
      idade !== null ? idade + ' anos' : 'Idade não informada',
      SEXO_TEXTO[paciente.sexo || '']
    ].join(' · ');

    $('#d-nascimento').textContent = Shell.formatarData(paciente.nascimento) || '—';
    $('#d-sexo').textContent = SEXO_TEXTO[paciente.sexo || ''];
    $('#d-telefone').textContent = paciente.telefone || '—';
    $('#d-email').textContent = paciente.email || '—';
    $('#d-observacoes').textContent = paciente.observacoes || '—';

    $('#btn-nova-ficha').href = 'ficha.html?paciente=' + encodeURIComponent(paciente.id);
    $('#btn-novo-plano').href = 'plano.html?paciente=' + encodeURIComponent(paciente.id);
  }

  /* ───────────── Vínculo com a conta do paciente ───────────── */

  function desenharVinculo() {
    const alvo = $('#vinculo-conteudo');

    if (paciente.usuarioId) {
      alvo.innerHTML = `
        <p class="vinculo-status vinculo-ativo">
          ✓ Este paciente já tem conta própria e acompanha a evolução dele
          nesta plataforma.
        </p>`;
      return;
    }

    // Sem conta e sem código gerado ainda: mostra a explicação e as
    // opções. Um código já gerado (mas ainda não usado) fica visível de
    // novo — reabrir a tela não deveria trocar o código que a pessoa já
    // anotou. O convite por e-mail só aparece com e-mail cadastrado —
    // sem e-mail, o código manual é o único caminho mesmo.
    const codigo = esc(paciente.codigoConvite || '');
    const temEmail = !!paciente.email;
    alvo.innerHTML = `
      ${temEmail ? `
        <p class="dica">
          Manda um convite direto para <strong>${esc(paciente.email)}</strong> — o paciente
          clica no link do e-mail, cria a senha e já entra vinculado a esta ficha, sem
          precisar digitar código nenhum.
        </p>
        <button id="btn-convidar-email" class="btn btn-primary btn-sm" type="button">
          Enviar acesso por e-mail
        </button>
        <p class="dica">Prefere o código manual? Use a opção abaixo.</p>
      ` : `
        <p class="dica">
          Cadastre um e-mail na ficha para enviar o acesso automaticamente, ou passe o
          código abaixo para o paciente digitar na conta dele.
        </p>
      `}
      ${codigo ? `
        <div class="codigo-convite">
          <span class="codigo-convite-valor">${codigo}</span>
          <button id="btn-copiar-codigo" class="btn btn-ghost btn-sm" type="button">Copiar</button>
        </div>
        <p class="dica">Ainda não usado. Gerar de novo não é necessário.</p>
      ` : `
        <button id="btn-gerar-codigo" class="btn btn-ghost btn-sm" type="button">Gerar código de convite</button>
      `}
      <p id="vinculo-erro" class="erro-form" role="alert" hidden></p>`;

    const btnConvidar = $('#btn-convidar-email');
    if (btnConvidar) {
      btnConvidar.addEventListener('click', async () => {
        btnConvidar.disabled = true;
        btnConvidar.textContent = 'Enviando…';
        const r = await VinculoStore.convidarPorEmail(paciente.id);
        btnConvidar.disabled = false;
        btnConvidar.textContent = 'Enviar acesso por e-mail';
        if (!r.ok) {
          const erro = $('#vinculo-erro');
          erro.textContent = r.erro;
          erro.hidden = false;
          return;
        }
        Shell.toast(`Convite enviado para ${r.email}.`);
        paciente.usuarioId = true; // só pra desenharVinculo() já mostrar o estado vinculado
        desenharVinculo();
      });
    }

    const btnGerar = $('#btn-gerar-codigo');
    if (btnGerar) {
      btnGerar.addEventListener('click', async () => {
        btnGerar.disabled = true;
        btnGerar.textContent = 'Gerando…';
        const r = await VinculoStore.gerarCodigoConvite(paciente.id);
        if (!r.ok) {
          const erro = $('#vinculo-erro');
          erro.textContent = r.erro;
          erro.hidden = false;
          btnGerar.disabled = false;
          btnGerar.textContent = 'Gerar código de convite';
          return;
        }
        paciente.codigoConvite = r.codigo;
        desenharVinculo();
      });
    }

    const btnCopiar = $('#btn-copiar-codigo');
    if (btnCopiar) {
      btnCopiar.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(codigo);
          Shell.toast('Código copiado.');
        } catch (e) {
          Shell.toast('Não foi possível copiar. Selecione o código manualmente.');
        }
      });
    }
  }

  /* ───────────── Resumo ───────────── */

  function desenharResumo() {
    const alvo = $('#resumo-medidas');

    if (!avaliacoes.length) {
      alvo.innerHTML = `
        <p class="empty">
          Nenhuma medição registrada.<br>
          Abra a aba <strong>Antropometria</strong> para o primeiro registro.
        </p>`;
      return;
    }

    const ultima = avaliacoes[0];
    const anterior = avaliacoes[1] || null;
    const a = Antropometria.analisar(ultima, paciente);
    const b = anterior ? Antropometria.analisar(anterior, paciente) : null;

    const cartao = (rotulo, valor, unidade, extra) => `
      <div class="metrica">
        <span class="metrica-rotulo">${rotulo}</span>
        <span class="metrica-valor">${valor}${unidade ? ' <em>' + unidade + '</em>' : ''}</span>
        ${extra ? `<span class="metrica-extra">${extra}</span>` : ''}
      </div>`;

    const peso = Antropometria.num(ultima.peso);
    const pesoAnt = anterior ? Antropometria.num(anterior.peso) : null;
    const cls = a.classificacaoImc;

    alvo.innerHTML = `
      <p class="dica">Medida em ${esc(Shell.formatarData(ultima.data))}${
        anterior ? ' · comparado com ' + esc(Shell.formatarData(anterior.data)) : ''}</p>
      <div class="grade-metricas">
        ${cartao('Peso', n1(peso), 'kg', delta(peso, pesoAnt, 1))}
        ${cartao('IMC', n1(a.imc), 'kg/m²',
          cls ? `<span class="tag tag-${cls.nivel}">${cls.texto}</span>` : delta(a.imc, b && b.imc, 1))}
        ${cartao('% de gordura', a.gordura ? n1(a.gordura.percentual) : '—', a.gordura ? '%' : '',
          a.gordura && b && b.gordura ? delta(a.gordura.percentual, b.gordura.percentual, 1) : '')}
        ${cartao('Massa magra', a.composicao ? n1(a.composicao.massaMagra) : '—', a.composicao ? 'kg' : '',
          a.composicao && b && b.composicao ? delta(a.composicao.massaMagra, b.composicao.massaMagra, 1) : '')}
      </div>`;
  }

  /* ───────────── Anamnese ───────────── */

  async function carregarAnamnese() {
    anamnese = await ProntuarioStore.obterAnamnese(paciente.id);
    $$('[data-anamnese]').forEach((campo) => {
      campo.value = anamnese ? (anamnese[campo.dataset.anamnese] || '') : '';
    });
    $('#anamnese-atualizada').textContent = anamnese
      ? 'Atualizada em ' + Shell.formatarDataHora(anamnese.atualizadoEm)
      : 'Ainda não preenchida';
  }

  $('#form-anamnese').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const dados = {};
    $$('[data-anamnese]').forEach((c) => { dados[c.dataset.anamnese] = c.value; });

    const resultado = await ProntuarioStore.salvarAnamnese(paciente.id, dados);
    if (!resultado.ok) { Shell.toast(resultado.erro); return; }

    anamnese = resultado.anamnese;
    $('#anamnese-atualizada').textContent = 'Atualizada em ' + Shell.formatarDataHora(anamnese.atualizadoEm);
    Shell.toast('Anamnese salva.');
    desenharLinhaTempo();
  });

  /* ───────────── Antropometria ───────────── */

  const dialogoAv = $('#dialogo-avaliacao');

  function lerFormularioAvaliacao() {
    const circunferencias = {};
    $$('[data-circ]').forEach((i) => { if (i.value.trim()) circunferencias[i.dataset.circ] = i.value.trim(); });
    const dobras = {};
    $$('[data-dobra]').forEach((i) => { if (i.value.trim()) dobras[i.dataset.dobra] = i.value.trim(); });

    return {
      id: $('#av-id').value || undefined,
      pacienteId: paciente.id,
      data: $('#av-data').value,
      peso: $('#av-peso').value.trim(),
      altura: $('#av-altura').value.trim(),
      circunferencias,
      dobras,
      observacoes: $('#av-observacoes').value
    };
  }

  /** Recalcula o painel de resultados enquanto o profissional digita. */
  function atualizarResultadosAvaliacao() {
    const a = Antropometria.analisar(lerFormularioAvaliacao(), paciente);
    const linhas = [];

    if (a.imc != null) {
      const c = a.classificacaoImc;
      linhas.push(`<div><dt>IMC</dt><dd>${n1(a.imc)} kg/m²
        ${c ? `<span class="tag tag-${c.nivel}">${c.texto}</span>` : ''}</dd></div>`);
      if (c) linhas.push(`<div><dt>Referência</dt><dd class="ref">${esc(c.referencia)}</dd></div>`);
    }
    if (a.pesoIdeal != null) {
      linhas.push(`<div><dt>Peso para IMC 22</dt><dd>${n1(a.pesoIdeal)} kg</dd></div>`);
    }
    if (a.gordura) {
      linhas.push(`<div><dt>% de gordura</dt><dd>${n1(a.gordura.percentual)}%
        <span class="ref">Faulkner · Σ ${n1(a.gordura.soma)} mm</span></dd></div>`);
    }
    if (a.composicao) {
      linhas.push(`<div><dt>Massa gorda</dt><dd>${n1(a.composicao.massaGorda)} kg</dd></div>`);
      linhas.push(`<div><dt>Massa magra</dt><dd>${n1(a.composicao.massaMagra)} kg</dd></div>`);
    }
    if (a.somaDobras && !a.gordura) {
      linhas.push(`<div><dt>Σ dobras</dt><dd>${n1(a.somaDobras.soma)} mm
        <span class="ref">${a.somaDobras.quantas} dobra(s); Faulkner exige as 4 marcadas com †</span></dd></div>`);
    }
    if (a.rcq) {
      linhas.push(`<div><dt>RCQ</dt><dd>${n2(a.rcq.valor)}
        ${a.rcq.risco ? `<span class="tag tag-${a.rcq.risco === 'elevado' ? 'alto' : 'ok'}">${a.rcq.risco}</span>`
                      : '<span class="ref">informe o sexo para interpretar</span>'}</dd></div>`);
    }
    if (a.riscoCintura) {
      linhas.push(`<div><dt>Cintura</dt><dd><span class="tag tag-${a.riscoCintura.nivel}">${a.riscoCintura.texto}</span></dd></div>`);
    }

    $('#av-resultados').innerHTML = linhas.length
      ? `<dl class="lista-resultados">${linhas.join('')}</dl>`
      : '<p class="dica">Informe peso e altura para ver os cálculos.</p>';
  }

  $$('[data-medida]').forEach((i) => i.addEventListener('input', atualizarResultadosAvaliacao));

  function abrirAvaliacao(av) {
    $('#titulo-avaliacao').textContent = av ? 'Editar avaliação' : 'Nova avaliação';
    $('#av-id').value = av ? av.id : '';
    $('#av-data').value = av ? av.data : new Date().toISOString().slice(0, 10);
    $('#av-peso').value = av ? av.peso : '';
    // A altura muda pouco: já vem preenchida com a da última medição.
    $('#av-altura').value = av ? av.altura : (avaliacoes[0] ? avaliacoes[0].altura : '');
    $$('[data-circ]').forEach((i) => { i.value = av && av.circunferencias ? (av.circunferencias[i.dataset.circ] || '') : ''; });
    $$('[data-dobra]').forEach((i) => { i.value = av && av.dobras ? (av.dobras[i.dataset.dobra] || '') : ''; });
    $('#av-observacoes').value = av ? av.observacoes : '';
    $('#erro-avaliacao').hidden = true;
    atualizarResultadosAvaliacao();
    dialogoAv.showModal();
    $('#av-data').focus();
  }

  $('#btn-nova-avaliacao').addEventListener('click', () => abrirAvaliacao(null));
  $('#cancelar-avaliacao').addEventListener('click', () => dialogoAv.close());
  $('#fechar-avaliacao').addEventListener('click', () => dialogoAv.close());

  $('#form-avaliacao').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erro = $('#erro-avaliacao');
    erro.hidden = true;

    const resultado = await ProntuarioStore.salvarAvaliacao(lerFormularioAvaliacao());
    if (!resultado.ok) {
      erro.textContent = resultado.erro;
      erro.hidden = false;
      return;
    }

    dialogoAv.close();
    await recarregarAvaliacoes();
    Shell.toast('Avaliação salva.');
  });

  async function recarregarAvaliacoes() {
    avaliacoes = await ProntuarioStore.listarAvaliacoes(paciente.id);
    $('#badge-avaliacoes').textContent = avaliacoes.length;
    $('#sem-avaliacoes').hidden = avaliacoes.length > 0;
    desenharAvaliacoes();
    desenharEvolucao();
    desenharResumo();
    desenharLinhaTempo();
  }

  function desenharAvaliacoes() {
    $('#lista-avaliacoes').innerHTML = avaliacoes.map((av, i) => {
      const a = Antropometria.analisar(av, paciente);
      const anterior = avaliacoes[i + 1] ? Antropometria.analisar(avaliacoes[i + 1], paciente) : null;
      const peso = Antropometria.num(av.peso);
      const pesoAnt = avaliacoes[i + 1] ? Antropometria.num(avaliacoes[i + 1].peso) : null;

      const chips = [
        peso != null ? `<span class="chip">Peso ${n1(peso)} kg ${delta(peso, pesoAnt, 1)}</span>` : '',
        a.imc != null ? `<span class="chip">IMC ${n1(a.imc)}</span>` : '',
        a.classificacaoImc ? `<span class="tag tag-${a.classificacaoImc.nivel}">${a.classificacaoImc.texto}</span>` : '',
        a.gordura ? `<span class="chip">Gordura ${n1(a.gordura.percentual)}%</span>` : '',
        a.rcq ? `<span class="chip">RCQ ${n2(a.rcq.valor)}</span>` : ''
      ].filter(Boolean).join('');

      return `
        <li class="avaliacao-item">
          <div class="avaliacao-info">
            <div class="avaliacao-data">
              ${esc(Shell.formatarData(av.data))}
              ${i === 0 ? '<span class="marca-recente">mais recente</span>' : ''}
            </div>
            <div class="avaliacao-chips">${chips || '<span class="dica">Sem medidas preenchidas</span>'}</div>
            ${av.observacoes ? `<p class="avaliacao-obs">${esc(av.observacoes)}</p>` : ''}
          </div>
          <div class="avaliacao-acoes">
            <button class="btn-editar" type="button" data-editar="${av.id}" aria-label="Editar avaliação de ${esc(Shell.formatarData(av.data))}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
              </svg>
            </button>
            <button class="btn-remover-ficha" type="button" data-remover="${av.id}" aria-label="Remover avaliação">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                <path d="M5 5l14 14M19 5L5 19"/>
              </svg>
            </button>
          </div>
        </li>`;
    }).join('');
  }

  /** Comparação entre a primeira e a última medição. */
  function desenharEvolucao() {
    const bloco = $('#evolucao');
    if (avaliacoes.length < 2) { bloco.hidden = true; return; }

    const primeira = avaliacoes[avaliacoes.length - 1];
    const ultima = avaliacoes[0];
    const a = Antropometria.analisar(ultima, paciente);
    const p = Antropometria.analisar(primeira, paciente);
    const pesoU = Antropometria.num(ultima.peso);
    const pesoP = Antropometria.num(primeira.peso);

    const item = (rotulo, atual, inicial, casas, unidade) => {
      if (atual == null || inicial == null) return '';
      return `<div class="evolucao-item">
        <span class="metrica-rotulo">${rotulo}</span>
        <span class="evolucao-valores">${n1(inicial)} → <strong>${n1(atual)}</strong> ${unidade}</span>
        ${delta(atual, inicial, casas)}
      </div>`;
    };

    const itens = [
      item('Peso', pesoU, pesoP, 1, 'kg'),
      item('IMC', a.imc, p.imc, 1, ''),
      a.gordura && p.gordura ? item('% de gordura', a.gordura.percentual, p.gordura.percentual, 1, '%') : '',
      a.composicao && p.composicao ? item('Massa magra', a.composicao.massaMagra, p.composicao.massaMagra, 1, 'kg') : ''
    ].filter(Boolean).join('');

    if (!itens) { bloco.hidden = true; return; }

    bloco.hidden = false;
    bloco.innerHTML = `
      <h4>Evolução desde ${esc(Shell.formatarData(primeira.data))}</h4>
      <div class="evolucao-grade">${itens}</div>
      <p class="dica">${avaliacoes.length} medições registradas.</p>`;
  }

  $('#lista-avaliacoes').addEventListener('click', async (ev) => {
    const editar = ev.target.closest('[data-editar]');
    if (editar) { abrirAvaliacao(await ProntuarioStore.obterAvaliacao(editar.dataset.editar)); return; }

    // Remoção em dois toques: window.confirm() é suprimido em PWA instalado.
    const remover = ev.target.closest('[data-remover]');
    if (!remover) return;

    if (remover.dataset.armado === 'sim') {
      await ProntuarioStore.removerAvaliacao(remover.dataset.remover);
      await recarregarAvaliacoes();
      Shell.toast('Avaliação removida.');
      return;
    }
    remover.dataset.armado = 'sim';
    remover.classList.add('confirmando');
    setTimeout(() => {
      if (!remover.isConnected) return;
      remover.dataset.armado = '';
      remover.classList.remove('confirmando');
    }, 4000);
  });

  /* ───────────── Consultas ───────────── */

  async function recarregarConsultas() {
    consultas = await AgendaStore.listarPorPaciente(paciente.id);
  }

  /** Cartão de próxima consulta, no topo do Resumo. */
  function desenharProximaConsulta() {
    // Data de hoje pelos componentes locais: toISOString() converte para UTC
    // e, no Brasil, à noite isso já aponta para o dia seguinte.
    const agora = new Date();
    const hojeIso = agora.getFullYear() + '-' +
      String(agora.getMonth() + 1).padStart(2, '0') + '-' +
      String(agora.getDate()).padStart(2, '0');

    const proxima = consultas.find((c) => c.data >= hojeIso && c.status !== 'cancelada');
    const alvo = $('#proxima-consulta');
    if (!alvo) return;

    if (!proxima) {
      alvo.innerHTML = `<p class="dica">Nenhuma consulta agendada.
        <a href="agenda.html?paciente=${encodeURIComponent(paciente.id)}">Marcar uma</a>.</p>`;
      return;
    }

    const nivel = AgendaStore.nivelStatus(proxima.status);
    alvo.innerHTML = `
      <div class="proxima-consulta">
        <span class="quando">${esc(Shell.formatarData(proxima.data))}<br>${esc(proxima.hora)}</span>
        <span class="detalhe">
          <strong>${esc(proxima.tipo)}</strong> · ${proxima.duracao} min<br>
          <span class="tag tag-${nivel === 'feito' ? 'ok' : nivel}">${esc(AgendaStore.rotuloStatus(proxima.status))}</span>
        </span>
        <a class="btn btn-ghost btn-sm" href="agenda.html">Ver agenda</a>
      </div>`;
  }

  /* ───────────── Planos alimentares ───────────── */

  let planos = [];

  async function recarregarPlanos() {
    planos = await PlanosStore.listarPlanos(paciente.id);
    $('#badge-planos').textContent = planos.length;
    $('#sem-planos').hidden = planos.length > 0;

    $('#lista-planos').innerHTML = planos.map((p) => {
      const r = p.resumo || {};
      const partes = [
        r.kcal != null ? Math.round(r.kcal) + ' kcal/dia' : '',
        r.proteinas != null ? 'P ' + Math.round(r.proteinas) + ' g' : '',
        r.carboidratos != null ? 'C ' + Math.round(r.carboidratos) + ' g' : '',
        r.gordurasTotais != null ? 'L ' + Math.round(r.gordurasTotais) + ' g' : '',
        r.itens != null ? r.itens + (r.itens === 1 ? ' alimento' : ' alimentos') : ''
      ].filter(Boolean).join(' · ');

      const url = 'plano.html?paciente=' + encodeURIComponent(paciente.id) +
                  '&plano=' + encodeURIComponent(p.id);

      const tipoDieta = p.tipoDieta ? TiposDieta.porId(p.tipoDieta) : null;

      return `
        <li class="plano-item">
          <a class="plano-link" href="${url}">
            <span class="plano-titulo">
              ${esc(p.nome)}
              ${tipoDieta ? `<span class="badge-plano">${esc(tipoDieta.nome)}</span>` : ''}
            </span>
            <span class="plano-detalhe">${esc(partes || 'Plano vazio')}</span>
            <span class="plano-data">${esc(Shell.formatarData(p.data))} · atualizado em ${esc(Shell.formatarDataHora(p.atualizadoEm))}</span>
          </a>
          <button class="btn-remover-ficha" type="button" data-plano="${p.id}" aria-label="Remover ${esc(p.nome)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
              <path d="M5 5l14 14M19 5L5 19"/>
            </svg>
          </button>
        </li>`;
    }).join('');
  }

  $('#lista-planos').addEventListener('click', async (ev) => {
    const botao = ev.target.closest('[data-plano]');
    if (!botao) return;
    ev.preventDefault();

    if (botao.dataset.armado === 'sim') {
      await PlanosStore.removerPlano(botao.dataset.plano);
      await recarregarPlanos();
      desenharLinhaTempo();
      Shell.toast('Plano removido.');
      return;
    }
    botao.dataset.armado = 'sim';
    botao.classList.add('confirmando');
    setTimeout(() => {
      if (!botao.isConnected) return;
      botao.dataset.armado = '';
      botao.classList.remove('confirmando');
    }, 4000);
  });

  /* ───────────── Fichas técnicas ───────────── */

  async function recarregarFichas() {
    fichas = await FichasStore.listarFichasDoPaciente(paciente.id);
    $('#badge-fichas').textContent = fichas.length;
    $('#sem-fichas').hidden = fichas.length > 0;

    $('#lista-fichas').innerHTML = fichas.map((f) => {
      const r = f.resumo || {};
      const partes = [
        r.kcalPorcao != null ? Math.round(r.kcalPorcao) + ' kcal/porção' : '',
        r.porcoes != null ? r.porcoes + (r.porcoes === 1 ? ' porção' : ' porções') : '',
        r.rendimento != null ? Math.round(r.rendimento) + ' g' : '',
        r.ingredientes != null ? r.ingredientes + (r.ingredientes === 1 ? ' ingrediente' : ' ingredientes') : ''
      ].filter(Boolean).join(' · ');

      const url = 'ficha.html?paciente=' + encodeURIComponent(paciente.id) +
                  '&ficha=' + encodeURIComponent(f.id);

      return `
        <li class="ficha-item">
          <a class="ficha-link" href="${url}">
            <span class="ficha-info">
              <span class="ficha-titulo">${esc(f.titulo)}</span>
              <span class="ficha-detalhe">${esc(partes || 'Sem ingredientes')}</span>
              <span class="ficha-data">Atualizada em ${esc(Shell.formatarDataHora(f.atualizadoEm))}</span>
            </span>
          </a>
          <button class="btn-remover-ficha" type="button" data-id="${f.id}" aria-label="Remover ${esc(f.titulo)}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
              <path d="M5 5l14 14M19 5L5 19"/>
            </svg>
          </button>
        </li>`;
    }).join('');
  }

  $('#lista-fichas').addEventListener('click', async (ev) => {
    const botao = ev.target.closest('.btn-remover-ficha');
    if (!botao) return;
    ev.preventDefault();

    if (botao.dataset.armado === 'sim') {
      await FichasStore.removerFicha(botao.dataset.id);
      await recarregarFichas();
      desenharLinhaTempo();
      Shell.toast('Ficha removida.');
      return;
    }
    botao.dataset.armado = 'sim';
    botao.classList.add('confirmando');
    setTimeout(() => {
      if (!botao.isConnected) return;
      botao.dataset.armado = '';
      botao.classList.remove('confirmando');
    }, 4000);
  });

  /* ───────────── Linha do tempo ───────────── */

  function desenharLinhaTempo() {
    const eventos = [];

    eventos.push({
      quando: paciente.criadoEm,
      tipo: 'cadastro',
      titulo: 'Paciente cadastrado',
      detalhe: ''
    });

    if (ProntuarioStore.anamnesePreenchida(anamnese)) {
      eventos.push({
        quando: anamnese.atualizadoEm,
        tipo: 'anamnese',
        titulo: 'Anamnese preenchida',
        detalhe: (anamnese.queixas || '').slice(0, 120)
      });
    }

    avaliacoes.forEach((av) => {
      const a = Antropometria.analisar(av, paciente);
      const partes = [
        Antropometria.num(av.peso) != null ? n1(Antropometria.num(av.peso)) + ' kg' : '',
        a.imc != null ? 'IMC ' + n1(a.imc) : '',
        a.gordura ? n1(a.gordura.percentual) + '% de gordura' : ''
      ].filter(Boolean).join(' · ');

      eventos.push({
        // A data da medição é o que importa, não quando foi digitada.
        quando: av.data + 'T12:00:00',
        tipo: 'avaliacao',
        titulo: 'Avaliação antropométrica',
        detalhe: partes,
        link: null
      });
    });

    consultas.forEach((c) => {
      eventos.push({
        quando: c.data + 'T' + (c.hora || '12:00') + ':00',
        tipo: 'consulta',
        titulo: 'Consulta: ' + c.tipo,
        detalhe: AgendaStore.rotuloStatus(c.status) + (c.observacoes ? ' · ' + c.observacoes : ''),
        link: 'agenda.html'
      });
    });

    planos.forEach((p) => {
      const r = p.resumo || {};
      eventos.push({
        quando: p.atualizadoEm,
        tipo: 'plano',
        titulo: 'Plano alimentar: ' + p.nome,
        detalhe: r.kcal != null ? Math.round(r.kcal) + ' kcal por dia' : '',
        link: 'plano.html?paciente=' + encodeURIComponent(paciente.id) + '&plano=' + encodeURIComponent(p.id)
      });
    });

    fichas.forEach((f) => {
      const r = f.resumo || {};
      eventos.push({
        quando: f.atualizadoEm,
        tipo: 'ficha',
        titulo: 'Ficha técnica: ' + f.titulo,
        detalhe: r.kcalPorcao != null ? Math.round(r.kcalPorcao) + ' kcal por porção' : '',
        link: 'ficha.html?paciente=' + encodeURIComponent(paciente.id) + '&ficha=' + encodeURIComponent(f.id)
      });
    });

    eventos.sort((a, b) => String(b.quando).localeCompare(String(a.quando)));

    $('#sem-eventos').hidden = eventos.length > 0;

    const ICONES = {
      cadastro: '👤', anamnese: '📋', avaliacao: '⚖️', ficha: '🍽️', plano: '🥗', consulta: '📅'
    };

    $('#linha-tempo').innerHTML = eventos.map((e) => `
      <li class="evento evento-${e.tipo}">
        <span class="evento-marca" aria-hidden="true">${ICONES[e.tipo] || '•'}</span>
        <div class="evento-corpo">
          <div class="evento-topo">
            <strong>${e.link ? `<a href="${e.link}">${esc(e.titulo)}</a>` : esc(e.titulo)}</strong>
            <time>${esc(Shell.formatarDataHora(e.quando) || Shell.formatarData(e.quando))}</time>
          </div>
          ${e.detalhe ? `<p>${esc(e.detalhe)}</p>` : ''}
        </div>
      </li>`).join('');
  }

  /* ───────────── Editar / remover paciente ───────────── */

  const dialogo = $('#dialogo');
  const erroForm = $('#erro-form');

  $('#btn-editar').addEventListener('click', () => {
    $('#f-nome').value = paciente.nome;
    $('#f-nascimento').value = paciente.nascimento;
    $('#f-sexo').value = paciente.sexo || '';
    $('#f-telefone').value = paciente.telefone;
    $('#f-email').value = paciente.email;
    $('#f-observacoes').value = paciente.observacoes;
    erroForm.hidden = true;
    dialogo.showModal();
    $('#f-nome').focus();
  });

  $('#cancelar').addEventListener('click', () => dialogo.close());
  $('#fechar-dialogo').addEventListener('click', () => dialogo.close());

  $('#form-paciente').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erroForm.hidden = true;

    const resultado = await PacientesStore.salvarPaciente({
      id: paciente.id,
      criadoEm: paciente.criadoEm,
      nome: $('#f-nome').value,
      nascimento: $('#f-nascimento').value,
      sexo: $('#f-sexo').value,
      telefone: $('#f-telefone').value,
      email: $('#f-email').value,
      observacoes: $('#f-observacoes').value
    });

    if (!resultado.ok) {
      erroForm.textContent = resultado.erro;
      erroForm.hidden = false;
      return;
    }

    paciente = resultado.paciente;
    dialogo.close();
    desenharPaciente();
    // Sexo e idade entram nos pontos de corte: os cálculos precisam refazer.
    desenharAvaliacoes();
    desenharEvolucao();
    desenharResumo();
    Shell.toast('Dados atualizados.');
  });

  const botaoRemover = $('#btn-remover');
  let armadoRemover = null;
  botaoRemover.addEventListener('click', async () => {
    if (!armadoRemover) {
      botaoRemover.textContent = 'Confirmar exclusão?';
      botaoRemover.classList.add('confirmando');
      armadoRemover = setTimeout(() => {
        armadoRemover = null;
        botaoRemover.textContent = 'Remover';
        botaoRemover.classList.remove('confirmando');
      }, 4000);
      return;
    }
    clearTimeout(armadoRemover);
    await FichasStore.removerFichasDoPaciente(paciente.id);
    await ProntuarioStore.removerDoPaciente(paciente.id);
    await PlanosStore.removerDoPaciente(paciente.id);
    await AgendaStore.removerDoPaciente(paciente.id);
    await FinanceiroStore.removerDoPaciente(paciente.id);
    await PacientesStore.removerPaciente(paciente.id);
    location.replace('pacientes.html');
  });

  /* ───────────── Início ───────────── */

  desenharPaciente();
  desenharVinculo();
  await carregarAnamnese();
  await recarregarConsultas();
  desenharProximaConsulta();
  await recarregarAvaliacoes();
  await recarregarPlanos();
  await recarregarFichas();
  desenharLinhaTempo();
})();
