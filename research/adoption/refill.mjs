// Re-fetch npm download counts that were rate-limited in fetch.mjs (sequential, with backoff).
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('adoption.json','utf8'));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const get = async u => { for (let i=0;i<6;i++){ const r = await fetch(u,{headers:{'user-agent':'adoption-survey-script'}}); if (r.ok) return r.json(); if (r.status===404) return {}; await sleep(4000*(i+1)); } return {}; };
for (const [p,x] of Object.entries(d.packages)) {
  if (x.weekly !== undefined || !x.latest) continue;
  const wk = await get(`https://api.npmjs.org/downloads/point/last-week/${p}`); await sleep(1200);
  const yr = await get(`https://api.npmjs.org/downloads/point/last-year/${p}`); await sleep(1200);
  x.weekly = wk.downloads; x.weekRange=[wk.start,wk.end]; x.yearly = yr.downloads;
}
fs.writeFileSync('adoption.json', JSON.stringify(d,null,1));
