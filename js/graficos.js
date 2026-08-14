/* ============================================================
   graficos.js — camada fina sobre o Chart.js

   O Chart.js é a única dependência externa do projeto e vem de CDN.
   CDN falha: rede ruim, bloqueio corporativo, offline. Por isso nada
   aqui lança erro quando a biblioteca não carrega — `disponivel()`
   devolve false e cada tela mostra um aviso no lugar do gráfico,
   continuando utilizável.

   Concentra também as cores e os padrões visuais, para os gráficos
   ficarem coerentes com a identidade (verde-sálvia VITABLOOM, #5d6b56 —
   o tom escuro da paleta, não o #A8B5A0 claro, que soma pouco contraste
   numa linha fina de gráfico) e legíveis no modo escuro.
   ============================================================ */

'use strict';

const Graficos = (() => {

  const CORES = {
    verde: '#5d6b56',
    verdeClaro: 'rgba(93, 107, 86, .15)',
    verdeMedio: 'rgba(93, 107, 86, .55)',
    ambar: '#c9a227',
    ambarClaro: 'rgba(201, 162, 39, .18)',
    vermelho: '#b3261e',
    vermelhoClaro: 'rgba(179, 38, 30, .15)',
    azul: '#2f6fb0',
    azulClaro: 'rgba(47, 111, 176, .15)',
    roxo: '#6b4fa0',
    cinza: '#8a9a93'
  };

  /** Paleta para séries múltiplas, na ordem de uso. */
  const SERIES = [CORES.verde, CORES.azul, CORES.ambar, CORES.roxo, CORES.vermelho, CORES.cinza];

  function disponivel() {
    return typeof window !== 'undefined' && typeof window.Chart !== 'undefined';
  }

  /** Cores do texto/grade conforme o tema em vigor. */
  function tema() {
    const escuro = document.documentElement.dataset.tema === 'escuro';
    return {
      texto: escuro ? '#c8d3ce' : '#4a5a53',
      grade: escuro ? 'rgba(255,255,255,.10)' : 'rgba(20,32,27,.09)',
      fundoTooltip: escuro ? '#1d2a25' : '#14201b'
    };
  }

  function opcoesBase() {
    const t = tema();
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: false,
          labels: { color: t.texto, usePointStyle: true, boxWidth: 8, font: { size: 11 } }
        },
        tooltip: {
          backgroundColor: t.fundoTooltip,
          padding: 10,
          cornerRadius: 8,
          titleFont: { size: 12 },
          bodyFont: { size: 12 }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: t.texto, font: { size: 11 } } },
        y: { grid: { color: t.grade }, ticks: { color: t.texto, font: { size: 11 } }, beginAtZero: true }
      }
    };
  }

  /** Junta as opções base com as específicas, sem perder o que está aninhado. */
  function combinar(base, extra) {
    const saida = Object.assign({}, base);
    for (const chave of Object.keys(extra || {})) {
      const v = extra[chave];
      saida[chave] = (v && typeof v === 'object' && !Array.isArray(v))
        ? combinar(base[chave] || {}, v)
        : v;
    }
    return saida;
  }

  /* Guarda as instâncias por id de canvas: desenhar de novo no mesmo
     canvas sem destruir a anterior deixa gráficos fantasmas reagindo ao
     mouse por cima do novo. */
  const instancias = new Map();

  /**
   * Desenha (ou redesenha) um gráfico.
   * @param {string} idCanvas
   * @param {object} config configuração do Chart.js (type, data, options)
   * @returns {object|null} a instância, ou null se o Chart.js não carregou
   */
  function desenhar(idCanvas, config) {
    const canvas = document.getElementById(idCanvas);
    if (!canvas || !disponivel()) return null;

    const anterior = instancias.get(idCanvas);
    if (anterior) anterior.destroy();

    const grafico = new window.Chart(canvas, Object.assign({}, config, {
      options: combinar(opcoesBase(), config.options || {})
    }));
    instancias.set(idCanvas, grafico);
    return grafico;
  }

  function destruir(idCanvas) {
    const g = instancias.get(idCanvas);
    if (g) { g.destroy(); instancias.delete(idCanvas); }
  }

  /** Redesenha todos com as cores do tema atual (usado ao trocar claro/escuro). */
  function redesenharTodos() {
    instancias.forEach((g) => {
      const t = tema();
      if (g.options.scales) {
        if (g.options.scales.x) g.options.scales.x.ticks.color = t.texto;
        if (g.options.scales.y) {
          g.options.scales.y.ticks.color = t.texto;
          g.options.scales.y.grid.color = t.grade;
        }
      }
      if (g.options.plugins && g.options.plugins.legend) {
        g.options.plugins.legend.labels.color = t.texto;
      }
      g.update('none');
    });
  }

  /** Aviso padrão quando a biblioteca não está disponível. */
  function avisoIndisponivel() {
    return `
      <p class="grafico-indisponivel">
        Não foi possível carregar a biblioteca de gráficos (ela vem de um servidor externo).
        Os números continuam corretos nas tabelas acima — só a visualização ficou de fora.
        Recarregue a página com internet para vê-la.
      </p>`;
  }

  /** Estado vazio, quando não há dado suficiente para um gráfico fazer sentido. */
  function estadoVazio(texto) {
    return `<p class="grafico-vazio">${texto}</p>`;
  }

  /**
   * Plugin que sombreia uma faixa horizontal de referência — usado nos
   * exames, para deixar visível quando o valor entrou na faixa saudável.
   */
  function faixaReferencia(min, max, cor) {
    return {
      id: 'faixaReferencia',
      beforeDatasetsDraw(gr) {
        const { ctx, chartArea, scales } = gr;
        if (!chartArea || !scales.y) return;
        const yMax = scales.y.getPixelForValue(max == null ? scales.y.max : max);
        const yMin = scales.y.getPixelForValue(min == null ? scales.y.min : min);
        ctx.save();
        ctx.fillStyle = cor || 'rgba(22, 105, 74, .10)';
        ctx.fillRect(chartArea.left, yMax, chartArea.right - chartArea.left, yMin - yMax);
        ctx.restore();
      }
    };
  }

  return {
    CORES, SERIES, disponivel, desenhar, destruir, redesenharTodos,
    avisoIndisponivel, estadoVazio, faixaReferencia, tema
  };
})();
