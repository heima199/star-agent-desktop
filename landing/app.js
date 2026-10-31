// STAR landing page: download links, the clickable demo, and small effects.
// No dependencies; works from a static host or straight from the file system.

/**
 * Where the buttons go. The desktop installers are published from the STAR
 * console; replace these with the release URLs when they are available.
 */
const LINKS = {
  web: 'https://bo.spkx.cn/',
  windows: 'https://bo.spkx.cn/',
  mac: 'https://bo.spkx.cn/',
}

const icon = (id) => `<svg class="ico" aria-hidden="true"><use href="#i-${id}"/></svg>`
const escapeHtml = (text) => text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, reducedMotion ? 0 : ms))

// ─── Links and OS ────────────────────────────────────────────────────

function detectOs() {
  const platform = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase()
  return platform.includes('mac') ? 'mac' : 'windows'
}

function setupLinks() {
  document.querySelectorAll('[data-link]').forEach((el) => {
    const url = LINKS[el.getAttribute('data-link')]
    if (url) el.setAttribute('href', url)
  })
  const os = detectOs()
  const other = os === 'mac' ? 'windows' : 'mac'
  document.querySelectorAll('[data-download]').forEach((el) => {
    el.setAttribute('href', LINKS[os])
    const label = el.querySelector('[data-download-label]')
    if (label) label.textContent = os === 'mac' ? '下载 macOS 版' : '下载 Windows 版'
    const use = el.querySelector('[data-os-icon] use')
    if (use) use.setAttribute('href', os === 'mac' ? '#i-apple' : '#i-windows')
  })
  const hint = document.querySelector('[data-other-os]')
  if (hint) {
    hint.innerHTML = `也有 <a href="${LINKS[other]}">${other === 'mac' ? 'macOS' : 'Windows'} 版</a>，或者直接用 <a href="${LINKS.web}" target="_blank" rel="noopener">网页版</a>`
  }
  const year = document.querySelector('[data-year]')
  if (year) year.textContent = String(new Date().getFullYear())
}

// ─── Effects ─────────────────────────────────────────────────────────

function setupNav() {
  const nav = document.querySelector('.nav')
  const update = () => nav?.classList.toggle('scrolled', window.scrollY > 8)
  update()
  window.addEventListener('scroll', update, { passive: true })
}

function setupReveal() {
  const items = document.querySelectorAll('.reveal')
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'))
    return
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('in')
      entry.target.querySelector('.demo')?.classList.add('in')
      observer.unobserve(entry.target)
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 })
  items.forEach((el) => observer.observe(el))
}

/** A slow field of small stars behind the hero; pauses when off screen. */
function setupStars() {
  const canvas = document.querySelector('.stars')
  if (!canvas || reducedMotion) return
  const ctx = canvas.getContext('2d')
  let stars = []
  let visible = true
  const resize = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = canvas.clientWidth * ratio
    canvas.height = canvas.clientHeight * ratio
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    const count = Math.round((canvas.clientWidth * canvas.clientHeight) / 9000)
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.clientWidth,
      y: Math.random() * canvas.clientHeight,
      r: Math.random() * 1.1 + 0.2,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 0.8,
    }))
  }
  const draw = (time) => {
    if (visible) {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
      for (const star of stars) {
        const alpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(star.phase + (time / 1000) * star.speed))
        ctx.beginPath()
        ctx.fillStyle = `rgba(236, 235, 232, ${alpha.toFixed(3)})`
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    requestAnimationFrame(draw)
  }
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting }).observe(canvas)
  resize()
  window.addEventListener('resize', resize)
  requestAnimationFrame(draw)
}

// ─── Demo results ────────────────────────────────────────────────────

