/* ============================================================
   agenda-storage.js — consultas

   Cada consulta pertence a um paciente e tem data, horário, duração,
   tipo e situação. Tudo local por enquanto.

   TROCA POR SUPABASE: único ponto a mexer.
     listarPorPeriodo / listarPorPaciente → select com filtro de data
     salvarConsulta                        → upsert
     removerConsulta                       → delete

   A integração real com Google Agenda depende de backend e fica para
   depois; o formato aqui já guarda o que ela precisaria (data, hora,
   duração e um campo livre de observações).
   ============================================================ */

'use strict';

const AgendaStore = (() => {

  const CHAVE = 'nutri:consultas:v1';

  const STATUS = [
    { valor: 'agendada',  rotulo: 'Agendada',  nivel: 'baixo' },
    { valor: 'confirmada', rotulo: 'Confirmada', nivel: 'ok' },
    { valor: 'realizada', rotulo: 'Realizada', nivel: 'feito' },
    { valor: 'cancelada', rotulo: 'Cancelada', nivel: 'alto' }
  ];

  const TIPOS = [
    'Primeira consulta',
    'Retorno',
    'Avaliação antropométrica',
    'Entrega de plano',
    'Atendimento online'
  ];

  function rotuloStatus(valor) {
    const s = STATUS.find((x) => x.valor === valor);
    return s ? s.rotulo : valor;
  }

  function nivelStatus(valor) {
    const s = STATUS.find((x) => x.valor === valor);
    return s ? s.nivel : 'baixo';
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
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /** Ordena por data e hora, da mais antiga para a mais recente. */
  function ordenar(lista) {
    return lista.sort((a, b) =>
      (a.data + a.hora).localeCompare(b.data + b.hora));
  }

  /** Consultas entre duas datas ISO, inclusive nas pontas. */
  async function listarPorPeriodo(inicioIso, fimIso) {
    return ordenar(ler().filter((c) => c.data >= inicioIso && c.data <= fimIso));
  }

  async function listarPorPaciente(pacienteId) {
    return ordenar(ler().filter((c) => c.pacienteId === pacienteId));
  }

  /** Próxima consulta futura (ou de hoje) que não foi cancelada. */
  async function proximaDoPaciente(pacienteId, hojeIso) {
    return (await listarPorPaciente(pacienteId))
      .find((c) => c.data >= hojeIso && c.status !== 'cancelada') || null;
  }

  async function obterConsulta(id) {
    return ler().find((c) => c.id === id) || null;
  }

  async function contarPorPaciente(pacienteId) {
    return ler().filter((c) => c.pacienteId === pacienteId).length;
  }

  /**
   * Outras consultas que ocupam o mesmo intervalo de tempo.
   * Serve para avisar sobre choque de horário — não bloqueia, porque
   * atendimento sobreposto às vezes é intencional.
   */
  async function conflitos(consulta) {
    const inicio = minutos(consulta.hora);
    const fim = inicio + (Number(consulta.duracao) || 60);

    return ler().filter((c) => {
      if (c.id === consulta.id) return false;
      if (c.data !== consulta.data) return false;
      if (c.status === 'cancelada') return false;
      const i = minutos(c.hora);
      const f = i + (Number(c.duracao) || 60);
      return inicio < f && i < fim;
    });
  }

  function minutos(hora) {
    const [h, m] = String(hora || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  async function salvarConsulta(dados) {
    if (!dados.pacienteId) return { ok: false, erro: 'Escolha o paciente.' };
    if (!dados.data) return { ok: false, erro: 'Informe a data.' };
    if (!dados.hora) return { ok: false, erro: 'Informe o horário.' };

    const lista = ler();
    const agora = new Date().toISOString();

    const registro = {
      id: dados.id || novoId(),
      pacienteId: dados.pacienteId,
      data: dados.data,
      hora: dados.hora,
      duracao: Number(dados.duracao) || 60,
      tipo: String(dados.tipo || '').trim() || 'Consulta',
      status: STATUS.some((s) => s.valor === dados.status) ? dados.status : 'agendada',
      observacoes: String(dados.observacoes || '').trim(),
      criadoEm: dados.criadoEm || agora,
      atualizadoEm: agora
    };

    const i = lista.findIndex((c) => c.id === registro.id);
    if (i >= 0) {
      registro.criadoEm = lista[i].criadoEm || agora;
      lista[i] = registro;
    } else {
      lista.push(registro);
    }

    if (!gravar(lista)) {
      return { ok: false, erro: 'Não foi possível salvar neste navegador.' };
    }
    return { ok: true, consulta: registro };
  }

  /** Muda só a situação, sem abrir o formulário inteiro. */
  async function alterarStatus(id, status) {
    const lista = ler();
    const c = lista.find((x) => x.id === id);
    if (!c) return { ok: false, erro: 'Consulta não encontrada.' };
    if (!STATUS.some((s) => s.valor === status)) return { ok: false, erro: 'Situação inválida.' };

    c.status = status;
    c.atualizadoEm = new Date().toISOString();
    return { ok: gravar(lista), consulta: c };
  }

  async function removerConsulta(id) {
    return { ok: gravar(ler().filter((c) => c.id !== id)) };
  }

  async function removerDoPaciente(pacienteId) {
    return { ok: gravar(ler().filter((c) => c.pacienteId !== pacienteId)) };
  }

  return {
    STATUS, TIPOS, rotuloStatus, nivelStatus,
    listarPorPeriodo, listarPorPaciente, proximaDoPaciente,
    obterConsulta, contarPorPaciente, conflitos,
    salvarConsulta, alterarStatus, removerConsulta, removerDoPaciente
  };
})();
