import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const indexPath = join(process.cwd(), 'dist/public/index.html')

const criticalCss = String.raw`
*,::before,::after{box-sizing:border-box}
html{color-scheme:light dark;-webkit-text-size-adjust:100%;tab-size:4;line-height:1.5}
body{margin:0;background:#fafafa;color:#1f1f1f;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer;-webkit-appearance:none;appearance:none;border:0;background:transparent;padding:0}
a{color:inherit;text-decoration:none}
svg{display:block}
@media (prefers-color-scheme:dark){body{background:#0c0c0c;color:#f1f1f1}}
[data-layout="blank"],#vocs-content,[data-v-content]{min-height:100%;width:100%}
[data-v-content]{padding:0;max-width:none}
.accounts-landing{--background:#fafafa;--foreground:#1f1f1f;--foreground-muted:#6b6b6b;--foreground-subtle:#8a8a8a;--panel-1:#f1f1f1;--panel-3:#d8d8d8;--panel-5:#dcdcdc;--panel-deep:#ececec;--panel-border:#dedede;position:relative;width:100%;background:var(--background);color:var(--foreground);font-family:"Pilat",Arial,Helvetica,sans-serif}
@media (prefers-color-scheme:dark){.accounts-landing{--background:#0c0c0c;--foreground:#f1f1f1;--foreground-muted:#a0a0a0;--foreground-subtle:#777;--panel-1:#1f1f1f;--panel-3:#343434;--panel-5:#252525;--panel-deep:#151515;--panel-border:#2a2a2a}}
.accounts-landing>div{width:100%;max-width:1245px;margin-inline:auto}
.accounts-landing nav{display:flex;align-items:center;justify-content:space-between;padding:24px}
.accounts-landing nav a,.accounts-landing nav button{border:0;background:transparent;color:var(--foreground)}
.accounts-landing nav a:first-child{display:grid;width:48px;height:48px;place-items:center;background:var(--background)}
.accounts-landing nav>div{display:flex;align-items:center;gap:28px;padding-inline:12px}
.accounts-landing nav span{display:inline-flex}
.accounts-landing nav span a{display:flex;align-items:center;gap:8px;font-size:12px}
.accounts-landing nav button{display:grid;width:28px;height:28px;place-items:center;padding:0}
.accounts-landing nav+div{display:flex;width:100%;max-width:720px;flex-direction:column;align-items:center;gap:36px;margin-inline:auto;padding:96px 24px 176px}
.accounts-landing nav+div>div:first-child{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}
.accounts-landing h1{margin:0;color:var(--foreground);font-size:32px;font-weight:400;line-height:1.1}
.accounts-landing h1+p{max-width:544px;margin:0;color:var(--foreground-muted);font-size:16px;line-height:1.5}
.accounts-landing nav+div>div:nth-child(2){display:flex;width:100%;max-width:560px}
.accounts-landing nav+div>div:nth-child(2)>div{display:flex;width:100%;align-items:center;justify-content:space-between;background:var(--panel-1);padding:12px 16px}
.accounts-landing nav+div>div:nth-child(2) button{border:0;background:transparent}
.accounts-landing nav+div>div:nth-child(2)>div>div{display:flex;align-items:baseline;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:16px}
.accounts-landing nav+div>div:nth-child(2)>div>div button{position:relative;display:inline-block;width:5ch;overflow:hidden;white-space:nowrap;text-align:left;vertical-align:bottom}
.accounts-landing nav+div>div:nth-child(2)>div>div button>span:first-child{visibility:hidden;display:block}
.accounts-landing nav+div>div:nth-child(2)>div>div button>span:not(:first-child){position:absolute;top:0;left:0;color:var(--foreground-subtle)}
.accounts-landing nav+div>div:nth-child(2)>div>div button+span{padding-left:1ch;color:var(--foreground)}
.accounts-landing nav+div>div:nth-child(2)>div>button:last-child{display:grid;width:18px;height:18px;place-items:center}
.accounts-landing nav+div>div:nth-child(3){display:flex;align-items:center;gap:20px;margin-top:-14px;color:var(--foreground-muted);font-size:12px}
.accounts-landing nav+div>div:nth-child(3) button{display:flex;align-items:center;gap:4px;border:0;background:transparent;padding:0;color:var(--foreground-muted);font-size:12px}
.accounts-landing nav+div>div:nth-child(3) a{display:flex;align-items:center;gap:6px;color:var(--foreground)}
.accounts-landing nav+div>div:nth-child(3)>span{color:var(--foreground-subtle)}
.accounts-landing nav+div>div:nth-child(3)>div{display:flex;align-items:center;gap:8px}
.accounts-landing nav+div>div:nth-child(3)>div>span{opacity:0}
.accounts-landing section[aria-hidden="true"]{position:relative;padding:8px 24px 48px}
.accounts-landing section[aria-hidden="true"]>div{position:relative;z-index:10;width:100%;max-width:1089px;margin-inline:auto;border:1px solid var(--panel-3);background:color-mix(in srgb,var(--background) 75%,transparent)}
.accounts-landing section[aria-hidden="true"]>div>div:first-child{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin:12px 12px 0;background:var(--panel-deep);padding:12px}
.accounts-landing section[aria-hidden="true"]>div>div:first-child>div{display:flex;align-items:center;gap:12px}
.accounts-landing section[aria-hidden="true"]>div>div:first-child>div:first-child span:first-child{width:12px;height:15px}
.accounts-landing section[aria-hidden="true"]>div>div:first-child>div:first-child span:last-child{width:176px;max-width:48vw;height:12px}
.accounts-landing section[aria-hidden="true"]>div>div:first-child>div:last-child{min-width:148px;justify-content:flex-end;gap:8px}
.accounts-landing section[aria-hidden="true"]>div>div:first-child>div:last-child span:first-child{width:6px;height:6px;border-radius:999px;background:var(--foreground-subtle)}
.accounts-landing section[aria-hidden="true"]>div>div:first-child>div:last-child span:last-child{width:96px;height:12px}
.accounts-landing section[aria-hidden="true"]>div>div:nth-child(2){display:grid;min-height:420px;grid-template-columns:1fr}
.accounts-landing section[aria-hidden="true"]>div>div:nth-child(2)>div:first-child{display:none}
.accounts-landing section[aria-hidden="true"]>div>div:nth-child(2)>div:last-child{display:flex;min-height:420px;flex-direction:column;gap:16px;padding:16px 16px 24px}
.accounts-landing section[aria-hidden="true"]>div>div:nth-child(2)>div:last-child span:first-child{width:75%;height:48px}
.accounts-landing section[aria-hidden="true"]>div>div:nth-child(2)>div:last-child span:nth-child(2){width:66.666667%;height:48px;margin-left:auto}
.accounts-landing section[aria-hidden="true"]>div>div:nth-child(2)>div:last-child span:nth-child(3){width:100%;height:112px}
.accounts-landing section[aria-hidden="true"] span{display:block;background:var(--panel-5)}
@media (min-width:640px){.accounts-landing nav+div{padding-top:160px}.accounts-landing h1{font-size:48px;white-space:nowrap}.accounts-landing h1+p{font-size:20px;line-height:1.4}.accounts-landing section[aria-hidden="true"]{padding-top:16px;padding-bottom:80px}.accounts-landing section[aria-hidden="true"]>div>div:first-child{margin:27px 27px 0;gap:12px}.accounts-landing section[aria-hidden="true"]>div>div:first-child>div:first-child span:last-child{width:256px}.accounts-landing section[aria-hidden="true"]>div>div:first-child>div:last-child{min-width:260px}.accounts-landing section[aria-hidden="true"]>div>div:nth-child(2){min-height:510px;grid-template-columns:260px 1fr}.accounts-landing section[aria-hidden="true"]>div>div:nth-child(2)>div:first-child{display:block;border-right:1px solid var(--panel-border)}.accounts-landing section[aria-hidden="true"]>div>div:nth-child(2)>div:first-child>div{display:flex;height:100%;flex-direction:column;justify-content:space-between;padding-block:16px}.accounts-landing section[aria-hidden="true"]>div>div:nth-child(2)>div:first-child span{height:40px;margin-inline:16px}.accounts-landing section[aria-hidden="true"]>div>div:nth-child(2)>div:last-child{min-height:510px;padding:27px 27px 24px}}
`;

