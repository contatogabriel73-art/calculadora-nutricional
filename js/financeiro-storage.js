/* ============================================================
   financeiro-storage.js — pagamentos (tabela `pagamentos`)

   Um pagamento pertence sempre a um paciente e, opcionalmente, a uma
   consulta. O vínculo com a consulta é opcional de propósito: nem todo
   recebimento corresponde a um atendimento avulso — pacotes, planos
   mensais e retornos cortesia existem.

   Valores continuam em CENTAVOS (inteiro), agora numa coluna `integer`.
   Somar reais em ponto flutuante acumula erro: 0,1 + 0,2 dá
   0,30000000000000004, e num relatório financeiro isso vira centavo
   perdido.

   O paciente NÃO lê esta tabela. Não é esquecimento: o financeiro é a
   contabilidade do consultório, não o extrato dele. Não existe política
   de leitura para o papel `paciente` em `pagamentos`.

   ⚠️ `serieMensal` e `porSemanaDoMes` eram síncronas e agora são
   assíncronas — elas liam a lista inteira da memória e agora consultam
   o banco. Quem chama precisa de `await`.
   ============================================================ */

'use strict';

const FinanceiroStore = (() => {

  const COLUNAS = 'id, nutricionista_id, paciente_id, consulta_id, data, ' +
                  'data_pagamento, centavos, forma, status, descricao, ' +
                  'observacoes, criado_em, atualizado_em';

  const FORMAS = [
    { valor: 'pix', rotulo: 'PIX' },
    { valor: 'dinheiro', rotulo: 'Dinheiro' },
    { valor: 'cartao-credito', rotulo: 'Cartão de crédito' },
    { valor: 'cartao-debito', rotulo: 'Cartão de débito' },
    { valor: 'transferencia', rotulo: 'Transferência' },
    { valor: 'boleto', rotulo: 'Boleto' },
    { valor: 'convenio', rotulo: 'Convênio' }
  ];

  const STATUS = [
    { valor: 'pago', rotulo: 'Pago', nivel: 'ok' },
    { valor: 'pendente', rotulo: 'Pendente', nivel: 'atencao' }
  ];

  function rotuloForma(valor) {
    const f = FORMAS.find((x) => x.valor === valor);
    return f ? f.rotulo : valor || '—';
  }

  function rotuloStatus(valor) {
    const s = STATUS.find((x) => x.valor === valor);
    return s ? s.rotulo : valor;
  }

  function nivelStatus(valor) {
    const s = STATUS.find((x) => x.valor === valor);
    return s ? s.nivel : 'baixo';
  }

  /** "1.234,56" ou "1234.56" → 123456 centavos. */
  function paraCentavos(texto) {
    if (typeof texto === 'number') return Math.round(texto * 100);
    let limpo = String(texto || '').trim().replace(/[^0-9,.]/g, '');
    if (!limpo) return 0;

    // Com vírgula, ela é o separador decimal e o ponto é milhar.
    if (limpo.includes(',')) limpo = limpo.replace(/\./g, '').replace(',', '.');

    const n = parseFloat(limpo);
    return isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
  }

  /** 123456 → "1.234,56" */
  function formatarCentavos(centavos) {
    return ((Number(centavos) || 0) / 100)
      .toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function emReais(centavos) {
    return (Number(centavos) || 0) / 100;
  }

  function daLinha(linha) {
    if (!linha) return null;
    return {
      id: linha.id,
      nutricionistaId: linha.nutricionista_id,
      pacienteId: linha.paciente_id,
      consultaId: linha.consulta_id || '',
      data: linha.data,
      dataPagamento: linha.data_pagamento || '',
      centavos: Number(linha.centavos) || 0,
      forma: linha.forma || '',
      status: linha.status,
      descricao: linha.descricao || '',
      observacoes: linha.observacoes || '',
      criadoEm: linha.criado_em,
      atualizadoEm: linha.atualizado_em
    };
  }

  function paraLinha(dados) {
    const status = STATUS.some((s) => s.valor === dados.status) ? dados.status : 'pendente';
    return {
      paciente_id: dados.pacienteId,
      // Coluna com chave estrangeira: sem consulta é null, não ''.
      consulta_id: dados.consultaId || null,
      data: dados.data,
      // Só faz sentido registrar quando foi pago se está pago.
      data_pagamento: status === 'pago' ? (dados.dataPagamento || dados.data) : null,
      centavos: paraCentavos(dados.valor),
      forma: dados.forma || '',
      status,
      descricao: String(dados.descricao || '').trim() || 'Consulta de nutrição',
      observacoes: String(dados.observacoes || '').trim()
    };
  }

  /* Primeiro dia do mês seguinte, para usar `< limite` em vez de
     `<= dia 31` — que erraria em fevereiro e nos meses de 30 dias. */
  function limiteDoMes(anoMes) {
    const [ano, mes] = String(anoMes).split('-').map(Number);
    const d = new Date(Date.UTC(ano, mes, 1));
    return d.toISOString().slice(0, 10);
  }

  function primeiroDia(anoMes) {
    return anoMes + '-01';
  }

  async function buscar(montar) {
    const base = Banco.tabela('pagamentos').select(COLUNAS)
      .order('data', { ascending: false });
    const { data, error } = await (montar ? montar(base) : base);
    if (error) {
      console.error('financeiro:', error);
      return [];
    }
    return (data || []).map(daLinha);
  }

  async function listarTodos() {
    return buscar(null);
  }

  /** Pagamentos com data dentro do mês 'YYYY-MM'. */
  async function listarPorMes(anoMes) {
    return buscar((q) => q.gte('data', primeiroDia(anoMes)).lt('data', limiteDoMes(anoMes)));
  }

  async function listarPorPaciente(pacienteId) {
    return buscar((q) => q.eq('paciente_id', pacienteId));
  }

  async function listarPendentes() {
    return buscar((q) => q.eq('status', 'pendente'));
  }

  async function obterPagamento(id) {
    if (!id) return null;
    const { data, error } = await Banco.tabela('pagamentos')
      .select(COLUNAS).eq('id', id).maybeSingle();
    return error ? null : daLinha(data);
  }

  async function daConsulta(consultaId) {
    if (!consultaId) return null;
    const { data, error } = await Banco.tabela('pagamentos')
      .select(COLUNAS).eq('consulta_id', consultaId).limit(1);
    return error || !data || !data.length ? null : daLinha(data[0]);
  }

  async function salvarPagamento(dados) {
    if (!dados.pacienteId) return { ok: false, erro: 'Escolha o paciente.' };
    if (!dados.data) return { ok: false, erro: 'Informe a data.' };

    const campos = paraLinha(dados);
    if (campos.centavos <= 0) return { ok: false, erro: 'Informe um valor maior que zero.' };

    if (dados.id) {
      const { data, error } = await Banco.tabela('pagamentos')
        .update(campos).eq('id', dados.id).select(COLUNAS);

      if (error) return { ok: false, erro: Banco.traduzirErro(error) };
      if (!data || !data.length) {
        return { ok: false, erro: 'Este lançamento não está mais disponível para edição.' };
      }
      return { ok: true, pagamento: daLinha(data[0]) };
    }

    const nutricionistaId = await Auth.idAtual();
    if (!nutricionistaId) return { ok: false, erro: 'Sua sessão expirou. Entre novamente.' };

    const { data, error } = await Banco.tabela('pagamentos')
      .insert(Object.assign({ nutricionista_id: nutricionistaId }, campos))
      .select(COLUNAS);

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    return { ok: true, pagamento: daLinha(data[0]) };
  }

  /** Marca como pago sem abrir o formulário inteiro. */
  async function marcarComoPago(id, dataPagamento, forma) {
    const atual = await obterPagamento(id);
    if (!atual) return { ok: false, erro: 'Pagamento não encontrado.' };

    const mudanca = {
      status: 'pago',
      data_pagamento: dataPagamento || atual.data
    };
    if (forma) mudanca.forma = forma;

    const { data, error } = await Banco.tabela('pagamentos')
      .update(mudanca).eq('id', id).select(COLUNAS);

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    if (!data || !data.length) return { ok: false, erro: 'Pagamento não encontrado.' };
    return { ok: true, pagamento: daLinha(data[0]) };
  }

  async function removerPagamento(id) {
    const { data, error } = await Banco.tabela('pagamentos')
      .delete().eq('id', id).select('id');
    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    return { ok: !!(data && data.length) };
  }

  /* O banco já apaga junto com o paciente (on delete cascade). */
  async function removerDoPaciente(pacienteId) {
    const { error } = await Banco.tabela('pagamentos').delete().eq('paciente_id', pacienteId);
    return { ok: !error };
  }

  /**
   * Números do período. Continua síncrona: recebe a lista já carregada.
   * Tudo em centavos, para somar sem erro de arredondamento.
   */
  function resumir(lista) {
    const recebido = lista.filter((p) => p.status === 'pago')
      .reduce((s, p) => s + (p.centavos || 0), 0);
    const pendente = lista.filter((p) => p.status === 'pendente')
      .reduce((s, p) => s + (p.centavos || 0), 0);

    const porForma = {};
    lista.filter((p) => p.status === 'pago').forEach((p) => {
      const chave = p.forma || 'sem-forma';
      porForma[chave] = (porForma[chave] || 0) + (p.centavos || 0);
    });

    return {
      recebido,
      pendente,
      total: recebido + pendente,
      quantidade: lista.length,
      quantidadePagos: lista.filter((p) => p.status === 'pago').length,
      quantidadePendentes: lista.filter((p) => p.status === 'pendente').length,
      porForma
    };
  }

  /* ───────────── Análises ───────────── */

  /**
   * Série dos últimos N meses, do mais antigo para o mais recente.
   *
   * Uma consulta só cobrindo a janela inteira, agrupada aqui — e não
   * uma consulta por mês. Doze idas ao banco para desenhar um gráfico
   * seria doze vezes a latência da rede.
   *
   * @param {number} meses quantidade de meses
   * @param {Date} referencia último mês da série (padrão: hoje)
   * @returns {Promise<Array>}
   */
  async function serieMensal(meses, referencia) {
    const base = referencia || new Date();
    const primeiro = new Date(base.getFullYear(), base.getMonth() - (meses - 1), 1);
    const inicio = primeiro.getFullYear() + '-' +
                   String(primeiro.getMonth() + 1).padStart(2, '0') + '-01';
    const fim = limiteDoMes(base.getFullYear() + '-' + String(base.getMonth() + 1).padStart(2, '0'));

    const todos = await buscar((q) => q.gte('data', inicio).lt('data', fim));
    const saida = [];

    for (let i = meses - 1; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const chave = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const r = resumir(todos.filter((p) => String(p.data).slice(0, 7) === chave));
      saida.push({
        anoMes: chave,
        ano: d.getFullYear(),
        mes: d.getMonth(),
        recebido: r.recebido,
        pendente: r.pendente,
        quantidade: r.quantidade
      });
    }
    return saida;
  }

  /**
   * Receita agrupada por semana dentro de um mês.
   * Agrupa por faixa de dia (1–7, 8–14, …) em vez de semana do calendário:
   * é determinístico, não depende do dia da semana em que o mês começa, e
   * o profissional lê "primeira semana do mês" da mesma forma todo mês.
   *
   * @param {string} anoMes 'YYYY-MM'
   * @param {Array} [lista] pagamentos já carregados; sem ela, busca no banco
   * @returns {Promise<Array>}
   */
  async function porSemanaDoMes(anoMes, lista) {
    const doMes = lista || await listarPorMes(anoMes);
    const faixas = [
      { rotulo: '1 a 7', de: 1, ate: 7 },
      { rotulo: '8 a 14', de: 8, ate: 14 },
      { rotulo: '15 a 21', de: 15, ate: 21 },
      { rotulo: '22 a 28', de: 22, ate: 28 },
      { rotulo: '29 ao fim', de: 29, ate: 31 }
    ];

    const semanas = faixas.map((f) => ({
      rotulo: f.rotulo, recebido: 0, pendente: 0, quantidade: 0
    }));

    doMes.forEach((p) => {
      const dia = Number(String(p.data).slice(8, 10));
      const i = faixas.findIndex((f) => dia >= f.de && dia <= f.ate);
      if (i < 0) return;
      if (p.status === 'pago') semanas[i].recebido += p.centavos || 0;
      else semanas[i].pendente += p.centavos || 0;
      semanas[i].quantidade++;
    });

    // Marca a de maior e a de menor receita, ignorando semanas sem nada:
    // destacar "R$ 0" como a pior semana não informa nada útil.
    const comReceita = semanas.filter((s) => s.recebido > 0);
    if (comReceita.length >= 2) {
      const max = Math.max(...comReceita.map((s) => s.recebido));
      const min = Math.min(...comReceita.map((s) => s.recebido));
      semanas.forEach((s) => {
        s.melhor = s.recebido === max && s.recebido > 0;
        s.pior = s.recebido === min && s.recebido > 0 && max !== min;
      });
    }

    return semanas;
  }

  /**
   * Proporção do valor pendente sobre o total do período.
   * @returns {number|null} 0 a 100; null quando não há nada no período
   */
  function taxaInadimplencia(resumo) {
    if (!resumo || resumo.total <= 0) return null;
    return (resumo.pendente / resumo.total) * 100;
  }

  function ticketMedio(resumo) {
    if (!resumo || !resumo.quantidadePagos) return null;
    return Math.round(resumo.recebido / resumo.quantidadePagos);
  }

  return {
    FORMAS, STATUS, rotuloForma, rotuloStatus, nivelStatus,
    paraCentavos, formatarCentavos, emReais,
    listarTodos, listarPorMes, listarPorPaciente, listarPendentes,
    obterPagamento, daConsulta, salvarPagamento, marcarComoPago,
    removerPagamento, removerDoPaciente, resumir,
    serieMensal, porSemanaDoMes, taxaInadimplencia, ticketMedio
  };
})();
