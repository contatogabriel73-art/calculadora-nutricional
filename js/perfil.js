/* ============================================================
   perfil.js — página "Meu plano"

   Só leitura nesta fase: mostra o plano atual (gratuito por padrão) e
   avisa que o upgrade ainda não existe. Sem formulário de pagamento —
   ver Fase 3 do CLAUDE.md sobre por que isso ficou de fora de propósito.
   ============================================================ */

'use strict';

(async () => {
  if (!(await Auth.exigirLogin('nutricionista'))) return;
  await Shell.montarCabecalho('');

  const cartao = document.querySelector('#card-plano');
  const perfil = await Auth.perfilAtual();
  const plano = (perfil && perfil.plano) || 'gratuito';

  const DESCRICOES = {
    gratuito: 'Acesso completo às ferramentas do consultório, sem custo.',
    pro: 'Plano Pro ativo.'
  };

  cartao.innerHTML = `
    <p class="badge-plano badge-plano-grande">${plano === 'pro' ? 'Pro' : 'Gratuito'}</p>
    <p>${Shell.escapar(DESCRICOES[plano] || DESCRICOES.gratuito)}</p>
    <p class="dica">Em breve: upgrade de plano.</p>
  `;
})();
