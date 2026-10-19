#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2)).catch((err) => {
  const msg = err && err.stack ? err.stack : String(err);
  console.error(`\n[melya-cp-1c] Ошибка: ${msg}`);
  process.exit(1);
});