const RESULTS = {
  slides: () => `
    <div class="result-card">
      <h4>${icon('slides')}竞品周报-第43周.pptx<span>12 页 · 已保存到项目文件夹</span></h4>
      <div class="slides">
        <div class="slide accent"><b></b><div><i></i><i></i></div></div>
        <div class="slide"><b></b><div class="bars"><span style="height:45%"></span><span style="height:80%"></span><span style="height:60%"></span><span style="height:95%"></span></div></div>
        <div class="slide"><b></b><div><i></i><i></i></div></div>
      </div>
      <div class="meta-row"><span class="pill ok">${icon('check')}来源 18 个</span><span class="pill">${icon('clock')}用时 3 分 12 秒</span><span class="pill">消耗 6 积分</span></div>
    </div>`,
  cron: () => `
    <div class="result-card">
      <h4>${icon('clock')}已创建定时任务<span>可在「定时任务」里随时修改</span></h4>
      <div class="cron"><span class="big">09:00</span><div class="answer-text"><b>每个工作日</b> · 汇总邮件和日程里的待办，按优先级排好后发到飞书</div></div>
      <div class="meta-row"><span class="pill ok">${icon('check')}下一次：明天 09:00</span><span class="pill">${icon('shield')}只读邮件，不会代你回复</span></div>
    </div>`,
  diff: () => `
    <div class="result-card">
      <h4>${icon('code')}src/pages/Login.tsx<span>+86 −4</span></h4>
      <div class="diff"><div class="ctx">  export function Login() {</div><div class="add">+   const [phone, setPhone] = useState('')</div><div class="add">+   const sendCode = useSendCode(phone)</div><div class="del">-   return &lt;Placeholder /&gt;</div><div class="add">+   return &lt;LoginForm onSubmit={signIn} /&gt;</div><div class="ctx">  }</div></div>
      <div class="meta-row"><span class="pill ok">${icon('check')}测试 24 项通过</span><span class="pill">${icon('shield')}改文件前已征得同意</span></div>
    </div>`,
  poster: () => `
    <div class="result-card">
      <h4>${icon('image')}新品发布会海报<span>1080×1350 · 3 个版本</span></h4>
      <div class="poster">
        <svg viewBox="0 0 150 188" role="img" aria-label="海报预览">
          <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d2420"/><stop offset="1" stop-color="#141312"/></linearGradient>
          <radialGradient id="ps" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#f6c7a8"/><stop offset=".55" stop-color="#d07b52"/><stop offset="1" stop-color="#6e3a20"/></radialGradient></defs>
          <rect width="150" height="188" fill="url(#pg)"/>
          <circle cx="75" cy="70" r="34" fill="url(#ps)"/>
          <path d="M0 132 Q40 112 75 124 T150 118 V188 H0Z" fill="#1d1a18"/>
          <rect x="22" y="140" width="106" height="9" rx="4.5" fill="#ecebe8"/>
          <rect x="22" y="155" width="70" height="6" rx="3" fill="rgba(236,235,232,.4)"/>
          <rect x="22" y="168" width="40" height="10" rx="5" fill="#d07b52"/>
        </svg>
        <div class="answer-text"><b>画板里继续修改：</b>双击标题改文字，拖动调整位置；也可以一键抠出主体、换背景，或用首帧生成 5 秒视频。
          <div class="meta-row"><span class="pill">${icon('layers')}6 个图层</span><span class="pill">消耗 3 积分</span></div>
        </div>
      </div>
    </div>`,
  chart: () => `
    <div class="result-card">
      <h4>${icon('chat')}Q3 现金流解读<span>依据：财报.pdf 第 18–21 页</span></h4>
      <div class="answer-text"><b>经营现金流转正，但主要来自应付账款拉长。</b>同比多出的 4.1 亿里，约 70% 是推迟付款带来的，投资活动仍在大额流出，下一季度要关注账期能否持续。</div>
      <svg class="chart" viewBox="0 0 320 110" aria-hidden="true">
        <line x1="0" y1="80" x2="320" y2="80" stroke="rgba(255,255,255,.12)"/>
        <rect x="24" y="52" width="34" height="28" rx="3" fill="#6f6e69"/><rect x="64" y="40" width="34" height="40" rx="3" fill="#d07b52"/>
        <rect x="134" y="80" width="34" height="18" rx="3" fill="#6f6e69"/><rect x="174" y="80" width="34" height="26" rx="3" fill="#d07b52"/>
        <rect x="244" y="62" width="34" height="18" rx="3" fill="#6f6e69"/><rect x="284" y="30" width="34" height="50" rx="3" fill="#d07b52"/>
        <text x="40" y="104" fill="#6f6e69" font-size="10">经营</text><text x="152" y="18" fill="#6f6e69" font-size="10">投资</text><text x="262" y="104" fill="#6f6e69" font-size="10">应付</text>
      </svg>
    </div>`,
  model3d: () => `
    <div class="result-card">
      <h4>${icon('cube')}desk-lamp.glb<span>已生成 3D 网页预览</span></h4>
      <div class="answer-text"><b>模型和网页都在项目文件夹里：</b>拖动可以旋转，滚轮缩放；需要打印时可以导出 STL。</div>
      <div class="meta-row"><span class="pill ok">${icon('check')}12.4k 面</span><span class="pill">${icon('file')}index.html</span><span class="pill">消耗 8 积分</span></div>
    </div>`,
}

