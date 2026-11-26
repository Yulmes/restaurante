// Uso: node json-get.js archivo.json campo → imprime el campo (los objetos, como JSON).
import { readFileSync } from 'node:fs';

const [file, field] = process.argv.slice(2);
const value = JSON.parse(readFileSync(file, 'utf8'))[field];
if (value === undefined) {
  console.error(`falta el campo ${field}`);
  process.exit(1);
}
console.log(typeof value === 'object' ? JSON.stringify(value) : String(value));
