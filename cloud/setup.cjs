const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashPassword } = require('./server.cjs');
(async () => {
  const [publicUrl, destination] = process.argv.slice(2);
  if (!publicUrl || !destination || new URL(publicUrl).protocol !== 'https:') throw new Error('Usage: node cloud/setup.cjs https://your-domain.example /secure/path/private.env');
  const file = path.resolve(destination), instructions = `${file}.credentials.txt`;
  if (fs.existsSync(file) || fs.existsSync(instructions)) throw new Error('Refusing to overwrite existing connection credentials. Choose a new filename.');
  const password = crypto.randomBytes(18).toString('base64url'), writeToken = crypto.randomBytes(32).toString('base64url');
  const passwordHash = await hashPassword(password), secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `PUBLIC_URL=${new URL(publicUrl).origin}\nVIEW_PASSWORD_HASH=${passwordHash}\nWRITE_TOKEN=${writeToken}\nSESSION_SECRET=${secret}\nTRUST_PROXY=1\n`, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(instructions, `Website: ${new URL(publicUrl).origin}\nPhone viewing password: ${password}\nComputer connection key: ${writeToken}\n`, { mode: 0o600, flag: 'wx' });
  console.log(`Saved server environment to ${file}\nSaved private connection details to ${instructions}`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
