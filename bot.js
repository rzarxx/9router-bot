const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ===================== CONFIG =====================
const TARGET_URL = 'http://10.110.1.7:20128/';
const AKUN_FILE = path.join(__dirname, 'akun.txt');
const SCREENSHOT_DIR = path.join(__dirname, 'debug_screenshots');
const DEBUG = true; // Screenshot every step
// ==================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ===================== HELPERS =====================

async function takeScreenshot(page, label) {
  const safeName = label.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(SCREENSHOT_DIR, `${safeName}_${Date.now()}.png`);
  try {
    await page.screenshot({ path: filePath, fullPage: true });
    console.log('  📸 ' + safeName);
  } catch (e) {
    console.log('  ⚠️  Screenshot failed: ' + e.message);
  }
}

async function dumpElements(page, label) {
  const items = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    const els = main.querySelectorAll('h1, h2, h3, h4, a, button, span, input, [role="button"]');
    const result = [];
    for (const el of els) {
      const text = el.textContent.trim().substring(0, 80);
      if (text) {
        const tag = el.tagName.toLowerCase();
        const href = el.getAttribute('href') || '';
        result.push(`<${tag}${href ? ' href="' + href + '"' : ''}> "${text}"`);
      }
    }
    return [...new Set(result)].slice(0, 40);
  });
  console.log('  📋 [' + label + '] Elements on page:');
  items.forEach((item) => console.log('    ' + item));
}

async function waitStable(page, ms = 1500) {
  await sleep(ms);
  try {
    await page.evaluate(() => new Promise((resolve) => {
      if (document.readyState === 'complete') resolve();
      else window.addEventListener('load', resolve);
    }));
  } catch {
    // ignore
  }
}

async function checkTabAlive(tab) {
  let url = null;
  try { url = tab.url(); } catch { return { alive: false, url: null, responsive: false }; }

  for (let retry = 0; retry < 3; retry++) {
    try {
      await tab.evaluate(() => true);
      return { alive: true, url, responsive: true };
    } catch {
      await sleep(1500);
      try { url = tab.url(); } catch { return { alive: false, url: null, responsive: false }; }
    }
  }
  return { alive: true, url, responsive: false };
}

async function waitTabReady(tab, maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      await tab.evaluate(() => document.readyState);
      return true;
    } catch {
      await sleep(1000);
    }
  }
  return false;
}

// ===================== FILE I/O =====================

function readAccounts() {
  if (!fs.existsSync(AKUN_FILE)) {
    console.error('❌ File akun.txt not found!');
    return [];
  }
  const content = fs.readFileSync(AKUN_FILE, 'utf-8').trim();
  if (!content) return [];
  return content
    .split(/\r?\n/)
    .map((line) => {
      const clean = line.trim();
      if (!clean || !clean.includes('|')) return null;
      const pipeIndex = clean.indexOf('|');
      const email = clean.substring(0, pipeIndex).trim();
      const password = clean.substring(pipeIndex + 1).trim();
      return { email, password, raw: clean };
    })
    .filter(Boolean);
}

function removeAccount(rawLine) {
  const content = fs.readFileSync(AKUN_FILE, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== rawLine);
  fs.writeFileSync(AKUN_FILE, lines.join('\n'));
}

// ===================== MAIN LOGIC =====================

