import fs from 'node:fs';
const hits: any[] = JSON.parse(fs.readFileSync('./zz-hits.json', 'utf8'));
const out: string[] = [];
hits.forEach((h, i) => {
  out.push(`\n=== #${i} [${h.cuando}] ${h.conversation_id} :: ${JSON.stringify(h.prods)}`);
  out.push(h.text);
});
fs.writeFileSync('./zz-textos.txt', out.join('\n'));
console.log('ok', hits.length);
