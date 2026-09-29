import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { generate } from 'selfsigned'

import { env } from './config/env.js'

/**
 * DEV-ONLY helper. Slack refuses http:// redirect URLs, so this listens on
 * https://localhost:4001 (self-signed certificate) and forwards every request,
 * unchanged, to the API on http://localhost:<PORT>.
 *
 * The certificate lives in the user's home folder (not the repo) so the private
 * key can never be committed. Run with: npx tsx src/devHttpsProxy.ts
 */
const LISTEN_PORT = 4001

async function loadOrCreateCert() {
  const dir = join(homedir(), '.outbox-dev-certs')
  const keyPath = join(dir, 'localhost.key.pem')
  const certPath = join(dir, 'localhost.cert.pem')

  if (existsSync(keyPath) && existsSync(certPath)) {
    return { key: readFileSync(keyPath), cert: readFileSync(certPath), created: false, dir }
  }

  mkdirSync(dir, { recursive: true })
  // Defaults: 2048-bit RSA, valid for 365 days, DNS name = the common name.
  const pems = await generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048 })
  writeFileSync(keyPath, pems.private)
  writeFileSync(certPath, pems.cert)
  return { key: pems.private, cert: pems.cert, created: true, dir }
}

async function main() {
  const { key, cert, created, dir } = await loadOrCreateCert()

  const server = https.createServer({ key, cert }, (req, res) => {
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: env.PORT,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upstreamRes) => {
        const headers = { ...upstreamRes.headers }
        // Never let the browser pin HSTS for localhost: it would force https on
        // the frontend/API ports and break them.
        delete headers['strict-transport-security']
        res.writeHead(upstreamRes.statusCode ?? 502, headers)
        upstreamRes.pipe(res)
      },
    )

    upstream.on('error', (err) => {
      console.log('proxy: upstream error:', err.message)
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('Bad gateway: is the API running on port ' + env.PORT + '?')
      } else {
        res.destroy()
      }
    })

    req.on('error', () => upstream.destroy())
    req.pipe(upstream)
  })

  server.listen(LISTEN_PORT, () => {
    console.log(`https proxy listening on https://localhost:${LISTEN_PORT} -> http://localhost:${env.PORT}`)
    console.log(created ? `new certificate created in ${dir}` : `reusing certificate from ${dir}`)
  })
}

main().catch((err) => {
  console.error('https proxy failed to start:', err)
  process.exit(1)
})
