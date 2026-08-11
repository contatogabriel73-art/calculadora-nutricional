/* ============================================================
   recibo.js — monta o recibo de um pagamento

   Documento simples e imprimível. Não é nota fiscal: é o recibo que o
   profissional entrega ao paciente, com valor por extenso e espaço de
   assinatura, como se espera de um recibo brasileiro.
   ============================================================ */

'use strict';

(async () => {

  if (!(await Auth.exigirLogin())) return;
  await Shell.montarCabecalho('financeiro');

  const $ = (s) => document.querySelector(s);
  const esc = Shell.escapar;
  const F = FinanceiroStore;

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  function falhar(texto) {
    $('#erro-texto').textContent = texto;
    $('#erro').hidden = false;
  }

  const id = new URLSearchParams(location.search).get('pagamento') || '';
  const pagamento = id ? await F.obterPagamento(id) : null;

  if (!pagamento) {
    falhar('Pagamento não encontrado. Ele pode ter sido excluído.');
    return;
  }
  if (pagamento.status !== 'pago') {
    falhar('Este lançamento ainda está pendente. Marque como pago para emitir o recibo.');
    return;
  }

  const paciente = await PacientesStore.obterPaciente(pagamento.pacienteId);
  const perfil = await PerfilStore.obterPerfil();

  $('#aviso-perfil').hidden = PerfilStore.perfilCompleto(perfil);
  $('#acoes').hidden = false;
  $('#recibo').hidden = false;

  /** "11 de agosto de 2026" a partir de 'YYYY-MM-DD', sem passar por UTC. */
  function dataPorExtenso(iso) {
    const [a, m, d] = String(iso).split('-').map(Number);
    if (!a || !m || !d) return '';
    return `${d} de ${MESES[m - 1]} de ${a}`;
  }

  const valorTexto = 'R$ ' + F.formatarCentavos(pagamento.centavos);
  const valorExtenso = Extenso.reais(F.emReais(pagamento.centavos));
  const nomePaciente = paciente ? paciente.nome : 'Paciente removido';
  const dataPag = pagamento.dataPagamento || pagamento.data;

  /* ── Emitente ── */
  $('#r-profissional').textContent = perfil && perfil.nome ? perfil.nome : 'Profissional não informado';

  const credenciais = [perfil && perfil.crn, perfil && perfil.documento].filter(Boolean).join(' · ');
  $('#r-credenciais').textContent = credenciais;
  $('#r-credenciais').hidden = !credenciais;

  const contato = [perfil && perfil.endereco, perfil && perfil.telefone, perfil && perfil.email]
    .filter(Boolean).join(' · ');
  $('#r-contato').textContent = contato;
  $('#r-contato').hidden = !contato;

  /* ── Corpo ── */
  $('#r-valor').textContent = valorTexto;

  $('#r-corpo').innerHTML =
    `Recebi de <strong>${esc(nomePaciente)}</strong> a quantia de ` +
    `<strong>${esc(valorTexto)}</strong> (${esc(valorExtenso)}), ` +
    `referente a <strong>${esc(pagamento.descricao)}</strong>, ` +
    `dando plena e geral quitação pelo valor recebido.`;

  $('#r-descricao').textContent = pagamento.descricao;
  $('#r-forma').textContent = pagamento.forma ? F.rotuloForma(pagamento.forma) : 'Não informada';
  $('#r-data-pagamento').textContent = Shell.formatarData(dataPag);
  // Nº do documento: os últimos caracteres do id, que já é único.
  $('#r-numero').textContent = pagamento.id.slice(-6).toUpperCase();

  const cidade = perfil && perfil.cidade ? perfil.cidade + ', ' : '';
  $('#r-local').textContent = cidade + dataPorExtenso(dataPag) + '.';

  $('#r-assinatura-nome').textContent = perfil && perfil.nome ? perfil.nome : '';
  $('#r-assinatura-doc').textContent = credenciais;

  document.title = `Recibo ${$('#r-numero').textContent} — ${nomePaciente}`;

  /* ── Ações ── */

  $('#btn-imprimir').addEventListener('click', () => window.print());

  $('#btn-copiar').addEventListener('click', async () => {
    const linhas = [
      'RECIBO nº ' + $('#r-numero').textContent,
      '',
      perfil && perfil.nome ? perfil.nome : '',
      credenciais,
      contato,
      '',
      `Recebi de ${nomePaciente} a quantia de ${valorTexto} (${valorExtenso}), ` +
      `referente a ${pagamento.descricao}, dando plena e geral quitação pelo valor recebido.`,
      '',
      'Forma de pagamento: ' + (pagamento.forma ? F.rotuloForma(pagamento.forma) : 'não informada'),
      'Data do pagamento: ' + Shell.formatarData(dataPag),
      '',
      cidade + dataPorExtenso(dataPag) + '.',
      '',
      '____________________________________',
      perfil && perfil.nome ? perfil.nome : '',
      credenciais
    ].filter((l) => l !== undefined).join('\n');

    try {
      await navigator.clipboard.writeText(linhas);
      Shell.toast('Recibo copiado.');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = linhas;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); Shell.toast('Recibo copiado.'); }
      catch (e2) { Shell.toast('Não foi possível copiar automaticamente.'); }
      ta.remove();
    }
  });
})();
