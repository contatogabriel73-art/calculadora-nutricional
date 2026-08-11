/* ============================================================
   agenda.js — calendário de consultas

   Duas visões: mês (grade) e semana (lista por dia, que lê melhor no
   celular do que uma grade de horários).

   Sobre datas: em nenhum lugar usamos `new Date('2026-08-11')`. Esse
   formato é interpretado como UTC, e no Brasil (UTC−3) o resultado cai
   no dia anterior — uma consulta marcada para o dia 11 apareceria no
   dia 10. Toda conversão passa por paraData(), que monta a data pelos
   componentes, em horário local.
   ============================================================ */

'use strict';

(async () => {

  if (!(await Auth.exigirLogin())) return;
  await Shell.montarCabecalho('agenda');

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = Shell.escapar;

  /* ───────────── Datas ───────────── */

  const doisDigitos = (n) => String(n).padStart(2, '0');

  /** 'YYYY-MM-DD' → Date local (nunca UTC). */
  function paraData(iso) {
    const [a, m, d] = String(iso).split('-').map(Number);
    return new Date(a, (m || 1) - 1, d || 1);
  }

  /** Date → 'YYYY-MM-DD' no fuso local. */
  function paraIso(dt) {
    return dt.getFullYear() + '-' + doisDigitos(dt.getMonth() + 1) + '-' + doisDigitos(dt.getDate());
  }

  function somarDias(dt, dias) {
    const nova = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    nova.setDate(nova.getDate() + dias);
    return nova;
  }

  /** Domingo da semana de `dt` — o calendário brasileiro começa no domingo. */
  function inicioSemana(dt) {
    return somarDias(dt, -dt.getDay());
  }

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
                'quinta-feira', 'sexta-feira', 'sábado'];

  const hoje = new Date();
  const hojeIso = paraIso(hoje);

  /* ───────────── Estado ───────────── */

  let visao = 'mes';
  let referencia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  let pacientes = [];
  let porId = new Map();

  async function carregarPacientes() {
    pacientes = await PacientesStore.listarPacientes();
    porId = new Map(pacientes.map((p) => [p.id, p]));
  }

  const nomeDe = (id) => (porId.get(id) ? porId.get(id).nome : 'Paciente removido');

  /* ───────────── Período visível ───────────── */

  function periodo() {
    if (visao === 'semana') {
      const inicio = inicioSemana(referencia);
      return { inicio, fim: somarDias(inicio, 6) };
    }
    const inicio = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
    const fim = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0);
    return { inicio, fim };
  }

  function titulo() {
    const { inicio, fim } = periodo();
    if (visao === 'mes') {
      const m = MESES[inicio.getMonth()];
      return m.charAt(0).toUpperCase() + m.slice(1) + ' de ' + inicio.getFullYear();
    }
    const mesmoMes = inicio.getMonth() === fim.getMonth();
    return mesmoMes
      ? `${inicio.getDate()} a ${fim.getDate()} de ${MESES[inicio.getMonth()]}`
      : `${inicio.getDate()} de ${MESES[inicio.getMonth()]} a ${fim.getDate()} de ${MESES[fim.getMonth()]}`;
  }

  /* ───────────── Desenho ───────────── */

  function pilula(c) {
    return `
      <button class="consulta-pilula status-${AgendaStore.nivelStatus(c.status)}"
              type="button" data-consulta="${c.id}"
              title="${esc(c.hora + ' · ' + nomeDe(c.pacienteId) + ' · ' + AgendaStore.rotuloStatus(c.status))}">
        <span class="pilula-hora">${esc(c.hora)}</span>
        <span class="pilula-nome">${esc(nomeDe(c.pacienteId))}</span>
      </button>`;
  }

  async function desenhar() {
    const { inicio, fim } = periodo();
    const consultas = await AgendaStore.listarPorPeriodo(paraIso(inicio), paraIso(fim));

    $('#titulo-periodo').textContent = titulo();

    // Resumo do período, ignorando canceladas na contagem principal
    const ativas = consultas.filter((c) => c.status !== 'cancelada');
    const porStatus = AgendaStore.STATUS.map((s) => {
      const n = consultas.filter((c) => c.status === s.valor).length;
      return n ? `<span class="tag tag-${s.nivel === 'feito' ? 'ok' : s.nivel}">${n} ${s.rotulo.toLowerCase()}</span>` : '';
    }).filter(Boolean).join('');

    $('#resumo-periodo').innerHTML = consultas.length
      ? `<span class="resumo-numero">${ativas.length}</span>
         <span class="resumo-texto">${ativas.length === 1 ? 'consulta ativa' : 'consultas ativas'} no período</span>
         <span class="resumo-tags">${porStatus}</span>`
      : '<span class="resumo-texto">Nenhuma consulta neste período.</span>';

    if (visao === 'mes') desenharMes(consultas);
    else desenharSemana(consultas);
  }

  function desenharMes(consultas) {
    $('#visao-mes').hidden = false;
    $('#visao-semana').hidden = true;

    const primeiro = new Date(referencia.getFullYear(), referencia.getMonth(), 1);
    const ultimo = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0);

    // A grade começa no domingo anterior ao dia 1 e termina no sábado
    // seguinte ao último dia, para as semanas ficarem completas.
    let cursor = inicioSemana(primeiro);
    const ultimoDaGrade = somarDias(inicioSemana(ultimo), 6);

    const porDia = new Map();
    consultas.forEach((c) => {
      if (!porDia.has(c.data)) porDia.set(c.data, []);
      porDia.get(c.data).push(c);
    });

    const celulas = [];
    while (cursor <= ultimoDaGrade) {
      const iso = paraIso(cursor);
      const doMes = cursor.getMonth() === referencia.getMonth();
      const doDia = porDia.get(iso) || [];

      const classes = ['celula-dia'];
      if (!doMes) classes.push('fora-do-mes');
      if (iso === hojeIso) classes.push('celula-hoje');

      celulas.push(`
        <div class="${classes.join(' ')}" data-dia="${iso}">
          <button class="numero-dia" type="button" data-novo-em="${iso}"
                  aria-label="Marcar consulta em ${cursor.getDate()} de ${MESES[cursor.getMonth()]}">
            ${cursor.getDate()}
          </button>
          <div class="celula-consultas">${doDia.map(pilula).join('')}</div>
        </div>`);

      cursor = somarDias(cursor, 1);
    }

    $('#grade-mes').innerHTML = celulas.join('');
  }

  function desenharSemana(consultas) {
    $('#visao-mes').hidden = true;
    $('#visao-semana').hidden = false;

    const inicio = inicioSemana(referencia);
    const blocos = [];

    for (let i = 0; i < 7; i++) {
      const dia = somarDias(inicio, i);
      const iso = paraIso(dia);
      const doDia = consultas.filter((c) => c.data === iso);

      blocos.push(`
        <div class="card dia-semana ${iso === hojeIso ? 'dia-hoje' : ''}">
          <div class="dia-semana-topo">
            <div>
              <h3>${DIAS[dia.getDay()]}</h3>
              <p class="dica">${dia.getDate()} de ${MESES[dia.getMonth()]}${iso === hojeIso ? ' · hoje' : ''}</p>
            </div>
            <button class="btn btn-ghost btn-sm" type="button" data-novo-em="${iso}">+ Consulta</button>
          </div>

          ${doDia.length ? `
            <ul class="lista-consultas">
              ${doDia.map((c) => `
                <li class="consulta-linha status-borda-${AgendaStore.nivelStatus(c.status)}">
                  <button class="consulta-abrir" type="button" data-consulta="${c.id}">
                    <span class="consulta-hora">${esc(c.hora)}</span>
                    <span class="consulta-corpo">
                      <span class="consulta-nome">${esc(nomeDe(c.pacienteId))}</span>
                      <span class="consulta-detalhe">${esc(c.tipo)} · ${c.duracao} min</span>
                      ${c.observacoes ? `<span class="consulta-obs">${esc(c.observacoes)}</span>` : ''}
                    </span>
                    <span class="tag tag-${AgendaStore.nivelStatus(c.status) === 'feito' ? 'ok' : AgendaStore.nivelStatus(c.status)}">
                      ${AgendaStore.rotuloStatus(c.status)}
                    </span>
                  </button>
                </li>`).join('')}
            </ul>`
          : '<p class="empty empty-refeicao">Sem consultas.</p>'}
        </div>`);
    }

    $('#visao-semana').innerHTML = blocos.join('');
  }

  /* ───────────── Navegação ───────────── */

  $('#btn-anterior').addEventListener('click', () => {
    referencia = visao === 'mes'
      ? new Date(referencia.getFullYear(), referencia.getMonth() - 1, 1)
      : somarDias(referencia, -7);
    desenhar();
  });

  $('#btn-proximo').addEventListener('click', () => {
    referencia = visao === 'mes'
      ? new Date(referencia.getFullYear(), referencia.getMonth() + 1, 1)
      : somarDias(referencia, 7);
    desenhar();
  });

  $('#btn-hoje').addEventListener('click', () => {
    referencia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    desenhar();
  });

  $$('.alternador-opcao').forEach((b) => b.addEventListener('click', () => {
    visao = b.dataset.visao;
    $$('.alternador-opcao').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    desenhar();
  }));

  /* ───────────── Diálogo ───────────── */

  const dialogo = $('#dialogo');

  // Monta as opções fixas uma vez.
  $('#c-tipo').innerHTML = AgendaStore.TIPOS.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('#c-status').innerHTML = AgendaStore.STATUS.map((s) => `
    <label><input type="radio" name="status" value="${s.valor}"> ${s.rotulo}</label>`).join('');

  function preencherPacientes(selecionado) {
    $('#c-paciente').innerHTML =
      '<option value="">Selecione…</option>' +
      pacientes.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
    if (selecionado) $('#c-paciente').value = selecionado;

    $('#dica-paciente').innerHTML = pacientes.length
      ? ''
      : 'Nenhum paciente cadastrado. <a href="pacientes.html">Cadastre um primeiro.</a>';
  }

  function lerFormulario() {
    const status = document.querySelector('input[name="status"]:checked');
    return {
      id: $('#c-id').value || undefined,
      pacienteId: $('#c-paciente').value,
      data: $('#c-data').value,
      hora: $('#c-hora').value,
      duracao: $('#c-duracao').value,
      tipo: $('#c-tipo').value,
      status: status ? status.value : 'agendada',
      observacoes: $('#c-observacoes').value
    };
  }

  /** Aviso de choque de horário — informa, não impede. */
  async function verificarConflito() {
    const dados = lerFormulario();
    const aviso = $('#aviso-conflito');

    if (!dados.data || !dados.hora) { aviso.hidden = true; return; }

    const lista = await AgendaStore.conflitos(dados);
    if (!lista.length) { aviso.hidden = true; return; }

    aviso.innerHTML = 'Choque de horário com: ' +
      lista.map((c) => `<strong>${esc(c.hora)} ${esc(nomeDe(c.pacienteId))}</strong>`).join(', ') +
      '. Dá para salvar assim mesmo, se for intencional.';
    aviso.hidden = false;
  }

  ['#c-data', '#c-hora', '#c-duracao'].forEach((sel) =>
    $(sel).addEventListener('input', verificarConflito));

  function abrirDialogo(consulta, diaSugerido) {
    $('#dialogo-titulo').textContent = consulta ? 'Editar consulta' : 'Nova consulta';
    $('#c-id').value = consulta ? consulta.id : '';
    preencherPacientes(consulta ? consulta.pacienteId : '');
    $('#c-data').value = consulta ? consulta.data : (diaSugerido || hojeIso);
    $('#c-hora').value = consulta ? consulta.hora : '09:00';
    $('#c-duracao').value = consulta ? consulta.duracao : 60;
    $('#c-tipo').value = consulta ? consulta.tipo : AgendaStore.TIPOS[0];
    $('#c-observacoes').value = consulta ? consulta.observacoes : '';

    const alvo = consulta ? consulta.status : 'agendada';
    $$('input[name="status"]').forEach((r) => { r.checked = r.value === alvo; });

    $('#btn-excluir').hidden = !consulta;
    $('#erro-consulta').hidden = true;
    $('#aviso-conflito').hidden = true;

    dialogo.showModal();
    verificarConflito();
    ($('#c-paciente').value ? $('#c-data') : $('#c-paciente')).focus();
  }

  $('#btn-nova').addEventListener('click', () => abrirDialogo(null, null));
  $('#cancelar').addEventListener('click', () => dialogo.close());
  $('#fechar-dialogo').addEventListener('click', () => dialogo.close());

  document.addEventListener('click', async (ev) => {
    const abrir = ev.target.closest('[data-consulta]');
    if (abrir) { abrirDialogo(await AgendaStore.obterConsulta(abrir.dataset.consulta), null); return; }

    const novo = ev.target.closest('[data-novo-em]');
    if (novo) abrirDialogo(null, novo.dataset.novoEm);
  });

  $('#form-consulta').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erro = $('#erro-consulta');
    erro.hidden = true;

    const resultado = await AgendaStore.salvarConsulta(lerFormulario());
    if (!resultado.ok) {
      erro.textContent = resultado.erro;
      erro.hidden = false;
      return;
    }

    dialogo.close();
    await desenhar();
    Shell.toast('Consulta salva.');
  });

  // Exclusão em dois toques, como no resto do sistema.
  const botaoExcluir = $('#btn-excluir');
  let armado = null;
  botaoExcluir.addEventListener('click', async () => {
    if (!armado) {
      botaoExcluir.textContent = 'Confirmar exclusão?';
      botaoExcluir.classList.add('confirmando');
      armado = setTimeout(() => {
        armado = null;
        botaoExcluir.textContent = 'Excluir';
        botaoExcluir.classList.remove('confirmando');
      }, 4000);
      return;
    }
    clearTimeout(armado);
    armado = null;
    botaoExcluir.textContent = 'Excluir';
    botaoExcluir.classList.remove('confirmando');

    await AgendaStore.removerConsulta($('#c-id').value);
    dialogo.close();
    await desenhar();
    Shell.toast('Consulta excluída.');
  });

  /* ───────────── Início ───────────── */

  await carregarPacientes();

  // Abrir já com uma consulta nova para um paciente (vindo do prontuário).
  const params = new URLSearchParams(location.search);
  const pacienteParam = params.get('paciente');

  await desenhar();

  if (pacienteParam && porId.has(pacienteParam)) {
    abrirDialogo(null, params.get('dia') || hojeIso);
    $('#c-paciente').value = pacienteParam;
  }
})();