function noscriptStylesheet(href: string) {
  return `<noscript><link rel="stylesheet" href="${href}"/></noscript>`
}

function deferStylesheets(hrefs: string[]) {
  const serializedHrefs = JSON.stringify(hrefs)
  return `<script>(function(){var h=${serializedHrefs};function l(){setTimeout(function(){for(var i=0;i<h.length;i++){var e=document.createElement('link');e.rel='stylesheet';e.href=h[i];document.head.appendChild(e)}},3000)}if(document.readyState==='complete')l();else window.addEventListener('load',l,{once:true})})()</script>`
}

function deferHydration(html: string) {
  return html.replace(
    /import\("([^"]+\.js)"\)/,
    (_match, src: string) => {
      const serializedSrc = JSON.stringify(src)
      return `(function(){var s=${serializedSrc};var loaded=false;function load(){if(loaded)return;loaded=true;import(s)}function idle(){setTimeout(load,3000)}window.addEventListener('pointerdown',load,{once:true,passive:true});window.addEventListener('keydown',load,{once:true});if(document.readyState==='complete')idle();else window.addEventListener('load',idle,{once:true})})()`
    },
  )
}

let html = readFileSync(indexPath, 'utf8')
const stylesheetHrefs = Array.from(
  new Set(
    Array.from(
      html.matchAll(/<link rel="stylesheet" href="([^"]+\.css)"\/>/g),
    )
      .map((match) => match[1])
      .filter((href): href is string => Boolean(href)),
  ),
)

html = html
  .replace(/<link rel="modulepreload"[^>]+>/g, '')
  .replace(/<link rel="preload" href="([^"]+\.css)" as="stylesheet"\/>/g, '')
  .replace(
    /<link rel="stylesheet" href="([^"]+\.css)"\/>/g,
    (_match, href: string) => noscriptStylesheet(href),
  )
  .replace(
    /(<body[^>]*>)<script>\(function\(\)\{try\{var t=localStorage\.getItem\('vocs-theme'\);[\s\S]*?<\/script>/,
    '$1',
  )
  .replace(
    /\nglobalThis\.__WAKU_ROUTER_PREFETCH__ = \(path, callback\) => \{[\s\S]*?\n\};/,
    '',
  )

html = deferHydration(html).replace(
  '</head>',
  `<style>${criticalCss}</style>${deferStylesheets(stylesheetHrefs)}</head>`,
)

writeFileSync(indexPath, html)
