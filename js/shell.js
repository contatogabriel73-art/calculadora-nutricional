/* ============================================================
   shell.js — casca comum das telas internas

   Monta o cabeçalho com navegação e logout, protege a página contra
   acesso sem login e oferece utilidades usadas por mais de uma tela
   (escapar HTML, formatar datas, toast).

   Sem build system não há templates, então o cabeçalho é gerado aqui
   em vez de repetido em cada arquivo HTML.
   ============================================================ */

'use strict';

const Shell = (() => {

  function escapar(txt) {
    return String(txt == null ? '' : txt).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** "1990-05-23" → "23/05/1990". Devolve '' para entrada vazia/inválida. */
  function formatarData(iso) {
    if (!iso) return '';
    const partes = String(iso).slice(0, 10).split('-');
    if (partes.length !== 3) return '';
    const [a, m, d] = partes;
    if (!a || !m || !d) return '';
    return `${d}/${m}/${a}`;
  }

  /** Data e hora de um timestamp ISO, no formato brasileiro. */
  function formatarDataHora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  /** Idade em anos a partir da data de nascimento. null se não der para calcular. */
  function calcularIdade(nascimento) {
    if (!nascimento) return null;
    const nasc = new Date(nascimento + 'T00:00:00');
    if (isNaN(nasc)) return null;
    const hoje = new Date();
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    return idade >= 0 && idade < 130 ? idade : null;
  }

  /** Iniciais para o avatar da listagem: "Maria Silva" → "MS". */
  function iniciais(nome) {
    const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '?';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  let timerToast;
  function toast(msg) {
    let elemento = document.querySelector('#toast');
    if (!elemento) {
      elemento = document.createElement('div');
      elemento.id = 'toast';
      elemento.className = 'toast';
      elemento.setAttribute('role', 'status');
      elemento.setAttribute('aria-live', 'polite');
      document.body.appendChild(elemento);
    }
    elemento.textContent = msg;
    elemento.classList.add('visivel');
    clearTimeout(timerToast);
    timerToast = setTimeout(() => elemento.classList.remove('visivel'), 2600);
  }

  const MARCA_SVG = `
    <svg class="brand-mark" viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="currentColor"/>
      <path d="M15 12v10a4 4 0 0 0 4 4h0v10a2 2 0 0 0 4 0V26a4 4 0 0 0 4-4V12" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M21 12v8M33 12c3 2 4 6 4 10s-1 5-3 5v9a2 2 0 1 1-4 0V15z" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  /* A navegação muda por papel. Mesma casca, mesmo verde, mesma marca —
     o que muda é o que cada um tem para fazer ali dentro.

     O paciente não recebe uma versão reduzida do menu do profissional:
     recebe o menu dele. Financeiro e ficha técnica não são seções que ele
     "ainda não pode" abrir; são ferramentas de consultório que não fazem
     parte do que ele veio ver. */
  const NAVEGACAO = {
    nutricionista: {
      sub: 'Plataforma para nutricionistas',
      inicio: 'painel.html',
      abas: [
        { id: 'painel',     href: 'painel.html',     rotulo: 'Painel' },
        { id: 'pacientes',  href: 'pacientes.html',  rotulo: 'Pacientes' },
        { id: 'agenda',     href: 'agenda.html',     rotulo: 'Agenda' },
        { id: 'financeiro', href: 'financeiro.html', rotulo: 'Financeiro' },
        { id: 'ficha',      href: 'ficha.html',      rotulo: 'Ficha Técnica' }
      ]
    },
    paciente: {
      sub: 'Seu acompanhamento nutricional',
      inicio: 'area-paciente.html',
      abas: [
        { id: 'inicio', href: 'area-paciente.html', rotulo: 'Início' }
      ]
    }
  };

  /**
   * Desenha o cabeçalho interno dentro de <header id="app-shell">.
   * @param {string} ativo id da aba atual ('painel', 'pacientes', 'inicio'…)
   */
  async function montarCabecalho(ativo) {
    const alvo = document.querySelector('#app-shell');
    if (!alvo) return;

    const usuario = await Auth.usuarioAtual();
    const nav = NAVEGACAO[usuario && usuario.papel] || NAVEGACAO.nutricionista;

    /* Uma aba só não é navegação, é enfeite: o paciente ganha o cabeçalho
       sem a barra de abas até a área dele ter mais de uma seção. */
    const abas = nav.abas.length > 1 ? `
      <nav class="abas wrap" aria-label="Seções do sistema">
        ${nav.abas.map((a) => `
          <a class="aba" href="${a.href}" ${ativo === a.id ? 'aria-current="page"' : ''}>${a.rotulo}</a>
        `).join('')}
      </nav>` : '';

    alvo.className = 'app-header';
    alvo.innerHTML = `
      <div class="wrap header-inner">
        <a class="brand brand-link" href="${nav.inicio}">
          ${MARCA_SVG}
          <div>
            <h1>NutriFicha</h1>
            <p class="brand-sub">${escapar(nav.sub)}</p>
          </div>
        </a>
        <div class="header-acoes">
          <span class="usuario-nome">${escapar(usuario ? usuario.nome : '')}</span>
          <button id="btn-sair" class="btn btn-ghost btn-sm" type="button">Sair</button>
        </div>
      </div>
      ${abas}`;

    alvo.querySelector('#btn-sair').addEventListener('click', async () => {
      await Auth.logout();
      location.href = 'index.html';
    });
  }

  /** Aviso fixo: os dados vivem só neste navegador. */
  function avisoArmazenamento() {
    return `
      <p class="aviso-dados">
        <strong>Protótipo:</strong> os dados ficam salvos apenas neste navegador,
        sem backup e sem sincronizar entre aparelhos. Não cadastre informação
        real de paciente até a versão com banco de dados.
      </p>`;
  }

  return {
    escapar, formatarData, formatarDataHora, calcularIdade, iniciais,
    toast, montarCabecalho, avisoArmazenamento, MARCA_SVG
  };
})();
