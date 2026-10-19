#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch((err) => {
  const msg = err && err.stack ? err.stack : String(err);
  console.error(`\n[mcp-1c-bundle] Ошибка: ${msg}`);
  process.exit(1);
});
