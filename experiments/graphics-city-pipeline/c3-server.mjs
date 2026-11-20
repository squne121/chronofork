/* global process, setTimeout, clearTimeout */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

// Readiness must come from this child, never from a pre-existing listener.
export async function startC3Server(temp) {
  const child = spawn(process.execPath, [join(temp, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5198', '--strictPort'], { cwd: temp, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Vite startup timed out: ${output}`)), 10000)
      const fail = error => { clearTimeout(timer); reject(error) }
      child.once('error', fail)
      child.once('exit', code => fail(new Error(`Vite exited before readiness (code ${code}): ${output}`)))
      child.stderr.on('data', data => { output += data })
      child.stdout.on('data', data => {
        output += data
        if (/Local:\s+http:\/\/127\.0\.0\.1:5198\//.test(output)) { clearTimeout(timer); resolve() }
      })
    })
    return child
  } catch (error) {
    child.kill()
    throw error
  }
}
