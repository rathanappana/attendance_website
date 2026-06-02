// footer.js — edit this file to update footer across all pages
const FOOTER_CONFIG = {
  project:     'ISEA',
  dept:        'CSE',
  institute:   'IIT Hyderabad',
  year:        new Date().getFullYear(),

  people: [
    { name: 'Rathan Appana',  designation: 'JRF' },
    // { name: 'Second Person',  designation: 'Faculty'         },  // 🔁 edit this
  ],



};
function injectFooter() {
  const peopleHTML = FOOTER_CONFIG.people
    .map(p => `<span class="footer-person"><strong>${p.name}</strong> <span class="footer-dim">${p.designation}</span></span>`)
    .join('<span class="footer-sep">·</span>');
  const footer = document.createElement('div');
  footer.id = 'site-footer';
  footer.innerHTML = `
    <div class="footer-inner">
      <div class="footer-left">
        <span class="footer-project">${FOOTER_CONFIG.project}</span>
        <span class="footer-sep">·</span>
        <span>${FOOTER_CONFIG.dept}, ${FOOTER_CONFIG.institute}</span>
      </div>
      <div class="footer-right">
        <span class="footer-dim">Designed, Built &amp; Deployed by</span>
        ${peopleHTML}
        <span class="footer-sep">·</span>        
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #site-footer {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      padding: 10px 24px;
      background: rgba(10,10,15,0.85);
      backdrop-filter: blur(12px);
      border-top: 1px solid rgba(255,255,255,0.06);
      z-index: 999;
    }
    .footer-inner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      max-width: 1100px;
      margin: 0 auto;
      flex-wrap: wrap;
      gap: 6px;
    }
    .footer-left {
      font-family: 'DM Mono', monospace;
      font-size: 11px;
      color: #6b6b80;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .footer-project { color: #c8f135; font-weight: 500; }
    .footer-right {
      font-family: 'DM Mono', monospace;
      font-size: 11px;
      color: #6b6b80;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .footer-right strong { color: #f0f0f0; font-weight: 600; }
    .footer-sep { opacity: 0.4; }
    @media (max-width: 600px) {
      .footer-left { display: none; }
      .footer-right { font-size: 10px; }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(footer);
}

document.addEventListener('DOMContentLoaded', injectFooter);
