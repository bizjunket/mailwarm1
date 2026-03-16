const express = require('express')
const nodemailer = require('nodemailer')
const cors = require('cors')
const path = require('path')
const http = require('http')

const app = express()

// Hostinger sets PORT automatically — always use process.env.PORT
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Serve the frontend from /public
app.use(express.static(path.join(__dirname, 'public')))

// All non-API routes serve the frontend (SPA fallback)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// ── Health check ─────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '1.0.0', env: process.env.NODE_ENV || 'production' })
})

// ── Build SMTP transporter ────────────────────────────────────────────
function makeTransporter(account) {
  return nodemailer.createTransport({
    host: account.smtp,
    port: parseInt(account.port) || 587,
    secure: parseInt(account.port) === 465,
    auth: {
      user: account.email,
      pass: account.password,
    },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  })
}

// ── POST /api/test — verify SMTP credentials ─────────────────────────
app.post('/api/test', async (req, res) => {
  const { account } = req.body
  if (!account?.email || !account?.password || !account?.smtp) {
    return res.json({ ok: false, error: 'Missing email, password, or SMTP host.' })
  }
  try {
    const transporter = makeTransporter(account)
    await transporter.verify()
    transporter.close()
    res.json({ ok: true, message: 'Connection verified! Your SMTP credentials work.' })
  } catch (err) {
    res.json({ ok: false, error: friendlyError(err.message) })
  }
})

// ── POST /api/send-one — send a single email ─────────────────────────
app.post('/api/send-one', async (req, res) => {
  const { account, to, subject, body, fromName } = req.body
  if (!account?.email || !account?.password || !account?.smtp) {
    return res.json({ ok: false, error: 'Account not configured.' })
  }
  try {
    const transporter = makeTransporter(account)
    const info = await transporter.sendMail({
      from: `"${fromName || account.name || account.email}" <${account.email}>`,
      to,
      subject,
      text: body,
      html: bodyToHtml(body),
    })
    transporter.close()
    res.json({ ok: true, to, messageId: info.messageId })
  } catch (err) {
    res.json({ ok: false, error: friendlyError(err.message), to })
  }
})

// ── POST /api/send-batch — send batch with SSE progress ──────────────
app.post('/api/send-batch', async (req, res) => {
  const { account, emails, subject, body, fromName, delaySeconds = 60 } = req.body

  if (!account?.email || !emails?.length) {
    return res.json({ ok: false, error: 'Missing account or recipients.' })
  }

  // Server-Sent Events setup
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
      if (typeof res.flush === 'function') res.flush()
    } catch (e) { /* client disconnected */ }
  }

  let stopped = false
  req.on('close', () => { stopped = true })

  send({ type: 'start', total: emails.length })

  const transporter = makeTransporter(account)
  let sent = 0, failed = 0

  for (let i = 0; i < emails.length; i++) {
    if (stopped) break

    const to = emails[i]
    try {
      await transporter.sendMail({
        from: `"${fromName || account.name || account.email}" <${account.email}>`,
        to,
        subject,
        text: body,
        html: bodyToHtml(body),
      })
      sent++
      send({ type: 'sent', to, index: i, total: emails.length, sent, failed })
    } catch (err) {
      failed++
      send({
        type: 'failed',
        to,
        error: friendlyError(err.message),
        index: i,
        total: emails.length,
        sent,
        failed,
      })
    }

    // Delay with ±30% jitter between sends (skip after last email)
    if (i < emails.length - 1 && !stopped) {
      const jitter = 1 + (Math.random() * 0.6 - 0.3)
      const ms = Math.round(delaySeconds * 1000 * jitter)
      send({ type: 'waiting', nextIn: Math.round(ms / 1000), next: emails[i + 1] })
      await sleep(ms)
    }
  }

  transporter.close()
  send({ type: 'done', sent, failed, total: emails.length })
  res.end()
})

// ── Helpers ───────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function bodyToHtml(text = '') {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, sans-serif; font-size: 15px; line-height: 1.7; color: #222; max-width: 600px; margin: 0 auto; padding: 32px 24px;">
${escaped}
</body>
</html>`
}

function friendlyError(msg = '') {
  const m = msg.toLowerCase()
  if (m.includes('invalid login') || m.includes('535') || m.includes('username and password') || m.includes('authentication failed'))
    return 'Wrong password. If 2FA is enabled on your account, generate an App Password instead of using your regular password.'
  if (m.includes('econnrefused') || m.includes('etimedout') || m.includes('enotfound') || m.includes('getaddrinfo'))
    return 'Cannot reach SMTP server. Double-check the host and port, and make sure SMTP is enabled in your email settings.'
  if (m.includes('534') || m.includes('please log in via') || m.includes('application-specific'))
    return 'Your provider requires an App Password. Enable 2FA then generate an App Password for MailWarm.'
  if (m.includes('certificate') || m.includes('ssl') || m.includes('tls'))
    return 'SSL/TLS error. Try switching port: use 587 for STARTTLS or 465 for SSL.'
  if (m.includes('rate') || m.includes('quota') || m.includes('too many') || m.includes('limit'))
    return 'Rate limit hit by your email provider. Increase the delay between sends.'
  if (m.includes('spam') || m.includes('blocked') || m.includes('rejected') || m.includes('policy'))
    return 'Email rejected by server — your sender reputation may be low. Increase warm-up delays and check your domain\'s SPF/DKIM records.'
  return msg.slice(0, 180)
}

// ── Start ─────────────────────────────────────────────────────────────
const server = http.createServer(app)

server.listen(PORT, () => {
  console.log(`\n✓ MailWarm running on port ${PORT}`)
  console.log(`  ENV: ${process.env.NODE_ENV || 'production'}`)
})

server.on('error', (err) => {
  console.error('Server error:', err.message)
  process.exit(1)
})

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...')
  server.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})

module.exports = app
