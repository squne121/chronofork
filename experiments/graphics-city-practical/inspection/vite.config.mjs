import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
export default { root: resolve(here, '..'), cacheDir: resolve(here, 'cache'), server: { host: '127.0.0.1', port: 5178, strictPort: true } }
