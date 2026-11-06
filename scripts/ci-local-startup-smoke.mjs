import fs from 'node:fs';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';

const sourceEnvPath = 'C:\\Users\\abo jood\\Desktop\\erp\\.env';
if (!fs.existsSync(sourceEnvPath)) {
  console.error('Local .env file was not found at the configured project path.');
  process.exit(1);
}
const parsed = dotenv.parse(fs.readFileSync(sourceEnvPath));
if (parsed.DB_DATABASE !== 'erp_actions_smoke' || !['127.0.0.1', 'localhost'].includes(parsed.DB_HOST) || !parsed.DB_USERNAME || !parsed.DB_PASSWORD) {
  console.error('Startup requires local MySQL (localhost), an isolated erp_actions_smoke database, and dedicated credentials. No application started.');
  process.exit(1);
}
const env = { ...process.env, ...parsed, NODE_ENV: 'test', PORT: '3099' };
const child = spawn(process.execPath, ['dist/server.js'], {
  cwd: process.cwd(),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});
let output = '';
let finished = false;
const timer = setTimeout(() => finish(false, 'startup timed out'), 30000);
function finish(ok, reason) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  child.kill();
  if (ok) console.log('PASS: ERP application started on port 3099 with isolated test database.');
  else {
    console.error('FAIL: ' + reason);
    console.error(output.slice(-8000));
  }
  process.exitCode = ok ? 0 : 1;
}
function handle(chunk) {
  output += chunk.toString();
  if (output.length > 16000) output = output.slice(-16000);
  if (output.includes('Server running on port 3099')) finish(true, 'started');
  if (output.includes('Failed to start application:')) finish(false, 'startup error');
}
child.stdout.on('data', handle);
child.stderr.on('data', handle);
child.on('error', e => finish(false, e.message));
child.on('exit', code => { if (!finished) finish(false, 'server exited with code ' + code); });
