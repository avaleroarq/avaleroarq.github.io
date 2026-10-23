// Menú móvil
const toggle = document.querySelector('.nav-toggle');
const nav = document.getElementById('nav');

if (toggle && nav) {
  const setOpen = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Cerrar' : 'Menú';
  };

  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}

// Año del pie
const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();

// Certificados: vista ampliada al pulsar la miniatura
const zoom = document.getElementById('cert-zoom');
if (zoom && zoom.showModal) {
  const zoomImg = zoom.querySelector('.zoom__img');
  document.querySelectorAll('.cert__thumb').forEach((b) => b.addEventListener('click', () => {
    zoomImg.src = b.dataset.zoom;
    zoomImg.alt = b.querySelector('img').alt;
    zoom.showModal();
  }));
  zoom.querySelector('.zoom__close').addEventListener('click', () => zoom.close());
  zoom.addEventListener('click', (e) => { if (e.target === zoom) zoom.close(); });   // clic fuera de la imagen
  zoom.addEventListener('contextmenu', (e) => e.preventDefault());
}
