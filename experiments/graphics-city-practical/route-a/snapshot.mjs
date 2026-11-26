/* global URL */
import { writeFileSync } from 'node:fs';
import { city } from '../common/city.js';

writeFileSync(new URL('./city.json', import.meta.url), `${JSON.stringify(city, null, 2)}\n`);
