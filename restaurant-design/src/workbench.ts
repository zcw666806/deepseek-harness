/** The restaurant views share a page with the existing authenticated Harness conversation. */

/**
 * Render the workbench shell with independently sized plan, scene, and chat frames.
 * @returns A same-origin page that never renders the imported document directly.
 */
export function renderWorkbench(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>餐厅设计工作台</title>
<style>
  :root{color-scheme:light dark;font:14px system-ui,sans-serif;background:Canvas;color:CanvasText}
  *{box-sizing:border-box}
  body{margin:0}
  main{display:grid;height:100dvh;grid-template-columns:minmax(0, 1.65fr) minmax(370px, 1fr);gap:1px;background:color-mix(in srgb, CanvasText 18%, Canvas)}
  .views{display:grid;grid-template-rows:minmax(0, 1.14fr) minmax(0, 1fr);gap:1px;min-width:0;min-height:0}
  section{display:grid;grid-template-rows:auto minmax(0, 1fr);min-width:0;min-height:0;background:Canvas}
  h2{margin:0;padding:6px 12px;font:600 13px system-ui,sans-serif;border-bottom:1px solid color-mix(in srgb, CanvasText 14%, Canvas)}
  iframe{display:block;border:0;width:100%;height:100%;min-width:0;min-height:0;background:Canvas}
  @media(max-width:780px){main{height:auto;grid-template-columns:1fr}.views{grid-template-rows:repeat(2,minmax(360px,52dvh))}.chat{min-height:65dvh}}
</style>
</head>
<body>
<main aria-label="餐厅设计工作台">
  <div class="views">
    <section aria-labelledby="plan-heading">
      <h2 id="plan-heading">二维平面</h2>
      <iframe title="餐厅二维平面" src="/api/restaurant.page?embedded=1&amp;view=plan"></iframe>
    </section>
    <section aria-labelledby="scene-heading">
      <h2 id="scene-heading">三维场景</h2>
      <iframe title="餐厅三维场景" src="/api/restaurant.page?embedded=1&amp;view=scene"></iframe>
    </section>
  </div>
  <section class="chat" aria-labelledby="chat-heading">
    <h2 id="chat-heading">Harness 对话</h2>
    <iframe title="Harness 对话" src="/"></iframe>
  </section>
</main>
</body>
</html>\n`
}
