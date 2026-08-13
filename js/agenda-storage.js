/* ============================================================
   agenda-storage.js — consultas (tabela `consultas`)

   Mesmas assinaturas de quando gravava no localStorage. O que mudou:
   `id` virou UUID do banco, toda linha carrega `nutricionista_id` (é o
   que a Row Level Security compara), e as colunas são snake_case —
   a tradução para camelCase fica aqui.

   A integração real com Google Agenda depende de backend e fica para
   depois; o formato já guarda o que ela precisaria (data, hora,
   duração e um campo livre de observações).
   ============================================================ */

'use strict';

const AgendaStore = (() => {

  const COLUNAS = 'id, nutricionista_id, paciente_id, data, hora, duracao, ' +
                  'tipo, status, observacoes, criado_em, atualizado_em';

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

  /* Coluna `time` do Postgres volta como "14:30:00"; as telas e os
     <input type="time"> trabalham com "14:30". */
  function horaCurta(hora) {
    return String(hora || '').slice(0, 5);
  }

  function daLinha(linha) {
    if (!linha) return null;
    return {
      id: linha.id,
      nutricionistaId: linha.nutricionista_id,
      pacienteId: linha.paciente_id,
      data: linha.data,
      hora: horaCurta(linha.hora),
      duracao: Number(linha.duracao) || 60,
      tipo: linha.tipo || 'Consulta',
      status: linha.status,
      observacoes: linha.observacoes || '',
      criadoEm: linha.criado_em,
      atualizadoEm: linha.atualizado_em
    };
  }

  function paraLinha(dados) {
    return {
      paciente_id: dados.pacienteId,
      data: dados.data,
      hora: horaCurta(dados.hora),
      duracao: Number(dados.duracao) || 60,
      tipo: String(dados.tipo || '').trim() || 'Consulta',
      status: STATUS.some((s) => s.valor === dados.status) ? dados.status : 'agendada',
      observacoes: String(dados.observacoes || '').trim()
    };
  }

  /* Ordena por data e hora, da mais antiga para a mais recente. Vai no
     banco (e não no navegador) para o índice (nutricionista_id, data)
     poder ser usado. */
  function ordenado(consulta) {
    return consulta.order('data', { ascending: true }).order('hora', { ascending: true });
  }

  async function buscar(montar) {
    const { data, error } = await montar(ordenado(Banco.tabela('consultas').select(COLUNAS)));
    if (error) {
      console.error('agenda:', error);
      return [];
    }
    return (data || []).map(daLinha);
  }

  /** Consultas entre duas datas ISO, inclusive nas pontas. */
  async function listarPorPeriodo(inicioIso, fimIso) {
    return buscar((q) => q.gte('data', inicioIso).lte('data', fimIso));
  }

  async function listarPorPaciente(pacienteId) {
    return buscar((q) => q.eq('paciente_id', pacienteId));
  }

  /** Próxima consulta futura (ou de hoje) que não foi cancelada. */
  async function proximaDoPaciente(pacienteId, hojeIso) {
    const lista = await buscar((q) => q
      .eq('paciente_id', pacienteId)
      .gte('data', hojeIso)
      .neq('status', 'cancelada')
      .limit(1));
    return lista[0] || null;
  }

  async function obterConsulta(id) {
    if (!id) return null;
    const { data, error } = await Banco.tabela('consultas')
      .select(COLUNAS).eq('id', id).maybeSingle();
    return error ? null : daLinha(data);
  }

  async function contarPorPaciente(pacienteId) {
    const { count, error } = await Banco.tabela('consultas')
      .select('id', { count: 'exact', head: true })
      .eq('paciente_id', pacienteId);
    return error ? 0 : (count || 0);
  }

  function minutos(hora) {
    const [h, m] = String(hora || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  /**
   * Outras consultas que ocupam o mesmo intervalo de tempo.
   * Serve para avisar sobre choque de horário — não bloqueia, porque
   * atendimento sobreposto às vezes é intencional.
   *
   * O banco filtra pelo dia (que é indexado) e a sobreposição de
   * horário é calculada aqui: são poucas consultas por dia, e a conta
   * em SQL exigiria somar `duracao` a `hora` no filtro.
   */
  async function conflitos(consulta) {
    const inicio = minutos(consulta.hora);
    const fim = inicio + (Number(consulta.duracao) || 60);

    const doDia = await buscar((q) => q.eq('data', consulta.data).neq('status', 'cancelada'));

    return doDia.filter((c) => {
      if (c.id === consulta.id) return false;
      const i = minutos(c.hora);
      const f = i + (Number(c.duracao) || 60);
      return inicio < f && i < fim;
    });
  }

  async function salvarConsulta(dados) {
    if (!dados.pacienteId) return { ok: false, erro: 'Escolha o paciente.' };
    if (!dados.data) return { ok: false, erro: 'Informe a data.' };
    if (!dados.hora) return { ok: false, erro: 'Informe o horário.' };

    const campos = paraLinha(dados);

    if (dados.id) {
      const { data, error } = await Banco.tabela('consultas')
        .update(campos).eq('id', dados.id).select(COLUNAS);

      if (error) return { ok: false, erro: Banco.traduzirErro(error) };
      if (!data || !data.length) {
        return { ok: false, erro: 'Esta consulta não está mais disponível para edição.' };
      }
      return { ok: true, consulta: daLinha(data[0]) };
    }

    const nutricionistaId = await Auth.idAtual();
    if (!nutricionistaId) return { ok: false, erro: 'Sua sessão expirou. Entre novamente.' };

    const { data, error } = await Banco.tabela('consultas')
      .insert(Object.assign({ nutricionista_id: nutricionistaId }, campos))
      .select(COLUNAS);

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    return { ok: true, consulta: daLinha(data[0]) };
  }

  /** Muda só a situação, sem abrir o formulário inteiro. */
  async function alterarStatus(id, status) {
    if (!STATUS.some((s) => s.valor === status)) {
      return { ok: false, erro: 'Situação inválida.' };
    }

    const { data, error } = await Banco.tabela('consultas')
      .update({ status }).eq('id', id).select(COLUNAS);

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    if (!data || !data.length) return { ok: false, erro: 'Consulta não encontrada.' };
    return { ok: true, consulta: daLinha(data[0]) };
  }

  async function removerConsulta(id) {
    const { data, error } = await Banco.tabela('consultas')
      .delete().eq('id', id).select('id');
    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    return { ok: !!(data && data.length) };
  }

  /* O banco já apaga as consultas junto com o paciente
     (on delete cascade). Continua existindo porque a tela de exclusão
     chama, e porque apagar o que já não existe é inofensivo. */
  async function removerDoPaciente(pacienteId) {
    const { error } = await Banco.tabela('consultas').delete().eq('paciente_id', pacienteId);
    return { ok: !error };
  }

  return {
    STATUS, TIPOS, rotuloStatus, nivelStatus,
    listarPorPeriodo, listarPorPaciente, proximaDoPaciente,
    obterConsulta, contarPorPaciente, conflitos,
    salvarConsulta, alterarStatus, removerConsulta, removerDoPaciente
  };
})();
