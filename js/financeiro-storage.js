/* ============================================================
   financeiro-storage.js — pagamentos

   Um pagamento pertence sempre a um paciente e, opcionalmente, a uma
   consulta. O vínculo com a consulta é opcional de propósito: nem todo
   recebimento corresponde a um atendimento avulso — pacotes, planos
   mensais e retornos cortesia existem.

   Valores são guardados em CENTAVOS (inteiro). Somar reais em ponto
   flutuante acumula erro: 0,1 + 0,2 dá 0,30000000000000004, e num
   relatório financeiro isso vira centavo perdido.

   TROCA POR SUPABASE: único ponto a mexer, mantendo as assinaturas.
   ============================================================ */

'use strict';

const FinanceiroStore = (() => {

  const CHAVE = 'nutri:pagamentos:v1';

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

  function ler() {
    try {
      const dados = JSON.parse(localStorage.getItem(CHAVE) || '[]');
      return Array.isArray(dados) ? dados : [];
    } catch (e) {
      return [];
    }
  }

  function gravar(lista) {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(lista));
      return true;
    } catch (e) {
      return false;
    }
  }

  function novoId() {
    return 'pg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function ordenar(lista) {
    return lista.sort((a, b) => String(b.data).localeCompare(String(a.data)));
  }

  async function listarTodos() {
    return ordenar(ler());
  }

  /** Pagamentos com data dentro do mês 'YYYY-MM'. */
  async function listarPorMes(anoMes) {
    return ordenar(ler().filter((p) => String(p.data).slice(0, 7) === anoMes));
  }

  async function listarPorPaciente(pacienteId) {
    return ordenar(ler().filter((p) => p.pacienteId === pacienteId));
  }

  async function listarPendentes() {
    return ordenar(ler().filter((p) => p.status === 'pendente'));
  }

  async function obterPagamento(id) {
    return ler().find((p) => p.id === id) || null;
  }

  async function daConsulta(consultaId) {
    return ler().find((p) => p.consultaId === consultaId) || null;
  }

  async function salvarPagamento(dados) {
    if (!dados.pacienteId) return { ok: false, erro: 'Escolha o paciente.' };
    if (!dados.data) return { ok: false, erro: 'Informe a data.' };

    const centavos = paraCentavos(dados.valor);
    if (centavos <= 0) return { ok: false, erro: 'Informe um valor maior que zero.' };

    const lista = ler();
    const agora = new Date().toISOString();
    const status = STATUS.some((s) => s.valor === dados.status) ? dados.status : 'pendente';

    const registro = {
      id: dados.id || novoId(),
      pacienteId: dados.pacienteId,
      consultaId: dados.consultaId || '',
      data: dados.data,
      // Só faz sentido registrar quando foi pago se está pago.
      dataPagamento: status === 'pago' ? (dados.dataPagamento || dados.data) : '',
      centavos,
      forma: status === 'pago' ? (dados.forma || '') : (dados.forma || ''),
      status,
      descricao: String(dados.descricao || '').trim() || 'Consulta de nutrição',
      observacoes: String(dados.observacoes || '').trim(),
      criadoEm: dados.criadoEm || agora,
      atualizadoEm: agora
    };

    const i = lista.findIndex((p) => p.id === registro.id);
    if (i >= 0) {
      registro.criadoEm = lista[i].criadoEm || agora;
      lista[i] = registro;
    } else {
      lista.push(registro);
    }

    if (!gravar(lista)) return { ok: false, erro: 'Não foi possível salvar neste navegador.' };
    return { ok: true, pagamento: registro };
  }

  /** Marca como pago sem abrir o formulário inteiro. */
  async function marcarComoPago(id, dataPagamento, forma) {
    const lista = ler();
    const p = lista.find((x) => x.id === id);
    if (!p) return { ok: false, erro: 'Pagamento não encontrado.' };

    p.status = 'pago';
    p.dataPagamento = dataPagamento || p.data;
    if (forma) p.forma = forma;
    p.atualizadoEm = new Date().toISOString();

    return { ok: gravar(lista), pagamento: p };
  }

  async function removerPagamento(id) {
    return { ok: gravar(ler().filter((p) => p.id !== id)) };
  }

  async function removerDoPaciente(pacienteId) {
    return { ok: gravar(ler().filter((p) => p.pacienteId !== pacienteId)) };
  }

  /**
   * Números do período. Tudo em centavos, para somar sem erro de arredondamento.
   * @param {Array} lista pagamentos já filtrados
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

  return {
    FORMAS, STATUS, rotuloForma, rotuloStatus, nivelStatus,
    paraCentavos, formatarCentavos, emReais,
    listarTodos, listarPorMes, listarPorPaciente, listarPendentes,
    obterPagamento, daConsulta, salvarPagamento, marcarComoPago,
    removerPagamento, removerDoPaciente, resumir
  };
})();
