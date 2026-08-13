/* ============================================================
   financeiro.js — lançamentos, resumo do mês e recibo

   Valores circulam em centavos (inteiro) e só viram texto na hora de
   exibir. Ver a justificativa em js/financeiro-storage.js.
   ============================================================ */

'use strict';

(async () => {

  if (!(await Auth.exigirLogin())) return;
  await Shell.montarCabecalho('financeiro');

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = Shell.escapar;
  const F = FinanceiroStore;

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  /* Data de hoje pelos componentes locais — toISOString() converte para UTC
     e, à noite no Brasil, já aponta para o dia seguinte. */
  const agora = new Date();
  const doisDigitos = (n) => String(n).padStart(2, '0');
  const hojeIso = agora.getFullYear() + '-' + doisDigitos(agora.getMonth() + 1) + '-' + doisDigitos(agora.getDate());

  let referencia = new Date(agora.getFullYear(), agora.getMonth(), 1);
  let filtro = 'todos';
  let pacientes = [];
  let porId = new Map();

  const nomeDe = (id) => (porId.get(id) ? porId.get(id).nome : 'Paciente removido');
  const anoMes = () => referencia.getFullYear() + '-' + doisDigitos(referencia.getMonth() + 1);

  /* ───────────── Perfil do emitente ───────────── */

  async function carregarPerfil() {
    const perfil = await PerfilStore.obterPerfil();
    $$('[data-perfil]').forEach((i) => { i.value = perfil ? (perfil[i.dataset.perfil] || '') : ''; });
    $('#perfil-estado').textContent = PerfilStore.perfilCompleto(perfil)
      ? 'Preenchido'
      : 'Preencha para conseguir emitir recibo';
  }

  $('#form-perfil').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const dados = {};
    $$('[data-perfil]').forEach((i) => { dados[i.dataset.perfil] = i.value; });

    if (!dados.nome.trim()) { Shell.toast('O nome do profissional é obrigatório para o recibo.'); return; }

    const resultado = await PerfilStore.salvarPerfil(dados);
    if (!resultado.ok) { Shell.toast(resultado.erro); return; }
    $('#perfil-estado').textContent = 'Preenchido';
    Shell.toast('Dados salvos.');
  });

  /* ───────────── Resumo ───────────── */

  /**
   * @param {string} unidade prefixo antes do número; '' para valores que
   *   não são dinheiro (a inadimplência é percentual, não reais).
   */
  function cartao(rotulo, valor, extra, destaque, unidade) {
    const prefixo = unidade === undefined ? 'R$' : unidade;
    return `
      <div class="metrica ${destaque || ''}">
        <span class="metrica-rotulo">${rotulo}</span>
        <span class="metrica-valor">${prefixo ? '<em>' + prefixo + '</em> ' : ''}${valor}</span>
        ${extra ? `<span class="metrica-extra">${extra}</span>` : ''}
      </div>`;
  }

  /**
   * Receita projetada: consultas do mês ainda sem lançamento, valorizadas
   * pelo ticket médio. É estimativa — a interface precisa dizer isso, senão
   * vira "dinheiro que eu já tenho" na cabeça de quem lê.
   */
  async function projetar(doMes, ticket) {
    if (!ticket) return null;

    const ultimoDia = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 0).getDate();
    const inicio = anoMes() + '-01';
    const fim = anoMes() + '-' + doisDigitos(ultimoDia);

    const consultas = await AgendaStore.listarPorPeriodo(inicio, fim);
    const comLancamento = new Set(doMes.map((p) => p.consultaId).filter(Boolean));

    // Canceladas não geram receita; as já lançadas não podem contar duas vezes.
    const semLancamento = consultas.filter((c) =>
      c.status !== 'cancelada' && !comLancamento.has(c.id));

    if (!semLancamento.length) return null;
    return { consultas: semLancamento.length, centavos: semLancamento.length * ticket };
  }

  async function desenharResumo() {
    const doMes = await F.listarPorMes(anoMes());
    const r = F.resumir(doMes);

    const m = MESES[referencia.getMonth()];
    $('#titulo-mes').textContent = m.charAt(0).toUpperCase() + m.slice(1) + ' de ' + referencia.getFullYear();

    const ticket = F.ticketMedio(r);
    const inadimplencia = F.taxaInadimplencia(r);
    const projecao = await projetar(doMes, ticket);

    const cartoes = [
      cartao('Recebido no mês', F.formatarCentavos(r.recebido),
        `${r.quantidadePagos} ${r.quantidadePagos === 1 ? 'pagamento' : 'pagamentos'}`, 'metrica-verde'),
      cartao('A receber no mês', F.formatarCentavos(r.pendente),
        `${r.quantidadePendentes} ${r.quantidadePendentes === 1 ? 'pendência' : 'pendências'}`,
        r.pendente > 0 ? 'metrica-alerta' : ''),
      cartao('Ticket médio', ticket ? F.formatarCentavos(ticket) : '—',
        ticket ? 'por consulta paga' : 'sem pagamento no mês'),
      cartao('Inadimplência',
        inadimplencia == null ? '—' : formatarPct(inadimplencia),
        inadimplencia == null ? 'sem lançamentos' : 'do previsto no mês',
        inadimplencia != null && inadimplencia >= 25 ? 'metrica-alerta' : '',
        '')   // percentual, não reais
    ];

    if (projecao) {
      cartoes.push(cartao('Projeção', F.formatarCentavos(projecao.centavos),
        `<span class="marca-estimativa">estimativa</span> ${projecao.consultas} ` +
        `${projecao.consultas === 1 ? 'consulta sem lançamento' : 'consultas sem lançamento'}`,
        'metrica-estimativa'));
    }

    $('#cartoes-resumo').innerHTML = cartoes.join('');

    if (projecao) {
      $('#nota-projecao').innerHTML =
        `A projeção multiplica as ${projecao.consultas} consultas do mês que ainda não têm ` +
        `lançamento pelo ticket médio de R$ ${F.formatarCentavos(ticket)}. ` +
        `É uma referência de quanto o mês pode fechar, <strong>não</strong> valor confirmado.`;
      $('#nota-projecao').hidden = false;
    } else {
      $('#nota-projecao').hidden = true;
    }

    // Quebra por forma de pagamento, só do que foi efetivamente recebido.
    const formas = Object.entries(r.porForma).sort((a, b) => b[1] - a[1]);
    $('#por-forma').innerHTML = formas.length
      ? '<span class="por-forma-titulo">Recebido por forma:</span>' + formas.map(([chave, centavos]) =>
          `<span class="chip">${esc(chave === 'sem-forma' ? 'Não informada' : F.rotuloForma(chave))}
           · R$ ${F.formatarCentavos(centavos)}</span>`).join('')
      : '';
  }

  const formatarPct = (v) =>
    v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

  /* ───────────── Gráficos ───────────── */

  const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                        'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  // Assíncrona desde que serieMensal/porSemanaDoMes passaram a consultar
  // o banco em vez de ler a lista da memória.
  async function desenharGraficos() {
    if (!Graficos.disponivel()) {
      $('#caixa-mensal').innerHTML = Graficos.avisoIndisponivel();
      $('#caixa-semanal').innerHTML = '';
      $('#legenda-semanas').textContent = '';
      return;
    }

    const janela = Number($('#janela-meses').value) || 12;
    const serie = await F.serieMensal(janela, referencia);

    Graficos.desenhar('grafico-mensal', {
      type: 'bar',
      data: {
        labels: serie.map((m) => MESES_CURTOS[m.mes] + (m.mes === 0 ? '/' + String(m.ano).slice(2) : '')),
        datasets: [
          {
            label: 'Recebido',
            data: serie.map((m) => F.emReais(m.recebido)),
            backgroundColor: Graficos.CORES.verde,
            borderRadius: 5,
            maxBarThickness: 38
          },
          {
            label: 'Pendente',
            data: serie.map((m) => F.emReais(m.pendente)),
            backgroundColor: Graficos.CORES.ambarClaro,
            borderColor: Graficos.CORES.ambar,
            borderWidth: 1,
            borderRadius: 5,
            maxBarThickness: 38
          }
        ]
      },
      options: {
        plugins: {
          legend: { display: true, position: 'bottom' },
          tooltip: { callbacks: { label: (c) => c.dataset.label + ': R$ ' + F.formatarCentavos(c.parsed.y * 100) } }
        },
        scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => 'R$ ' + v } } }
      }
    });

    // ── Semanas do mês ──
    const semanas = await F.porSemanaDoMes(anoMes());
    const temReceita = semanas.some((s) => s.recebido > 0);

    if (!temReceita) {
      Graficos.destruir('grafico-semanal');
      $('#caixa-semanal').innerHTML =
        Graficos.estadoVazio('Nenhuma receita recebida neste mês ainda.');
      $('#legenda-semanas').textContent = '';
      return;
    }

    // Recria o canvas: um estado vazio anterior pode tê-lo removido.
    if (!document.getElementById('grafico-semanal')) {
      $('#caixa-semanal').innerHTML =
        '<canvas id="grafico-semanal" aria-label="Receita por semana dentro do mês"></canvas>';
    }

    const melhor = semanas.find((s) => s.melhor);
    const pior = semanas.find((s) => s.pior);
    $('#legenda-semanas').innerHTML = melhor
      ? `Melhor semana: <strong>${esc(melhor.rotulo)}</strong> (R$ ${F.formatarCentavos(melhor.recebido)})` +
        (pior ? ` · menor: <strong>${esc(pior.rotulo)}</strong> (R$ ${F.formatarCentavos(pior.recebido)})` : '')
      : 'Dias do mês agrupados em faixas de sete.';

    Graficos.desenhar('grafico-semanal', {
      type: 'bar',
      data: {
        labels: semanas.map((s) => s.rotulo),
        datasets: [{
          label: 'Recebido',
          data: semanas.map((s) => F.emReais(s.recebido)),
          // Destaque visual da melhor e da pior semana.
          backgroundColor: semanas.map((s) =>
            s.melhor ? Graficos.CORES.verde
            : s.pior ? Graficos.CORES.ambar
            : Graficos.CORES.verdeMedio),
          borderRadius: 5,
          maxBarThickness: 54
        }]
      },
      options: {
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => 'R$ ' + F.formatarCentavos(c.parsed.y * 100),
              afterLabel: (c) => {
                const s = semanas[c.dataIndex];
                return s.melhor ? 'maior receita do mês'
                     : s.pior ? 'menor receita do mês'
                     : (s.quantidade + (s.quantidade === 1 ? ' lançamento' : ' lançamentos'));
              }
            }
          }
        },
        scales: { y: { ticks: { callback: (v) => 'R$ ' + v } } }
      }
    });
  }

  /* ───────────── Listas ───────────── */

  function linhaPagamento(p, mostrarMes) {
    const nivel = F.nivelStatus(p.status);
    const atrasado = p.status === 'pendente' && p.data < hojeIso;

    const detalhes = [
      esc(p.descricao),
      p.status === 'pago' && p.forma ? esc(F.rotuloForma(p.forma)) : '',
      mostrarMes ? esc(Shell.formatarData(p.data)) : ''
    ].filter(Boolean).join(' · ');

    return `
      <li class="pagamento-item status-borda-${nivel}">
        <div class="pagamento-info">
          <div class="pagamento-topo">
            <span class="pagamento-nome">${esc(nomeDe(p.pacienteId))}</span>
            <span class="pagamento-valor">R$ ${F.formatarCentavos(p.centavos)}</span>
          </div>
          <div class="pagamento-detalhe">
            ${!mostrarMes ? esc(Shell.formatarData(p.data)) + ' · ' : ''}${detalhes}
          </div>
          <div class="pagamento-tags">
            <span class="tag tag-${nivel}">${esc(F.rotuloStatus(p.status))}</span>
            ${atrasado ? '<span class="tag tag-alto">em atraso</span>' : ''}
          </div>
        </div>
        <div class="pagamento-acoes">
          ${p.status === 'pendente'
            ? `<button class="btn btn-ghost btn-sm" type="button" data-pagar="${p.id}">Marcar pago</button>`
            : `<a class="btn btn-ghost btn-sm" href="recibo.html?pagamento=${encodeURIComponent(p.id)}">Recibo</a>`}
          <button class="btn-editar" type="button" data-editar="${p.id}" aria-label="Editar lançamento">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>
            </svg>
          </button>
        </div>
      </li>`;
  }

  async function desenharListas() {
    const doMes = await F.listarPorMes(anoMes());
    const filtrados = filtro === 'todos' ? doMes : doMes.filter((p) => p.status === filtro);

    $('#badge-mes').textContent = doMes.length;
    $('#sem-pagamentos').hidden = filtrados.length > 0;
    $('#lista-pagamentos').innerHTML = filtrados.map((p) => linhaPagamento(p, false)).join('');

    // Pendências de qualquer período — a mais útil das visões para cobrar.
    const pendentes = await F.listarPendentes();
    $('#bloco-pendencias').hidden = pendentes.length === 0;
    $('#badge-pendentes').textContent = pendentes.length;
    const totalPendente = pendentes.reduce((s, p) => s + p.centavos, 0);
    $('#total-pendente-geral').textContent = 'R$ ' + F.formatarCentavos(totalPendente);
    $('#lista-pendencias').innerHTML = pendentes.map((p) => linhaPagamento(p, true)).join('');
  }

  async function redesenhar() {
    await desenharResumo();
    await desenharListas();
    await desenharGraficos();
  }

  /* ───────────── Navegação ───────────── */

  $('#btn-anterior').addEventListener('click', () => {
    referencia = new Date(referencia.getFullYear(), referencia.getMonth() - 1, 1);
    redesenhar();
  });
  $('#btn-proximo').addEventListener('click', () => {
    referencia = new Date(referencia.getFullYear(), referencia.getMonth() + 1, 1);
    redesenhar();
  });
  $('#btn-hoje').addEventListener('click', () => {
    referencia = new Date(agora.getFullYear(), agora.getMonth(), 1);
    redesenhar();
  });

  $('#janela-meses').addEventListener('change', desenharGraficos);

  $$('.alternador-opcao').forEach((b) => b.addEventListener('click', () => {
    filtro = b.dataset.filtro;
    $$('.alternador-opcao').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    desenharListas();
  }));

  /* ───────────── Diálogo ───────────── */

  const dialogo = $('#dialogo');

  $('#pg-forma').innerHTML = '<option value="">Não informada</option>' +
    F.FORMAS.map((f) => `<option value="${f.valor}">${esc(f.rotulo)}</option>`).join('');
  $('#pg-status').innerHTML = F.STATUS.map((s) => `
    <label><input type="radio" name="status" value="${s.valor}"> ${s.rotulo}</label>`).join('');

  async function preencherConsultas(pacienteId, selecionada) {
    const alvo = $('#pg-consulta');
    if (!pacienteId) {
      alvo.innerHTML = '<option value="">Escolha o paciente primeiro</option>';
      return;
    }
    const consultas = await AgendaStore.listarPorPaciente(pacienteId);
    alvo.innerHTML = '<option value="">Sem vínculo</option>' +
      consultas.map((c) =>
        `<option value="${c.id}">${esc(Shell.formatarData(c.data))} ${esc(c.hora)} — ${esc(c.tipo)}</option>`).join('');
    if (selecionada) alvo.value = selecionada;
  }

  $('#pg-paciente').addEventListener('change', () => preencherConsultas($('#pg-paciente').value, ''));

  $('#pg-valor').addEventListener('input', () => {
    const centavos = F.paraCentavos($('#pg-valor').value);
    $('#pg-extenso').textContent = centavos > 0 ? Extenso.reais(F.emReais(centavos)) : '';
  });

  function lerFormulario() {
    const status = document.querySelector('input[name="status"]:checked');
    return {
      id: $('#pg-id').value || undefined,
      pacienteId: $('#pg-paciente').value,
      consultaId: $('#pg-consulta').value,
      valor: $('#pg-valor').value,
      data: $('#pg-data').value,
      status: status ? status.value : 'pendente',
      forma: $('#pg-forma').value,
      descricao: $('#pg-descricao').value,
      observacoes: $('#pg-observacoes').value
    };
  }

  async function abrirDialogo(pagamento) {
    $('#dialogo-titulo').textContent = pagamento ? 'Editar lançamento' : 'Novo lançamento';
    $('#pg-id').value = pagamento ? pagamento.id : '';

    $('#pg-paciente').innerHTML = '<option value="">Selecione…</option>' +
      pacientes.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
    if (pagamento) $('#pg-paciente').value = pagamento.pacienteId;

    await preencherConsultas(pagamento ? pagamento.pacienteId : '', pagamento ? pagamento.consultaId : '');

    $('#pg-valor').value = pagamento ? F.formatarCentavos(pagamento.centavos) : '';
    $('#pg-data').value = pagamento ? pagamento.data : hojeIso;
    $('#pg-forma').value = pagamento ? (pagamento.forma || '') : 'pix';
    $('#pg-descricao').value = pagamento ? pagamento.descricao : '';
    $('#pg-observacoes').value = pagamento ? pagamento.observacoes : '';

    const alvo = pagamento ? pagamento.status : 'pago';
    $$('input[name="status"]').forEach((r) => { r.checked = r.value === alvo; });

    $('#pg-valor').dispatchEvent(new Event('input'));
    $('#btn-excluir').hidden = !pagamento;
    $('#erro-pagamento').hidden = true;

    dialogo.showModal();
    ($('#pg-paciente').value ? $('#pg-valor') : $('#pg-paciente')).focus();
  }

  $('#btn-novo').addEventListener('click', () => abrirDialogo(null));
  $('#cancelar').addEventListener('click', () => dialogo.close());
  $('#fechar-dialogo').addEventListener('click', () => dialogo.close());

  $('#form-pagamento').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erro = $('#erro-pagamento');
    erro.hidden = true;

    const resultado = await F.salvarPagamento(lerFormulario());
    if (!resultado.ok) {
      erro.textContent = resultado.erro;
      erro.hidden = false;
      return;
    }
    dialogo.close();
    await redesenhar();
    Shell.toast('Lançamento salvo.');
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

    await F.removerPagamento($('#pg-id').value);
    dialogo.close();
    await redesenhar();
    Shell.toast('Lançamento excluído.');
  });

  /* ───────────── Ações das listas ───────────── */

  document.addEventListener('click', async (ev) => {
    const pagar = ev.target.closest('[data-pagar]');
    if (pagar) {
      await F.marcarComoPago(pagar.dataset.pagar, hojeIso, null);
      await redesenhar();
      Shell.toast('Marcado como pago.');
      return;
    }
    const editar = ev.target.closest('[data-editar]');
    if (editar) abrirDialogo(await F.obterPagamento(editar.dataset.editar));
  });

  /* ───────────── Início ───────────── */

  pacientes = await PacientesStore.listarPacientes();
  porId = new Map(pacientes.map((p) => [p.id, p]));

  await carregarPerfil();
  await redesenhar();

  // Abrir já com um lançamento novo (vindo do prontuário ou da agenda).
  const params = new URLSearchParams(location.search);
  if (params.get('novo') === '1') {
    await abrirDialogo(null);
    if (params.get('paciente') && porId.has(params.get('paciente'))) {
      $('#pg-paciente').value = params.get('paciente');
      await preencherConsultas(params.get('paciente'), params.get('consulta') || '');
    }
  }
})();
