/** Returns the static HTML body for geo-blocked requests. */
export function blockedHtml(title: string, message: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        background: #000;
        color: #fff;
      }

      .logo {
        position: absolute;
        top: 24px;
        left: 24px;
      }

      .content {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }

      .card {
        width: min(480px, 100%);
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.05);
        padding: 40px 32px;
        text-align: center;
      }

      h1 {
        margin: 0 0 8px;
        font-size: 32px;
        font-weight: 500;
        line-height: 1.2;
        letter-spacing: -0.03em;
      }

      p {
        margin: 0;
        color: rgba(255, 255, 255, 0.64);
        font-size: 16px;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <div class="logo">
      <svg aria-label="Tempo" fill="none" height="24" role="img" viewBox="0 0 107 24" width="107">
        <title>Tempo</title>
        <path
          fill="currentColor"
          d="M7.903 23.516h-6.28L7.445 5.593H0L1.624.34h20.739l-1.624 5.253h-7.046zM31.273 23.516H16.385L23.859.34h14.827l-1.409 4.419h-8.608l-1.562 4.975h8.332l-1.41 4.357h-8.362l-1.562 5.006h8.546zM38.011 23.516h-4.993L40.523.34h8.333l-.276 12.484L56.698.34h9.129l-7.475 23.176h-6.25l5.055-15.852-10.384 15.852h-3.707l.153-15.914zM72.856 4.635l-2.42 7.478h.674q2.297 0 3.829-1.081Q76.47 9.919 76.93 7.88q.398-1.761-.429-2.503-.826-.742-2.757-.742zm-6.066 18.88h-6.28L67.985.34h7.628q2.634 0 4.534.865 1.93.835 2.818 2.41.919 1.546.612 3.616-.398 2.72-2.082 4.79-1.686 2.07-4.381 3.213-2.665 1.113-5.974 1.113h-2.052zM98.546 22.033q-3.124 1.854-6.648 1.854h-.06q-3.126 0-5.27-1.39-2.114-1.422-3.033-3.833-.888-2.41-.428-5.284a16.3 16.3 0 0 1 2.665-6.674q2.082-3.06 5.207-4.883T97.658 0h.06q3.248 0 5.362 1.39 2.144 1.392 2.971 3.801.858 2.38.368 5.346-.582 3.492-2.665 6.582a16.3 16.3 0 0 1-5.208 4.914m-8.67-3.987q.828 1.576 2.88 1.576h.061q1.686 0 3.125-1.267 1.47-1.297 2.481-3.46 1.042-2.164 1.532-4.821.46-2.595-.368-4.172-.826-1.607-2.849-1.607h-.06q-1.563 0-3.034 1.298-1.44 1.298-2.511 3.492a18.8 18.8 0 0 0-1.563 4.759q-.49 2.595.307 4.202"
        />
      </svg>
    </div>
    <div class="content">
      <main class="card">
        <h1>${title}</h1>
        <p>${message}</p>
      </main>
    </div>
  </body>
</html>`
}
