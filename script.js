// === Configuration ===
const WIDTH = () => document.getElementById('chart').clientWidth;
const HEIGHT = () => document.getElementById('chart').clientHeight;

// Range for node sizes
const RADIUS_RANGE = [3, 12];
const FALLBACK_GRAY = '#A9A9A9'; // for non-top-10 countries

// === Load Data ===
d3.json("authors_network.json").then(graph => {

  // Expect: { nodes:[{id,name,affiliation,country}], links:[{source,target,weight}] }
  const nodes = raw.nodes.map(d => ({ ...d }));
  const links = raw.links.map(d => ({ ...d }));

  // --- Degree (number of connections per node) ---
  const degree = d3.rollup(
    links.flatMap(l => [l.source, l.target]),
    v => v.length,
    d => d
  );
  nodes.forEach(n => n.degree = degree.get(n.id) || 0);

  // --- Top 10 countries ---
  const byCountry = d3.rollup(
    nodes,
    v => v.length,
    d => d.country || 'Unknown'
  );

  const sortedCountries = Array.from(byCountry, ([k, v]) => ({ country: k, n: v }))
    .sort((a, b) => d3.descending(a.n, b.n));

  const top10 = new Set(sortedCountries.slice(0, 10).map(d => d.country));

  const color = d3.scaleOrdinal()
    .domain(sortedCountries.slice(0, 10).map(d => d.country))
    .range(d3.schemeTableau10);

  // --- Node size scale ---
  const size = d3.scaleSqrt()
    .domain(d3.extent(nodes, d => d.degree))
    .range(RADIUS_RANGE);

  // --- Sliders + labels (IMPORTANT: define these BEFORE using them) ---
  const chargeSlider       = d3.select('#charge');
  const collideSlider      = d3.select('#collide');
  const linkStrengthSlider = d3.select('#linkStrength');

  const chargeVal       = d3.select('#chargeVal');
  const collideVal      = d3.select('#collideVal');
  const linkStrengthVal = d3.select('#linkStrengthVal');

  function updateSliderLabels() {
    chargeVal.text(+chargeSlider.node().value);
    collideVal.text(+collideSlider.node().value);
    linkStrengthVal.text(+linkStrengthSlider.node().value);
  }
  updateSliderLabels();

  // --- SVG + groups ---
  const svg = d3.select('#chart');
  svg.selectAll('*').remove();
  svg.attr('viewBox', [0, 0, WIDTH(), HEIGHT()]);

  const linkG = svg.append('g').attr('class', 'links');
  const nodeG = svg.append('g').attr('class', 'nodes');

  const link = linkG.selectAll('line')
    .data(links)
    .join('line')
    .attr('class', 'link')
    .attr('stroke-width', d => Math.max(0.5, (d.weight || 1) * 0.6));

  const node = nodeG.selectAll('circle')
    .data(nodes)
    .join('circle')
    .attr('class', 'node')
    .attr('r', d => size(d.degree))
    .attr('fill', d => top10.has(d.country) ? color(d.country) : FALLBACK_GRAY);

  // --- Tooltip ---
  const tooltip = d3.select('#tooltip');

  node
    .on('mouseover', (event, d) => {
      // dim nodes from other countries
      node.classed('dim', n => (n.country !== d.country));

      // dim links that are not between same-country authors
      link.classed('dim', l => {
        const idToCountry = id => nodes.find(n => n.id === (id.id ?? id))?.country;
        const c1 = idToCountry(l.source);
        const c2 = idToCountry(l.target);
        return !(c1 === d.country && c2 === d.country);
      });
    })
    .on('mouseleave', () => {
      node.classed('dim', false);
      link.classed('dim', false);
    })
    .on('click', (event, d) => {
      const lines = [
        `<strong>${d.name ?? d.id}</strong>`,
        d.affiliation ? d.affiliation : '',
        d.country ? `Country: ${d.country}` : '',
        `Degree: ${d.degree}`
      ].filter(Boolean).join('<br/>');

      tooltip
        .html(lines)
        .style('left', (event.offsetX + 12) + 'px')
        .style('top', (event.offsetY + 12) + 'px')
        .classed('hidden', false);

      // Hide when clicking somewhere else
      d3.select('body').on('click.tooltip', e => {
        if (!event.composedPath().includes(tooltip.node())) {
          tooltip.classed('hidden', true);
          d3.select('body').on('click.tooltip', null);
        }
      }, { capture: true, once: true });
    });

  // --- Force simulation + drag ---

  function createSimulation() {
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id)
        .strength(+linkStrengthSlider.node().value))
      .force('charge', d3.forceManyBody().strength(+chargeSlider.node().value))
      .force('center', d3.forceCenter(WIDTH() / 2, HEIGHT() / 2))
      .force('collide', d3.forceCollide().radius(
        d => size(d.degree) * +collideSlider.node().value
      ));

    sim.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      node
        .attr('cx', d => d.x = Math.max(6, Math.min(WIDTH() - 6, d.x)))
        .attr('cy', d => d.y = Math.max(6, Math.min(HEIGHT() - 6, d.y)));
    });

    return sim;
  }

  const sim = createSimulation();

  // Drag behaviour for nodes
  function drag(sim) {
    function dragstarted(event, d) {
      if (!event.active) sim.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }
    function dragended(event, d) {
      if (!event.active) sim.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
    return d3.drag()
      .on('start', dragstarted)
      .on('drag', dragged)
      .on('end', dragended);
  }

  node.call(drag(sim));

  // --- Slider handlers (now safe to use `sim`) ---
  chargeSlider.on('input', function () {
    chargeVal.text(+this.value);
    sim.force('charge', d3.forceManyBody().strength(+this.value));
    sim.alpha(0.6).restart();
  });

  collideSlider.on('input', function () {
    collideVal.text(+this.value);
    sim.force('collide', d3.forceCollide().radius(
      d => size(d.degree) * +this.value
    ));
    sim.alpha(0.6).restart();
  });

  linkStrengthSlider.on('input', function () {
    linkStrengthVal.text(+this.value);
    sim.force('link').strength(+this.value);
    sim.alpha(0.6).restart();
  });

  // --- Resize handling ---
  window.addEventListener('resize', () => {
    svg.attr('viewBox', [0, 0, WIDTH(), HEIGHT()]);
    sim.force('center', d3.forceCenter(WIDTH() / 2, HEIGHT() / 2));
    sim.alpha(0.3).restart();
  });

  // --- Legend for top 10 countries ---
  const legend = d3.select('#legend');
  legend.html(''); // clear if re-rendering
  legend.append('h3').text('Top 10 Countries');

  sortedCountries.slice(0, 10).forEach(row => {
    const item = legend.append('div').attr('class', 'item');
    item.append('div')
      .attr('class', 'swatch')
      .style('background', color(row.country));
    item.append('div')
      .text(`${row.country} (${row.n})`);
  });

});


