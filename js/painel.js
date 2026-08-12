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

  const maiuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  /* ───────────── Dados ───────────── */

  const usuario = await Auth.usuarioAtual();
  const pacientes = await PacientesStore.listarPacientes();
  const porId = new Map(pacientes.map((p) => [p.id, p]));
  const nomeDe = (id) => (porId.get(id) ? porId.get(id).nome : 'Paciente removido');

  const consultasSemana = await AgendaStore.listarPorPeriodo(hojeIso, paraIso(somarDias(hoje, 7)));
  const ativas = consultasSemana.filter((c) => c.status !== 'cancelada');
  const doDia = ativas.filter((c) => c.data === hojeIso);

  const anoMes = hoje.getFullYear() + '-' + doisDigitos(hoje.getMonth() + 1);
  const resumoMes = F.resumir(await F.listarPorMes(anoMes));
  const pendentes = await F.listarPendentes();
  const totalPendente = pendentes.reduce((s, p) => s + p.centavos, 0);

  /* ───────────── Cabeçalho ───────────── */

  const hora = agora.getHours();
  const parteDoDia = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const primeiroNome = (usuario && usuario.nome ? usuario.nome : '').split(' ')[0];

  $('#saudacao').textContent = parteDoDia + (primeiroNome ? ', ' + primeiroNome : '') + '.';

  // A data sozinha não informa nada; junto com a carga do dia, sim.
  const cargaHoje = doDia.length === 0
    ? 'nenhuma consulta hoje'
    : doDia.length === 1 ? '1 consulta hoje' : doDia.length + ' consultas hoje';

  $('#resumo-dia').innerHTML =
    `${maiuscula(DIAS[hoje.getDay()])}, ${hoje.getDate()} de ${MESES[hoje.getMonth()]}` +
    ` <span class="ponto">·</span> <strong>${cargaHoje}</strong>`;

  /* ───────────── Métricas ───────────── */

  const ticket = F.ticketMedio(resumoMes);

  function metrica(valor, rotulo, apoio, href, classe) {
    return `
      <a class="metrica-painel ${classe || ''}" href="${href}">
        <span class="mp-valor">${valor}</span>
        <span class="mp-rotulo">${rotulo}</span>
        ${apoio ? `<span class="mp-apoio">${apoio}</span>` : ''}
      </a>`;
  }

  const dinheiro = (centavos) =>
    `<span class="mp-moeda">R$</span>${F.formatarCentavos(centavos)}`;

  $('#metricas').innerHTML =
    metrica(pacientes.length, 'Pacientes ativos',
      pacientes.length === 1 ? 'cadastrado' : 'cadastrados', 'pacientes.html') +
    metrica(ativas.length, 'Consultas na semana',
      doDia.length ? cargaHoje : 'nada hoje', 'agenda.html') +
    metrica(dinheiro(resumoMes.recebido), 'Recebido no mês',
      ticket ? 'ticket médio R$ ' + F.formatarCentavos(ticket) : 'nenhum pagamento',
      'financeiro.html', 'mp-verde') +
    metrica(dinheiro(totalPendente), 'A receber',
      `${pendentes.length} ${pendentes.length === 1 ? 'cobrança' : 'cobranças'}`,
      'financeiro.html', pendentes.length ? 'mp-alerta' : '');

  /* ───────────── Agenda ───────────── */

  /** "Hoje", "Amanhã" ou "Sexta, 14 de agosto". */
  function tituloDoDia(iso) {
    if (iso === hojeIso) return 'Hoje';
    if (iso === paraIso(somarDias(hoje, 1))) return 'Amanhã';
    const [a, m, d] = iso.split('-').map(Number);
    const dt = new Date(a, m - 1, d);
    return `${maiuscula(DIAS[dt.getDay()])}, ${d} de ${MESES[m - 1]}`;
  }

  const grupos = new Map();
  ativas.forEach((c) => {
    if (!grupos.has(c.data)) grupos.set(c.data, []);
    grupos.get(c.data).push(c);
  });

  $('#sem-agenda').hidden = ativas.length > 0;

  $('#agenda-dias').innerHTML = [...grupos.entries()].map(([data, lista]) => `
    <div class="dia-grupo ${data === hojeIso ? 'dia-grupo-hoje' : ''}">
      <h3 class="dia-titulo">
        ${esc(tituloDoDia(data))}
        <span class="dia-contagem">${lista.length}</span>
      </h3>
      <ul class="lista-simples">
        ${lista.map((c) => {
          const nivel = AgendaStore.nivelStatus(c.status);
          return `
            <li>
              <a class="item-consulta" href="paciente.html?id=${encodeURIComponent(c.pacienteId)}">
                <span class="ic-hora">${esc(c.hora)}</span>
                <span class="ic-corpo">
                  <span class="ic-nome">${esc(nomeDe(c.pacienteId))}</span>
                  <span class="ic-detalhe">${esc(c.tipo)} · ${c.duracao} min · ${esc(AgendaStore.rotuloStatus(c.status).toLowerCase())}</span>
                </span>
                <span class="ponto-status ponto-${nivel}"
                      title="${esc(AgendaStore.rotuloStatus(c.status))}"
                      aria-label="${esc(AgendaStore.rotuloStatus(c.status))}"></span>
              </a>
            </li>`;
        }).join('')}
      </ul>
    </div>`).join('');

  /* ───────────── Ações rápidas ───────────── */

  const ICONES = {
    consulta: '<path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/>',
    paciente: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
    ficha: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    dinheiro: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'
  };

  const atalho = (href, icone, texto) => `
    <a class="atalho" href="${href}">
      <span class="atalho-icone" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">${ICONES[icone]}</svg>
      </span>
      <span class="atalho-texto">${texto}</span>
      <span class="atalho-seta" aria-hidden="true">›</span>
    </a>`;

  $('#atalhos').innerHTML =
    atalho('agenda.html', 'consulta', 'Marcar consulta') +
    atalho('pacientes.html', 'paciente', 'Novo paciente') +
    atalho('ficha.html', 'ficha', 'Ficha técnica') +
    atalho('financeiro.html?novo=1', 'dinheiro', 'Lançamento');

  /* ───────────── Cobranças ───────────── */

  $('#bloco-pendencias').hidden = pendentes.length === 0;

  if (pendentes.length) {
    $('#total-aberto').innerHTML =
      `<strong>R$ ${F.formatarCentavos(totalPendente)}</strong> em ` +
      `${pendentes.length} ${pendentes.length === 1 ? 'cobrança' : 'cobranças'}`;

    // Só as quatro mais antigas: aqui é lembrete, não a tela de cobrança.
    $('#lista-pendencias').innerHTML = pendentes.slice(-4).reverse().map((p) => {
      const atrasado = p.data < hojeIso;
      return `
        <li>
          <a class="item-cobranca" href="financeiro.html">
            <span class="ic-corpo">
              <span class="ic-nome">${esc(nomeDe(p.pacienteId))}</span>
              <span class="ic-detalhe">
                ${esc(Shell.formatarData(p.data))}${atrasado ? ' <span class="marca-atraso">em atraso</span>' : ''}
              </span>
            </span>
            <span class="ic-valor">R$ ${F.formatarCentavos(p.centavos)}</span>
          </a>
        </li>`;
    }).join('');
  }

  $('#aviso').innerHTML = Shell.avisoArmazenamento();
})();
