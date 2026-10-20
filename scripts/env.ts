import fs from 'node:fs';
for (const f of ['.env.local', '.env']) if (fs.existsSync(f))
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
