import { readFileSync, writeFileSync } from 'fs';

const vfile = new URL('version.json', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(vfile, 'utf8'));
const parts = version.split('.').map(Number);
const [major = 0, minor = 0, patch = 0] = parts;
if (parts.some(n => !Number.isInteger(n))) {
  console.error(`Invalid version in version.json: "${version}"`);
  process.exit(1);
}
const hasPatch = parts.length >= 3;
const flag = process.argv[2];
const next = flag === '--major' ? (hasPatch ? `${major + 1}.0.0` : `${major + 1}.0`)
           : flag === '--minor' ? (hasPatch ? `${major}.${minor + 1}.0` : `${major}.${minor + 1}`)
           : flag === '--patch' ? `${major}.${minor}.${patch + 1}`
           : version;
if (next !== version) {
  writeFileSync(vfile, JSON.stringify({ version: next }, null, 2) + '\n');
  console.log(`version ${version} → ${next}`);
}
