import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'

const HCNO = 'C8CE2CCCDC4DA583AD9769DDD7D6183E' // GB/T 47874-2026
const browser = await chromium.launch({ args: ['--no-proxy-server'] })
const page = await (await browser.newContext({ acceptDownloads: true })).newPage()

const pdfBodies = []
page.on('response', async (res) => {
  const ct = res.headers()['content-type'] || ''
  const url = res.url()
  if (ct.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
    try { const buf = await res.body(); pdfBodies.push({ url, size: buf.length, buf }) } catch {}
  }
  if (url.includes('showGb') || url.includes('Download') || url.includes('viewGb')) {
    console.log('HIT:', res.status(), ct, url.slice(0, 120))
  }
})

// 1) 下载页（验证码）
await page.goto(`https://openstd.samr.gov.cn/bzgk/std/showGb?type=download&hcno=${HCNO}&request_locale=zh`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(3000)
await page.screenshot({ path: '/tmp/os-download-page.png' })
const txt = await page.locator('body').innerText()
console.log('--- download page text ---')
console.log(txt.replace(/\n{2,}/g, '\n').slice(0, 400))

// 2) 在线预览页
await page.goto(`https://openstd.samr.gov.cn/bzgk/std/showGb?type=online&hcno=${HCNO}&request_locale=zh`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(6000)
await page.screenshot({ path: '/tmp/os-preview-page.png' })
console.log('--- preview url:', page.url())
console.log('pdf responses captured:', pdfBodies.length)
for (const p of pdfBodies) console.log(' ', p.size, 'bytes', p.url.slice(0, 100))
if (pdfBodies.length) writeFileSync('/tmp/os-preview-capture.pdf', Buffer.from(pdfBodies[0].buf))
await browser.close()
