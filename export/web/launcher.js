const launcher = document.getElementById('launcher');
const list = document.getElementById('map-list');
const note = document.getElementById('launcher-note');
const errorBox = document.getElementById('launcher-error');
const buttons = [...list.querySelectorAll('button[data-map]')];
let booting = false;

function setEnabled(enabled) {
  for (const button of buttons) button.disabled = !enabled;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function loadStyle(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve(link);
    link.onerror = () => { link.remove(); reject(new Error(`Could not load ${href}`)); };
    document.head.append(link);
  });
}

function showBootFailure(label, error) {
  console.error(error);
  const box = document.createElement('div');
  box.id = 'boot-failure';
  box.setAttribute('role', 'alert');
  const title = document.createElement('strong');
  title.textContent = `${label} could not start`;
  const detail = document.createElement('p');
  detail.textContent = error?.message ?? String(error);
  const back = document.createElement('a');
  back.href = './';
  back.textContent = 'Back to maps';
  box.append(title, detail, back);
  document.body.append(box);
}

async function boot(button) {
  if (booting) return;
  booting = true;
  setEnabled(false);
  errorBox.hidden = true;
  const { map, label, module, title, bodyClass } = button.dataset;
  note.textContent = `Loading ${label}…`;
  const template = document.getElementById(`map-${map}`);
  const loaded = [];
  try {
    if (!template) throw new Error(`No layout is defined for ${label}.`);
    for (const href of (button.dataset.styles ?? '').split(/\s+/).filter(Boolean)) loaded.push(await loadStyle(href));
  } catch (error) {
    for (const link of loaded) link.remove();
    note.textContent = 'Nothing is downloaded until you choose a map.';
    showError(error.message);
    setEnabled(true);
    booting = false;
    return;
  }
  const params = new URLSearchParams(location.search);
  params.set('map', map);
  history.replaceState(null, '', `?${params}`);
  document.title = title || document.title;
  launcher.remove();
  document.body.className = bodyClass ?? '';
  document.body.prepend(template.content.cloneNode(true));
  try {
    await import(module);
  } catch (error) {
    showBootFailure(label, error);
  }
}

list.addEventListener('click', event => {
  const button = event.target.closest('button[data-map]');
  if (button && !button.disabled) boot(button);
});

const requested = new URLSearchParams(location.search).get('map');
if (requested) {
  const button = buttons.find(candidate => candidate.dataset.map === requested);
  if (button) boot(button);
  else showError(`There is no map called "${requested}". Choose one from the list.`);
}