async function loginAccount(account, index, total) {
  const { email, password } = account;
  console.log('\n════════════════════════════════════════');
  console.log('  Account ' + (index + 1) + '/' + total + ': ' + email);
  console.log('════════════════════════════════════════');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-sync',
      '--disable-features=SyncSetupPromo,ChromeSigninPromo',
      '--disable-signin-promo',
    ],
  });

  let success = false;

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);

    const newTabPromise = new Promise((resolve) => {
      browser.on('targetcreated', async (target) => {
        if (target.type() === 'page') {
          const p = await target.page();
          if (p && p !== page) {
            resolve(p);
          }
        }
      });
    });

    // ── Step 1: Navigate to 9Router ──
    console.log('[1/8] Navigating to ' + TARGET_URL + '...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await waitStable(page, 2000);
    if (DEBUG) await takeScreenshot(page, 'step1_loaded');

    // ── Step 2: Click "Providers" ──
    console.log('[2/8] Clicking Providers...');
    const providerClicked = await page.evaluate(() => {
      const links = document.querySelectorAll('nav a, aside a, a');
      for (const link of links) {
        const text = link.textContent.trim();
        if (text === 'Providers' || text === 'Provider') {
          link.click();
          return text;
        }
      }
      return null;
    });
    if (providerClicked) {
      console.log('  ✓ Clicked: "' + providerClicked + '"');
    } else {
      console.log('  ↳ Fallback: clicking second sidebar link...');
      await page.waitForSelector('aside nav a:nth-child(2)', { timeout: 5000 });
      await page.click('aside nav a:nth-child(2)');
    }
    await waitStable(page, 2000);
    if (DEBUG) await takeScreenshot(page, 'step2_providers_page');

    // ── Step 3: Click the Antigravity card ──
    console.log('[3/8] Clicking Antigravity card...');
    const antigravityResult = await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      for (const el of allElements) {
        const directText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent.trim())
          .join('');
        
        if (directText.toLowerCase() === 'antigravity') {
          let clickTarget = el.closest('a') || el.closest('[role="button"]') || el.closest('.cursor-pointer') || el;
          let current = el;
          for (let i = 0; i < 5; i++) {
            if (current.tagName === 'A' || current.getAttribute('role') === 'button' || current.onclick || current.classList.contains('cursor-pointer')) {
              clickTarget = current;
              break;
            }
            if (current.parentElement) current = current.parentElement;
            else break;
          }
          clickTarget.click();
          return { found: true, tag: clickTarget.tagName, text: clickTarget.textContent.trim().substring(0, 60) };
        }
      }
      return { found: false };
    });

    if (antigravityResult.found) {
      console.log('  ✓ Clicked card: <' + antigravityResult.tag.toLowerCase() + '> "' + antigravityResult.text + '"');
    } else {
      await takeScreenshot(page, 'step3_not_found');
      throw new Error('Antigravity card not found.');
    }
    await waitStable(page, 2000);
    if (DEBUG) await takeScreenshot(page, 'step3_after_click');

    // ── Step 4: Click "Add" button ──
    console.log('[4/8] Clicking Add button...');
    await sleep(1000);

    const addResult = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent.trim();
        if (text.toLowerCase().includes('add') || text === '+') {
          btn.click();
          return { found: true, text: text.substring(0, 40) };
        }
      }
      return { found: false };
    });

    if (addResult.found) {
      console.log('  ✓ Clicked: "' + addResult.text + '"');
    } else {
      await takeScreenshot(page, 'step4_no_add_btn');
      throw new Error('"Add" button not found.');
    }
    await waitStable(page, 2000);
    if (DEBUG) await takeScreenshot(page, 'step4_after_add');

    // ── Step 5: Click confirm in modal ──
    console.log('[5/8] Looking for confirmation modal...');
    await sleep(1500);

    const confirmResult = await page.evaluate(() => {
      let buttons = Array.from(document.querySelectorAll('div[class*="fixed"] button, div[class*="modal"] button, [role="dialog"] button'));
      if (buttons.length === 0) buttons = Array.from(document.querySelectorAll('button'));
      const buttonTexts = buttons.map((b) => b.textContent.trim().substring(0, 50));
      const confirmKeywords = ['understand', 'continue', 'confirm', 'yes', 'ok', 'agree', 'lanjut'];
      
      for (const btn of buttons) {
        const text = btn.textContent.trim().toLowerCase();
        for (const keyword of confirmKeywords) {
          if (text.includes(keyword)) {
            btn.click();
            return { found: true, text: btn.textContent.trim().substring(0, 40), allButtons: buttonTexts };
          }
        }
      }
      for (const btn of buttons) {
        const classes = btn.className || '';
        if (classes.includes('red') || classes.includes('danger') || classes.includes('destructive')) {
          btn.click();
          return { found: true, text: 'Red button: ' + btn.textContent.trim().substring(0, 40), allButtons: buttonTexts };
        }
      }
      return { found: false, allButtons: buttonTexts };
    });

    if (confirmResult.found) {
      console.log('  ✓ Clicked: "' + confirmResult.text + '"');
    } else {
      console.log('  ⚠️  Modal buttons found: ' + JSON.stringify(confirmResult.allButtons));
      throw new Error('Could not find confirm button.');
    }

    // ── Step 6: Wait for Google login tab ──
    console.log('[6/8] Waiting for Google login tab...');
    
    let newTab = null;
    try {
      newTab = await Promise.race([
        newTabPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000)),
      ]);
    } catch {
      const allPages = await browser.pages();
      if (allPages.length > 1) newTab = allPages[allPages.length - 1];
    }

    if (!newTab) throw new Error('No new tab opened after 20 seconds.');

    let tabUrl = newTab.url();
    for (let attempt = 0; attempt < 30; attempt++) {
      tabUrl = newTab.url();
      if (tabUrl && tabUrl !== 'about:blank' && tabUrl !== '') break;
      await sleep(1000);
    }
    if (tabUrl === 'about:blank' || !tabUrl) throw new Error('Tab stuck on about:blank.');

    await newTab.bringToFront();
    try { await newTab.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }); } catch {}
    await waitStable(newTab, 2000);
    console.log('  ✓ Tab URL: ' + newTab.url());

    // ── Step 7: Google Login ──
    console.log('[7/8] Google Login...');

    console.log('  Typing email...');
    await newTab.waitForSelector('#identifierId', { visible: true, timeout: 15000 });
    await newTab.type('#identifierId', email, { delay: 30 });
    await sleep(500);

    console.log('  Clicking Next (email)...');
    const emailNextClicked = await newTab.evaluate(() => {
      const next = document.querySelector('#identifierNext');
      if (next) { next.click(); return 'identifierNext'; }
      const buttons = document.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        if (btn.textContent.trim().toLowerCase().includes('next')) { btn.click(); return 'text:Next'; }
      }
      return null;
    });
    console.log('  ✓ Next clicked via: ' + emailNextClicked);
    await waitStable(newTab, 3000);

    console.log('  Waiting for password field...');
    let passwordField = null;
    for (let attempt = 0; attempt < 15; attempt++) {
      passwordField = await newTab.$('input[type="password"]');
      if (passwordField) {
        const isVisible = await passwordField.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (isVisible) break;
        passwordField = null;
      }
      await sleep(1000);
    }
    if (!passwordField) throw new Error('Password field not found after 15 seconds.');

    console.log('  Typing password...');
    await sleep(500);
    await passwordField.type(password, { delay: 30 });
    await sleep(500);

    console.log('  Clicking Next (password)...');
    const pwNextClicked = await newTab.evaluate(() => {
      const next = document.querySelector('#passwordNext');
      if (next) { next.click(); return 'passwordNext'; }
      const buttons = document.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        if (btn.textContent.trim().toLowerCase().includes('next')) { btn.click(); return 'text:Next'; }
      }
      return null;
    });
    console.log('  ✓ Next clicked via: ' + pwNextClicked);
    await waitStable(newTab, 3000);

    // ── Step 8: Google Consent (handles multiple screens for new accounts) ──
    console.log('[8/8] Google consent screens (loop for new accounts)...');

    const MAX_CONSENT_ROUNDS = 15;
    const CONSENT_TIMEOUT = 90000;
    const consentStartTime = Date.now();
    let consecutiveNoAction = 0;

    for (let round = 0; round < MAX_CONSENT_ROUNDS; round++) {
      if (Date.now() - consentStartTime > CONSENT_TIMEOUT) {
        console.log('  ⚠️  Consent timeout reached');
        break;
      }

      const tabStatus = await checkTabAlive(newTab);
      if (!tabStatus.alive) {
        console.log('  ✓ Google tab closed (OAuth complete)');
        break;
      }

      // CRITICAL: Check redirect FIRST! If it hit localhost callback, the login is DONE.
      if (tabStatus.url && (tabStatus.url.includes(new URL(TARGET_URL).hostname) || tabStatus.url.includes('localhost'))) {
        console.log('  ✓ Verified: Redirected to callback -> ' + tabStatus.url.substring(0, 70) + '...');
        break; // break out of consent loop, proceed to verification/paste
      }

      if (!tabStatus.responsive) {
        console.log('  ⏳ Round ' + (round + 1) + ': Page navigating, waiting... (URL: ' + tabStatus.url + ')');
        await sleep(3000);
        consecutiveNoAction = 0;
        continue;
      }

      await waitStable(newTab, 2000);

      let screenResult;
      try {
        screenResult = await newTab.evaluate(() => {
          const result = { action: null, detail: '' };

          function findAndClick(selectors, keywords) {
            for (const sel of selectors) {
              const elements = document.querySelectorAll(sel);
              for (const el of elements) {
                const text = el.textContent.trim().toLowerCase();
                for (const kw of keywords) {
                  if (text.includes(kw)) { el.click(); return { tag: el.tagName, text: el.textContent.trim().substring(0, 60), keyword: kw }; }
                }
              }
            }
            return null;
          }

          const pageText = document.body ? document.body.textContent.toLowerCase() : '';

          // Security warning
          if (pageText.includes('mendownload aplikasi ini') || pageText.includes('downloaded this app') || pageText.includes('make sure you downloaded')) {
            const loginBtnMatch = findAndClick(['button', '[role="button"]'], ['login', 'sign in', 'lanjutkan', 'continue']);
            if (loginBtnMatch) { result.action = 'warning_login_click'; result.detail = '<' + loginBtnMatch.tag + '> "' + loginBtnMatch.text + '"'; return result; }
          }

          // Gaplustos
          const gaplustos = document.querySelector('#gaplustosNext');
          if (gaplustos) { gaplustos.click(); result.action = 'gaplustos'; result.detail = 'Clicked #gaplustosNext'; return result; }

          // Generic clicks
          const clicks = [
            { id: 'tos', selectors: ['button', '[role="button"]', 'span[jsname]'], keywords: ['i agree', 'saya setuju', 'agree', 'setuju', 'accept', 'terima'] },
            { id: 'i_understand', selectors: ['button', '[role="button"]'], keywords: ['i understand', 'saya mengerti'] },
            { id: 'submit_approve', query: '#submit_approve_access' },
            { id: 'allow', selectors: ['button', '[role="button"]', 'span[jsname]'], keywords: ['allow', 'izinkan', 'continue', 'lanjutkan', 'sign in', 'login', 'masuk'] },
            { id: 'skip_protect', selectors: ['button', '[role="button"]', 'a'], keywords: ['skip', 'lewati', 'not now', 'nanti saja', 'done', 'selesai', 'confirm', 'konfirmasi'] },
            { id: 'security_advanced', selectors: ['button', '[role="button"]', 'a', '#details-button'], keywords: ['advanced', 'lanjutan'] },
            { id: 'security_proceed', selectors: ['a', 'button', '[role="button"]'], keywords: ['go to', 'proceed to', 'lanjut ke'] },
            { id: 'next', selectors: ['button', '[role="button"]'], keywords: ['next', 'berikutnya', 'selanjutnya'] }
          ];

          for (const c of clicks) {
            if (c.query) {
              const el = document.querySelector(c.query);
              if (el) { el.click(); result.action = c.id; result.detail = 'Clicked ' + c.query; return result; }
            } else {
              const match = findAndClick(c.selectors, c.keywords);
              if (match) { result.action = c.id; result.detail = '<' + match.tag + '> "' + match.text + '"'; return result; }
            }
          }

          // Checkboxes
          const checkboxes = document.querySelectorAll('input[type="checkbox"]:not(:checked)');
          if (checkboxes.length > 0) {
            checkboxes.forEach((cb) => cb.click());
            result.action = 'checkboxes';
            result.detail = 'Checked ' + checkboxes.length + ' checkboxes';
            return result;
          }

          result.action = null;
          return result;
        });
      } catch (evalError) {
        console.log('  ⏳ Round ' + (round + 1) + ': Page navigating, waiting...');
        await sleep(3000);
        consecutiveNoAction = 0;
        continue;
      }

      if (screenResult && screenResult.action) {
        console.log('  ✓ Round ' + (round + 1) + ' [' + screenResult.action + ']: ' + screenResult.detail);
        consecutiveNoAction = 0;
        await sleep(3000); 
      } else {
        consecutiveNoAction++;
        // Increased from 3 to 10 to give Google more time to load the next page
        if (consecutiveNoAction >= 10) break;
        await sleep(2000);
      }
    }

    // ── Verification & Pasting: confirm the login actually completed ──
    console.log('  ⏳ Verifying login completion...');

    let loginVerified = false;
    let finalCallbackUrl = null;

    for (let v = 0; v < 30; v++) {
      let currentUrl = null;
      let tabAlive = true;
      try {
        currentUrl = newTab.url();
      } catch {
        tabAlive = false;
      }

      if (!tabAlive) {
        console.log('  ✓ Verified: Google tab closed (OAuth flow complete)');
        loginVerified = true;
        break;
      }

      if (currentUrl) {
        console.log('  🔎 [Verify] Current URL: ' + currentUrl.substring(0, 80) + '...');
      }

      // CRITICAL: If the URL is localhost or target, the OAuth is DONE.
      if (currentUrl && (currentUrl.includes(new URL(TARGET_URL).hostname) || currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1'))) {
        console.log('  ✓ Got callback URL: ' + currentUrl.substring(0, 80) + '...');
        finalCallbackUrl = currentUrl;
        loginVerified = true;
        
        // INSTANTLY CLOSE THE TAB. This destroys the native "Sign in to Chromium" popup!
        try { await newTab.close(); } catch {}
        break;
      }

      // Still on Google — try clicking remaining buttons
      if (currentUrl && (currentUrl.includes('accounts.google.com') || currentUrl.includes('myaccount.google.com'))) {
        try {
          const clicked = await newTab.evaluate(() => {
            const keywords = ['allow', 'continue', 'i agree', 'agree', 'done', 'next', 'skip', 'confirm', 'accept'];
            const buttons = document.querySelectorAll('button, [role="button"]');
            for (const btn of buttons) {
              const text = btn.textContent.trim().toLowerCase();
              for (const kw of keywords) {
                if (text.includes(kw)) { btn.click(); return kw + ': ' + btn.textContent.trim().substring(0, 40); }
              }
            }
            return null;
          });
          if (clicked) console.log('    ✓ Clicked during verify: ' + clicked);
        } catch {
          // Page navigating
        }
      }
      
      await sleep(1500); // Check every 1.5 seconds
    }

    if (!loginVerified) {
      console.log('  ⚠️  Google tab still stuck on Google. Failsafe check on main page...');
      // Fallback if script missed something
    }

    if (loginVerified) {
      try { await page.bringToFront(); } catch {}
      await sleep(2000);

      // ── Step 9: Paste Callback URL ──
      if (finalCallbackUrl) {
        console.log('[9/9] Pasting callback URL back to 9Router...');
        const pasteSuccess = await page.evaluate((url) => {
          // 1. Find the visible input
          const inputs = Array.from(document.querySelectorAll('input')).filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && !el.disabled;
          });
          
          if (inputs.length === 0) return false;
          
          // Use the last input (usually the active one in a modal)
          const targetInput = inputs[inputs.length - 1];
          
          // Trigger React/Vue updates
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(targetInput, url);
          } else {
            targetInput.value = url;
          }
          
          targetInput.dispatchEvent(new Event('input', { bubbles: true }));
          targetInput.dispatchEvent(new Event('change', { bubbles: true }));
          
          // 2. Find submit/confirm button
          const buttons = Array.from(document.querySelectorAll('button')).filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && !el.disabled;
          });
          
          // Prioritize buttons matching confirm text
          const confirmKeywords = ['confirm', 'submit', 'save', 'add', 'ok', 'lanjut', 'yes', 'verif', 'paste'];
          for (const btn of buttons) {
            const txt = btn.textContent.toLowerCase();
            if (confirmKeywords.some(kw => txt.includes(kw))) {
              btn.click();
              return 'keyword:' + txt.substring(0, 20);
            }
          }
          
          // Fallback: click the last button
          if (buttons.length > 0) {
            buttons[buttons.length - 1].click();
            return 'fallback_last_button';
          }
          
          return false;
        }, finalCallbackUrl);

        if (pasteSuccess) {
          console.log('  ✓ URL pasted and submitted (' + pasteSuccess + ')');
        } else {
          console.log('  ⚠️ Could not find input field to paste the URL.');
        }
        await waitStable(page, 2000);
      }

      console.log('✅ Account ' + (index + 1) + ' (' + email + ') — SUCCESS');
      removeAccount(account.raw);
      console.log('  Removed from akun.txt');
      success = true;
    } else {
      throw new Error('Login verification failed — Google consent screens may not have completed.');
    }

  } catch (error) {
    console.error('❌ Account ' + email + ' — FAILED: ' + error.message);
  } finally {
    try { await browser.close(); } catch {}
    console.log('  Browser closed.\n');
  }

  return success;
}

// ===================== ENTRY POINT =====================

(async () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  9Router — Add Mass Account AntiGravity  ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const accounts = readAccounts();
  console.log('📄 Accounts loaded: ' + accounts.length);

  if (accounts.length === 0) {
    console.log('⚠️  No accounts found in akun.txt');
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < accounts.length; i++) {
    const ok = await loginAccount(accounts[i], i, accounts.length);
    if (ok) {
      successCount++;
    } else {
      failCount++;
    }

    if (i < accounts.length - 1) {
      console.log('⏳ Delay 3 seconds before next account...\n');
      await sleep(3000);
    }
  }

  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║              SUMMARY                     ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Total:   ' + String(accounts.length).padEnd(30) + '║');
  console.log('║  Success: ' + String(successCount).padEnd(30) + '║');
  console.log('║  Failed:  ' + String(failCount).padEnd(30) + '║');
  console.log('╚══════════════════════════════════════════╝');
})();