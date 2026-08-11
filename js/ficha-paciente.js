/* ============================================================
   ficha-paciente.js — vincula a ferramenta de ficha a um paciente

   Esta é a única camada que sabe que fichas pertencem a alguém. Toda a
   lógica de cálculo (TACO, pesos, índices, rótulo) fica intocada em
   app.js; aqui só decidimos o que carregar e onde guardar.

   Modos de abertura, pela URL:
     ficha.html                          → ferramenta avulsa, como sempre foi
     ficha.html?paciente=ID              → ficha nova para o paciente
     ficha.html?paciente=ID&ficha=FID    → abre uma ficha já salva
   ============================================================ */

'use strict';

(async () => {

  if (!(await Auth.exigirLogin())) return;
  await Shell.montarCabecalho('ficha');

  const params = new URLSearchParams(location.search);
  const pacienteId = params.get('paciente') || '';
  let fichaId = params.get('ficha') || '';

  // Sem paciente é a ferramenta avulsa: nada a fazer além do cabeçalho.
  if (!pacienteId) return;

  const paciente = await PacientesStore.obterPaciente(pacienteId);
  if (!paciente) {
    Shell.toast('Paciente não encontrado.');
    setTimeout(() => location.replace('pacientes.html'), 1500);
    return;
  }

  const barra = document.querySelector('#barra-paciente');
  const estadoTexto = document.querySelector('#bp-estado');
  const marcaAlteracoes = document.querySelector('#bp-alteracoes');
  const botaoSalvar = document.querySelector('#btn-salvar-ficha');

  barra.hidden = false;
  document.querySelector('#bp-avatar').textContent = Shell.iniciais(paciente.nome);
  const link = document.querySelector('#bp-link');
  link.textContent = paciente.nome;
  link.href = 'paciente.html?id=' + encodeURIComponent(paciente.id);

  // Espera a ferramenta terminar de carregar a base e montar a tela.
  try {
    await FichaTool.pronto;
  } catch (e) {
    return; // app.js já mostrou o erro de carregamento da base
  }

  let fichaSalva = null;

  if (fichaId) {
    fichaSalva = await FichasStore.obterFicha(fichaId);
    if (!fichaSalva) {
      Shell.toast('Ficha não encontrada. Abrindo uma nova.');
      fichaId = '';
    } else if (!FichaTool.tinhaRascunho) {
      // Sem rascunho para esta ficha, carregamos o que está no prontuário.
      // Havendo rascunho, ele vence: são edições que o usuário não salvou,
      // e descartá-las sem avisar seria pior do que mostrá-las.
      FichaTool.importar(fichaSalva.conteudo);
    }
  }

  let alterado = FichaTool.tinhaRascunho && !!fichaId;

  function atualizarBarra() {
    estadoTexto.textContent = fichaId
      ? 'Ficha salva em ' + Shell.formatarDataHora(fichaSalva ? fichaSalva.atualizadoEm : '')
      : 'Nova ficha';
    marcaAlteracoes.hidden = !alterado;
    botaoSalvar.textContent = fichaId ? 'Salvar alterações' : 'Salvar no prontuário';
  }

  // A ferramenta avisa a cada tecla. O primeiro aviso chega da própria
  // montagem inicial da tela, então ignoramos ele.
  let primeiroAviso = true;
  FichaTool.aoMudar(() => {
    if (primeiroAviso) { primeiroAviso = false; return; }
    if (!alterado) {
      alterado = true;
      atualizarBarra();
    }
  });

  botaoSalvar.addEventListener('click', async () => {
    if (FichaTool.vazia()) {
      Shell.toast('Dê um nome à preparação ou adicione um ingrediente antes de salvar.');
      return;
    }

    botaoSalvar.disabled = true;
    const resultado = await FichasStore.salvarFicha({
      id: fichaId || undefined,
      pacienteId: paciente.id,
      criadoEm: fichaSalva ? fichaSalva.criadoEm : undefined,
      titulo: FichaTool.titulo(),
      conteudo: FichaTool.exportar(),
      resumo: FichaTool.resumo()
    });
    botaoSalvar.disabled = false;

    if (!resultado.ok) {
      Shell.toast(resultado.erro);
      return;
    }

    const eraNova = !fichaId;
    fichaSalva = resultado.ficha;
    fichaId = resultado.ficha.id;
    alterado = false;
    atualizarBarra();
    Shell.toast(eraNova ? 'Ficha salva no prontuário.' : 'Alterações salvas.');

    // Passa a apontar para a ficha salva, sem recarregar a página, para que
    // um F5 reabra o que acabou de ser gravado em vez de criar outra ficha.
    if (eraNova) {
      const nova = 'ficha.html?paciente=' + encodeURIComponent(paciente.id) +
                   '&ficha=' + encodeURIComponent(fichaId);
      history.replaceState(null, '', nova);
    }
  });

  // Aviso ao sair com trabalho não salvo.
  window.addEventListener('beforeunload', (ev) => {
    if (!alterado) return;
    ev.preventDefault();
    ev.returnValue = '';
  });

  atualizarBarra();
})();
