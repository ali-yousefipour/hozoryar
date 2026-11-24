/* Apply the saved appearance before styles paint; storage may be unavailable. */
(() => {
  const media=matchMedia('(prefers-color-scheme: dark)');
  let choice='system';
  try{choice=localStorage.getItem('hz_theme')||'system';}catch{}
  if(!['light','dark','system'].includes(choice))choice='system';
  function apply(){
    const theme=choice==='system'?(media.matches?'dark':'light'):choice;
    document.documentElement.dataset.theme=theme;
    document.querySelectorAll('[data-theme-select]').forEach(select=>select.value=choice);
    const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=theme==='dark'?'#101119':'#f6f7fb';
  }
  apply();
  media.addEventListener('change',()=>{if(choice==='system')apply();});
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('[data-theme-select]').forEach(select=>select.addEventListener('change',()=>{
      choice=select.value;try{localStorage.setItem('hz_theme',choice);}catch{}apply();
    }));apply();
  });
})();
