import { readFileSync, writeFileSync } from 'fs';

const vfile = new URL('version.json', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(vfile, 'utf8'));
const [major, minor] = version.split('.').map(Number);
const flag = process.argv[2];
const next = flag === '--major' ? `${major + 1}.0`
           : flag === '--minor' ? `${major}.${minor + 1}`
           : version;
if (next !== version) {
  writeFileSync(vfile, JSON.stringify({ version: next }, null, 2) + '\n');
  console.log(`version ${version} → ${next}`);
}
