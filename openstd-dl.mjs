import { chromium } from '@playwright/test'
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const OUT = '/Users/plankton/Documents/罗山/标准规范/PDF原文'
mkdirSync(OUT, { recursive: true })

const ITEMS = [
  { hcno: '3052905B8A5060F265DA852A99301552', key: '47853', file: 'GBT-47853-2026-智慧园区评价指标.pdf' },
  { hcno: '279FA7E730F97552A025182D2843A5C6', key: '39218', file: 'GBT-39218-2020-智慧化工园区建设指南.pdf' },
]

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
const waitCode = async (key, secs) => {
  const f = `/tmp/code_${key}.txt`
  for (let i = 0; i < secs; i++) {
    if (existsSync(f)) { const c = readFileSync(f, 'utf8').trim(); rmSync(f, { force: true }); return c }
    await sleep(1000)
  }
  return null
}

const browser = await chromium.launch({ headless: false, args: ['--no-proxy-server'] })

for (const it of ITEMS) {
  log(`==== ${it.key} 开始`)
  let popup
  try {
    const ctx = await browser.newContext({ acceptDownloads: true })
    const page = await ctx.newPage()
    await page.goto(`https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=${it.hcno}`, { timeout: 45000 })
    await page.locator('.xz_btn').first().waitFor({ timeout: 20000 })
    log(`${it.key}: 信息页已开，点击下载标准`)

    const popupP = ctx.waitForEvent('page', { timeout: 30000 })
    await page.locator('.xz_btn').first().click()
    popup = await popupP
    await popup.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {})
    await popup.bringToFront()
    await popup.locator('img.verifyCode').waitFor({ state: 'attached', timeout: 30000 })
    log(`${it.key}: 验证码页已开，等待人工填码（或喂码 /tmp/code_${it.key}.txt）`)

    const snapCaptcha = async () => {
      await popup.evaluate(() => { try { refreshVerifyCode() } catch { document.querySelector('img.verifyCode')?.setAttribute('src', 'gc?' + Date.now()) } })
      await popup.waitForFunction(() => { const i = document.querySelector('img.verifyCode'); return i && i.complete && i.naturalWidth > 0 }, { timeout: 30000 })
      const b64 = await popup.evaluate(async () => {
        const src = document.querySelector('img.verifyCode').src
        const buf = await (await fetch(src, { credentials: 'same-origin' })).arrayBuffer()
        let bin = ''
        const bytes = new Uint8Array(buf)
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return btoa(bin)
      })
      writeFileSync(`/tmp/cap_${it.key}.png`, Buffer.from(b64, 'base64'))
      rmSync(`/tmp/code_${it.key}.txt`, { force: true })
      log(`${it.key}: 验证码已更新 -> /tmp/cap_${it.key}.png`)
    }
    await snapCaptcha()

    // 下载监听全程常开：人工在浏览器里填码也能捕获
    let saved = null
    const dlP = ctx.waitForEvent('download', { timeout: 1800000 })
    dlP.then((dl) => dl.saveAs(`${OUT}/${it.file}`))
      .then(() => { saved = it.file; log(`${it.key}: 下载完成 -> ${it.file} (${it.file})`) })
      .catch((e) => log(`${it.key}: 下载保存异常 ${String(e).split('\n')[0]}`))

    const t0 = Date.now()
    while (!saved && Date.now() - t0 < 1800000) {
      const code = await waitCode(it.key, 60)
      if (saved) break
      if (code) {
        log(`${it.key}: 喂码 [${code}]`)
        try {
          await popup.locator('#verifyCode').fill(code, { timeout: 8000 })
          await popup.locator('#verifyCode').press('Enter')
        } catch {
          try { await popup.evaluate((c) => { document.querySelector('#verifyCode').value = c; checkCode() }, code) } catch {}
        }
        for (let t = 0; t < 25 && !saved; t++) await sleep(1000)
        if (!saved) { log(`${it.key}: 喂码未触发下载，刷新验证码`); try { await snapCaptcha() } catch {} }
      }
      // 无人喂码时静默轮询，等人工在浏览器里填
    }
    if (!saved) throw new Error('30 分钟超时未下载')
    await ctx.close()
  } catch (e) {
    try { log(`${it.key}: 失败时 popup url=${popup.url()}`) } catch {}
    log(`${it.key}: FAIL ${String(e).split('\n')[0]}`)
  }
}

await browser.close()
log('全部结束')
