import { readFileSync } from 'node:fs';
const t = String(readFileSync('C:\\Users\\CLAUDE\\Desktop\\Tech Projects\\render_api.txt', 'utf8')).trim();
const K = t.includes('=') ? t.split('=', 2)[1].trim() : t;
const j = await (await fetch('https://api.render.com/v1/services/srv-dacs1jht0dsc73f0n820/deploys?limit=6', {
  headers: { Authorization: `Bearer ${K}` },
})).json();
for (const item of j) {
  const d = item.deploy || item;
  const c = (d.commit || {}).sha || '?';
  console.log(d.id, '|', d.status, '| trigger', d.trigger, '|', String(c).slice(0, 9), '|', ((d.commit || {}).message || '').slice(0, 50));
}
