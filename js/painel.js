/* ============================================================
   painel.js — tela inicial pós-login

   Responde "como está meu dia e meu mês" juntando o que os outros
   módulos já guardam. Não cria dado novo: só lê e resume.
   ============================================================ */

'use strict';

(async () => {

  if (!(await Auth.exigirLogin())) return;
  await Shell.montarCabecalho('painel');

  const $ = (s) => document.querySelector(s);
  const esc = Shell.escapar;
  const F = FinanceiroStore;

  /* Datas pelos componentes locais. toISOString() converte para UTC e, à
     noite no Brasil, já aponta para o dia seguinte — o painel mostraria
     as consultas de amanhã como "hoje". */
  const doisDigitos = (n) => String(n).padStart(2, '0');
  const paraIso = (dt) =>
    dt.getFullYear() + '-' + doisDigitos(dt.getMonth() + 1) + '-' + doisDigitos(dt.getDate());

  const agora = new Date();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const hojeIso = paraIso(hoje);

  function somarDias(dt, dias) {
    const nova = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    nova.setDate(nova.getDate() + dias);
    return nova;
  }

  const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
                'quinta-feira', 'sexta-feira', 'sábado'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  /* ───────────── Saudação ───────────── */

  const usuario = await Auth.usuarioAtual();
  const hora = agora.getHours();
  const parteDoDia = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const primeiroNome = (usuario && usuario.nome ? usuario.nome : '').split(' ')[0];

  $('#saudacao').textContent = parteDoDia + (primeiroNome ? ', ' + primeiroNome : '') + '.';
  $('#data-hoje').textContent =
    DIAS[hoje.getDay()].charAt(0).toUpperCase() + DIAS[hoje.getDay()].slice(1) +
    ', ' + hoje.getDate() + ' de ' + MESES[hoje.getMonth()] + ' de ' + hoje.getFullYear();

  /* ───────────── Dados ───────────── */

  const pacientes = await PacientesStore.listarPacientes();
  const porId = new Map(pacientes.map((p) => [p.id, p]));
  const nomeDe = (id) => (porId.get(id) ? porId.get(id).nome : 'Paciente removido');

  const fimSemana = somarDias(hoje, 7);
  const consultasSemana = await AgendaStore.listarPorPeriodo(hojeIso, paraIso(fimSemana));
  const ativasSemana = consultasSemana.filter((c) => c.status !== 'cancelada');

  const doDia = ativasSemana.filter((c) => c.data === hojeIso);
  const proximos = ativasSemana.filter((c) => c.data > hojeIso);

  const anoMes = hoje.getFullYear() + '-' + doisDigitos(hoje.getMonth() + 1);
  const pagamentosMes = await F.listarPorMes(anoMes);
  const resumoMes = F.resumir(pagamentosMes);
  const pendentes = await F.listarPendentes();

  /* ───────────── Métricas ───────────── */

  function cartao(rotulo, valor, unidade, extra, classe, link) {
    const corpo = `
      <span class="metrica-rotulo">${rotulo}</span>
      <span class="metrica-valor">${unidade ? '<em>' + unidade + '</em> ' : ''}${valor}</span>
      ${extra ? `<span class="metrica-extra">${extra}</span>` : ''}`;
    return link
      ? `<a class="metrica metrica-link ${classe || ''}" href="${link}">${corpo}</a>`
      : `<div class="metrica ${classe || ''}">${corpo}</div>`;
  }

  const ticket = resumoMes.quantidadePagos
    ? 'ticket médio R$ ' + F.formatarCentavos(Math.round(resumoMes.recebido / resumoMes.quantidadePagos))
    : '';

  $('#metricas').innerHTML =
    cartao('Pacientes ativos', pacientes.length, '',
      pacientes.length === 1 ? 'cadastrado' : 'cadastrados', '', 'pacientes.html') +
    cartao('Consultas na semana', ativasSemana.length, '',
      doDia.length ? doDia.length + ' ' + (doDia.length === 1 ? 'hoje' : 'hoje') : 'nenhuma hoje',
      '', 'agenda.html') +
    cartao('Recebido no mês', F.formatarCentavos(resumoMes.recebido), 'R$',
      ticket, 'metrica-verde', 'financeiro.html') +
    cartao('A receber', F.formatarCentavos(pendentes.reduce((s, p) => s + p.centavos, 0)), 'R$',
      `${pendentes.length} ${pendentes.length === 1 ? 'cobrança' : 'cobranças'} em aberto`,
      pendentes.length ? 'metrica-alerta' : '', 'financeiro.html');

  /* ───────────── Atalhos ───────────── */

  const ICONES = {
    consulta: '<path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>',
    paciente: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    ficha: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    financeiro: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'
  };

  const atalho = (href, icone, titulo, texto) => `
    <a class="atalho" href="${href}">
      <span class="atalho-icone" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">${ICONES[icone]}</svg>
      </span>
      <span class="atalho-texto">
        <strong>${titulo}</strong>
        <span>${texto}</span>
      </span>
    </a>`;

  $('#atalhos').innerHTML =
    atalho('agenda.html', 'consulta', 'Marcar consulta', 'Agendar um atendimento') +
    atalho('pacientes.html', 'paciente', 'Novo paciente', 'Cadastrar no sistema') +
    atalho('ficha.html', 'ficha', 'Ficha técnica', 'Calcular uma preparação') +
    atalho('financeiro.html?novo=1', 'financeiro', 'Lançamento', 'Registrar um pagamento');

  /* ───────────── Consultas ───────────── */

  function linhaConsulta(c, mostrarDia) {
    const nivel = AgendaStore.nivelStatus(c.status);
    const dia = c.data === hojeIso ? '' : Shell.formatarData(c.data).slice(0, 5);

    return `
      <li class="consulta-linha status-borda-${nivel}">
        <a class="consulta-abrir" href="paciente.html?id=${encodeURIComponent(c.pacienteId)}">
          <span class="consulta-hora">${mostrarDia && dia ? dia + '<br>' : ''}${esc(c.hora)}</span>
          <span class="consulta-corpo">
            <span class="consulta-nome">${esc(nomeDe(c.pacienteId))}</span>
            <span class="consulta-detalhe">${esc(c.tipo)} · ${c.duracao} min</span>
          </span>
          <span class="tag tag-${nivel === 'feito' ? 'ok' : nivel}">${esc(AgendaStore.rotuloStatus(c.status))}</span>
        </a>
      </li>`;
  }

  $('#badge-hoje').textContent = doDia.length;
  $('#sem-hoje').hidden = doDia.length > 0;
  $('#lista-hoje').innerHTML = doDia.map((c) => linhaConsulta(c, false)).join('');

  $('#badge-proximos').textContent = proximos.length;
  $('#sem-proximos').hidden = proximos.length > 0;
  $('#lista-proximos').innerHTML = proximos.map((c) => linhaConsulta(c, true)).join('');

  /* ───────────── Pendências ───────────── */

  $('#bloco-pendencias').hidden = pendentes.length === 0;
  $('#badge-pendencias').textContent = pendentes.length;
  // No painel mostramos só as cinco mais antigas: é lembrete, não a tela de cobrança.
  $('#lista-pendencias').innerHTML = pendentes.slice(-5).reverse().map((p) => {
    const atrasado = p.data < hojeIso;
    return `
      <li class="pagamento-item status-borda-atencao">
        <div class="pagamento-info">
          <div class="pagamento-topo">
            <span class="pagamento-nome">${esc(nomeDe(p.pacienteId))}</span>
            <span class="pagamento-valor">R$ ${F.formatarCentavos(p.centavos)}</span>
          </div>
          <div class="pagamento-detalhe">${esc(Shell.formatarData(p.data))} · ${esc(p.descricao)}</div>
          ${atrasado ? '<div class="pagamento-tags"><span class="tag tag-alto">em atraso</span></div>' : ''}
        </div>
      </li>`;
  }).join('');

  $('#aviso').innerHTML = Shell.avisoArmazenamento();
})();