const SCRIPTS = {
  work: [
    { icon: 'slides', label: '整理本周竞品动态，做成 PPT', prompt: '整理本周三家竞品的新功能和价格变化，做成 12 页汇报 PPT', steps: [['search', '联网搜索 18 个来源', '6.2s'], ['file', '阅读官网更新日志和新闻', '21s'], ['layers', '研究员与撰稿人分工整理', '58s'], ['slides', '套用「工作汇报」模板生成 PPT', '1m 40s']], result: 'slides' },
    { icon: 'clock', label: '每个工作日 9 点汇总待办', prompt: '每个工作日早上 9 点，把邮件和日程里的待办按优先级排好发给我', steps: [['clock', '解析时间：每个工作日 09:00', '0.4s'], ['shield', '申请只读访问邮件和日程', '已同意'], ['check', '创建定时任务并试运行一次', '12s']], result: 'cron' },
    { icon: 'cube', label: '做一个可旋转的台灯 3D 模型', prompt: '做一个北欧风台灯的 3D 模型，并生成可以旋转查看的网页', steps: [['cube', '生成 3D 模型', '42s'], ['code', '编写 three.js 预览页', '18s'], ['check', '检查网页能否正常打开', '3s']], result: 'model3d' },
  ],
  code: [
    { icon: 'code', label: '给项目加上手机号登录页', prompt: '给这个项目加一个手机号验证码登录页，写好测试并跑通', steps: [['folder', '读取项目结构 214 个文件', '2.1s'], ['code', '编写 Login.tsx 和 useSendCode', '35s'], ['shield', '修改 3 个文件前请求确认', '已允许'], ['check', '运行测试 24 项', '9.8s']], result: 'diff' },
    { icon: 'search', label: '查一下这个报错的原因', prompt: '构建时报 Cannot find module，帮我查原因并修好', steps: [['search', '搜索代码库和依赖', '1.4s'], ['code', '定位到路径别名配置缺失', '6s'], ['check', '修改 tsconfig 后重新构建', '14s']], result: 'diff' },
  ],
  design: [
    { icon: 'image', label: '做一张新品发布会海报', prompt: '做一张智能台灯新品发布会海报，暖色调，留出标题和日期', steps: [['layers', '选择设计系统「Editorial」', '0.8s'], ['image', '生成主视觉 3 张', '24s'], ['pen', '排版标题、日期和按钮', '9s']], result: 'poster' },
    { icon: 'video', label: '把海报做成 5 秒动态视频', prompt: '用这张海报当首帧，生成 5 秒的光线流动视频', steps: [['image', '上传首帧', '1.2s'], ['video', '生成视频 5 秒 1080P', '48s'], ['check', '保存到资料库', '0.6s']], result: 'video' },
  ],
  chat: [
    { icon: 'file', label: '解读这份财报的现金流', prompt: '这份 Q3 财报的现金流有什么问题？用一张图说明', steps: [['file', '识别 财报.pdf 共 64 页', '7s'], ['search', '定位现金流量表与附注', '3s'], ['chat', '整理结论并画图', '11s']], result: 'chart' },
    { icon: 'search', label: '2026 固态电池进展', prompt: '2026 年固态电池量产到哪一步了？给出处', steps: [['search', '联网搜索与学术论文检索', '9s'], ['file', '阅读 6 篇全文', '26s'], ['chat', '汇总结论并标注来源', '8s']], result: 'research' },
  ],
}

