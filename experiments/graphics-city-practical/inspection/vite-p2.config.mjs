import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
export default { root: resolve(here, '../p2'), cacheDir: resolve(here, 'cache-p2'), server: { host: '127.0.0.1', port: 5179, strictPort: true } }
