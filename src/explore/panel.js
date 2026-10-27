export function createPanel({ base, select, inspect }) {
  const list = document.querySelector('#model-list'), search = document.querySelector('#search');
  const panel = document.querySelector('#panel'), toggle = document.querySelector('#panel-toggle');
  let models = [], startY = 0;
  function collapse(value) {
    panel.classList.toggle('collapsed', value); document.body.classList.toggle('panel-collapsed', value);
    toggle.setAttribute('aria-expanded', String(!value));
  }
  let dragged = false;
  toggle.addEventListener('click', () => { if (!dragged) collapse(!panel.classList.contains('collapsed')); });
  toggle.addEventListener('pointerdown', (event) => { startY = event.clientY; dragged = false; toggle.setPointerCapture(event.pointerId); });
  toggle.addEventListener('pointerup', (event) => {
    const delta = event.clientY - startY; dragged = Math.abs(delta) > 24;
    if (!dragged) return;
    if (delta > 0) { panel.classList.remove('expanded'); collapse(true); }
    else { collapse(false); panel.classList.add('expanded'); }
  });
  function render() {
    list.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    let count = 0;
    for (const [category, title] of [['station', 'Station'], ['structure', 'Structure'], ['building', 'Buildings'], ['street', 'Street']]) {
      const matching = models.filter((model) => model.category === category && model.name.toLocaleLowerCase().includes(query));
      if (!matching.length) continue;
      const heading = document.createElement('h2'); heading.className = 'category'; heading.textContent = title; list.append(heading);
      for (const model of matching) {
        count++;
        const row = document.createElement('article'); row.className = 'model-row';
        const tile = document.createElement('span'); tile.className = 'thumb'; tile.textContent = '3D';
        const source = model.thumb || model.ref;
        if (source) {
          const image = document.createElement('img'); image.className = 'thumb'; image.alt = ''; image.loading = 'lazy'; image.src = `${base}${source.replace(/^\/+/, '')}`;
          image.addEventListener('error', () => {
            if (model.ref && image.dataset.fallback !== 'true' && source !== model.ref) { image.dataset.fallback = 'true'; image.src = `${base}${model.ref}`; }
            else image.replaceWith(tile);
          }); row.append(image);
        } else row.append(tile);
        const body = document.createElement('div'), button = document.createElement('button'); button.className = 'model-main';
        const name = document.createElement('span'); name.className = 'model-name'; name.textContent = model.name;
        const description = document.createElement('span'); description.className = 'model-description'; description.textContent = model.description; description.title = model.description ?? '';
        button.append(name, description); button.addEventListener('click', () => select(model));
        const meta = document.createElement('div'); meta.className = 'model-meta';
        const bytes = document.createElement('span'); bytes.textContent = model.bytes ? `${Math.round(model.bytes / 1024).toLocaleString()} KB` : 'Size unknown';
        const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = model.box.isEmpty() ? 'gallery' : 'placed';
        const inspectButton = document.createElement('button'); inspectButton.className = 'inspect-button'; inspectButton.textContent = 'Inspect'; inspectButton.setAttribute('aria-label', `Inspect ${model.name}`);
        inspectButton.addEventListener('click', () => inspect(model)); meta.append(bytes, tag, inspectButton); body.append(button, meta); row.append(body); list.append(row);
      }
    }
    if (!count) { const empty = document.createElement('p'); empty.textContent = 'No models match your search.'; list.append(empty); }
    document.querySelector('#model-count').textContent = `(${count})`;
  }
  search.addEventListener('input', render);
  return { setModels(next) { models = next; render(); }, refresh: render };
}