const GREETINGS = { work: '下午好，今天想完成什么？', code: '想在这个项目里做点什么？', design: '想做一张什么样的设计？', chat: '有什么问题，直接问' }

RESULTS.video = () => `
  <div class="result-card">
    <h4>${icon('video')}发布会海报-光线流动.mp4<span>5 秒 · 1080P</span></h4>
    <div class="poster">
      <svg viewBox="0 0 150 188" role="img" aria-label="视频首帧">
        <defs><linearGradient id="vg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2d2420"/><stop offset="1" stop-color="#121212"/></linearGradient></defs>
        <rect width="150" height="188" fill="url(#vg)"/>
        <circle cx="75" cy="78" r="30" fill="#d07b52" opacity=".9"/>
        <path d="M-10 120 C40 90 90 150 160 110" stroke="#e8a37f" stroke-width="2" fill="none" opacity=".7"/>
        <circle cx="75" cy="94" r="20" fill="rgba(0,0,0,.45)"/>
        <path d="M70 85 L84 94 L70 103Z" fill="#ecebe8"/>
      </svg>
      <div class="answer-text"><b>已生成并保存到资料库。</b>首帧沿用海报构图，镜头缓慢推进，光线从左到右扫过标题。
        <div class="meta-row"><span class="pill ok">${icon('check')}用时 48 秒</span><span class="pill">消耗 15 积分</span></div>
      </div>
    </div>
  </div>`

RESULTS.research = () => `
  <div class="result-card">
    <h4>${icon('search')}固态电池量产进展<span>引用 6 个来源</span></h4>
    <div class="answer-text"><b>半固态电池已经批量装车，全固态仍在小批量验证。</b>头部厂商把全固态的量产时间放在 2027 年前后，主要难点是硫化物电解质的界面稳定性和成本 <span class="cite">[1][3][5]</span>。</div>
    <div class="meta-row"><span class="pill">${icon('globe')}网页 4 篇</span><span class="pill">${icon('file')}论文 2 篇</span><span class="pill ok">${icon('check')}每条结论带出处</span></div>
  </div>`

// ─── Demo flow ───────────────────────────────────────────────────────

function setupDemo() {
  const root = document.getElementById('demo')
  if (!root) return
  const chipsBox = root.querySelector('[data-demo-chips]')
  const input = root.querySelector('[data-demo-input]')
  const hello = root.querySelector('[data-demo-hello]')
  const home = root.querySelector('[data-demo-home]')
  const run = root.querySelector('[data-demo-run]')
  const runUser = root.querySelector('[data-run-user]')
  const runSteps = root.querySelector('[data-run-steps]')
  const runResult = root.querySelector('[data-run-result]')
  let mode = 'work'
  let armed = null
  let token = 0

  const renderChips = () => {
    chipsBox.innerHTML = SCRIPTS[mode]
      .map((item, index) => `<button type="button" class="chip" data-chip="${index}">${icon(item.icon)}${escapeHtml(item.label)}</button>`)
      .join('')
  }

  const showHome = () => {
    token += 1
    armed = null
    run.hidden = true
    home.hidden = false
    hello.textContent = GREETINGS[mode]
    input.innerHTML = '<span class="placeholder">点下面任意一个示例，看 STAR 怎么完成它</span>'
    renderChips()
  }

  const typePrompt = async (text, current) => {
    input.textContent = ''
    const caret = document.createElement('span')
    caret.className = 'caret'
    for (let i = 1; i <= text.length; i += 1) {
      if (current !== token) return false
      input.textContent = text.slice(0, i)
      input.appendChild(caret)
      await sleep(18)
    }
    return current === token
  }

  const play = async (item) => {
    const current = ++token
    armed = item
    if (!(await typePrompt(item.prompt, current))) return
    await sleep(380)
    if (current !== token) return
    home.hidden = true
    run.hidden = false
    runUser.textContent = item.prompt
    runSteps.innerHTML = ''
    runResult.innerHTML = ''
    for (const [stepIcon, label, time] of item.steps) {
      if (current !== token) return
      const li = document.createElement('li')
      li.className = 'busy'
      li.innerHTML = `${icon(stepIcon)}<span>${escapeHtml(label)}</span><em>进行中</em>`
      runSteps.appendChild(li)
      await sleep(700 + Math.random() * 500)
      if (current !== token) return
      li.className = 'done'
      li.querySelector('em').textContent = time
    }
    await sleep(260)
    if (current === token) runResult.innerHTML = RESULTS[item.result]()
  }

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    const tab = target?.closest('[data-mode-tab]')
    if (tab) {
      mode = tab.getAttribute('data-mode-tab')
      root.dataset.mode = mode
      root.querySelectorAll('[data-mode-tab]').forEach((el) => el.setAttribute('aria-selected', String(el === tab)))
      showHome()
      return
    }
    const chip = target?.closest('[data-chip]')
    if (chip) {
      void play(SCRIPTS[mode][Number(chip.getAttribute('data-chip'))])
      return
    }
    if (target?.closest('[data-demo-send]')) {
      void play(armed ?? SCRIPTS[mode][0])
      return
    }
    if (target?.closest('[data-demo-reset]')) showHome()
  })

  showHome()
}

/** Connects the agent cards to STAR and STAR to the output files, measured from the layout. */
function setupFlow() {
  const panel = document.querySelector('.panel.agents')
  const svg = panel?.querySelector('.flow')
  const path = svg?.querySelector('path')
  const hub = panel?.querySelector('.hub')
  if (!panel || !svg || !path || !hub) return
  const draw = () => {
    const box = panel.getBoundingClientRect()
    if (!box.width) return
    svg.setAttribute('viewBox', `0 0 ${box.width.toFixed(1)} ${box.height.toFixed(1)}`)
    const h = hub.getBoundingClientRect()
    const hubLeft = h.left - box.left
    const hubRight = h.right - box.left
    const hubY = h.top - box.top + h.height / 2
    const curve = (x1, y1, x2, y2) => {
      const mid = (x1 + x2) / 2
      return `M${x1.toFixed(1)} ${y1.toFixed(1)} C${mid.toFixed(1)} ${y1.toFixed(1)} ${mid.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`
    }
    const parts = []
    panel.querySelectorAll('.agent:not(.hub)').forEach((node) => {
      const r = node.getBoundingClientRect()
      parts.push(curve(r.right - box.left, r.top - box.top + r.height / 2, hubLeft, hubY))
    })
    panel.querySelectorAll('.outputs span').forEach((node) => {
      const r = node.getBoundingClientRect()
      parts.push(curve(hubRight, hubY, r.left - box.left, r.top - box.top + r.height / 2))
    })
    path.setAttribute('d', parts.join(' '))
  }
  draw()
  window.addEventListener('resize', draw)
  document.fonts?.ready.then(draw)
}

setupLinks()
setupNav()
setupReveal()
setupStars()
setupDemo()
setupFlow()
