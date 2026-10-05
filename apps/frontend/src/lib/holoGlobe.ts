/**
 * 全息地球的 canvas 绘制核心（d3-geo 正射投影），从原型 prototypes/globe/src/globe.js 搬来，只留 holo 皮肤。
 * 只在浏览器里由 components/HoloGlobe.client.vue 动态 import；SSR 不碰这里。
 *
 * 外面只给场景（lib/globeScene.ts）和锁定 / 悬停的国家，收回指针悬停与点击锁定；
 * 绘制、拾取、旋转、缩放都在这里。换 three.js 渲染器时整个替换这个文件与那个组件。
 */
import { geoContains, geoDistance, geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import type { GeoPermissibleObjects } from 'd3-geo';
import { easeCubicInOut } from 'd3-ease';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Country } from '~/lib/briefMap';
import type { GlobeScene } from '~/lib/globeScene';

export interface HoloGlobeOptions {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  countries: Record<string, Country>;
  world: Topology;
  /** 指针悬停的国家变了（x、y 是相对 stage 的坐标，给悬停提示定位）；拖动时不报 */
  onHover: (key: string | null, x: number, y: number) => void;
  /** 点了一个国家（或空白处 → null） */
  onLock: (key: string | null) => void;
}

// 配色只有一处来源：layouts/holo.vue 里 html[data-skin='holo'] 的 CSS 变量，建地球时读一次。
// canvas 吃不了 var()，所以读成字符串；球体渐变与扫描线的半透明色是派生色，留在下面的绘制代码里。
function readColors(el: Element) {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(`--${name}`).trim();
  return {
    ink: v('ink'),
    land: v('land'),
    landHi: v('land-hi'),
    coast: v('coast'),
    border: v('border'),
    grat: v('grat'),
    mk: v('mk'),
    probe: v('probe'),
    lock: v('lock'),
    link: v('link'),
    heat: v('heat'),
    font: v('mono'),
  };
}

export function createHoloGlobe({ stage, canvas, countries, world, onHover, onLock }: HoloGlobeOptions) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLORS = readColors(stage);
  const objects = world.objects as Record<string, GeometryCollection>;
  const land = feature(world, objects.land);
  const countriesGeo = feature(world, objects.countries).features;
  const borders = mesh(world, objects.countries, (a, b) => a !== b);
  const graticule = geoGraticule10();
  const atlasToKey = new Map(Object.entries(countries).flatMap(([k, c]) => (c.atlas ? [[c.atlas, k] as const] : [])));
  const geoByKey = new Map(
    countriesGeo.flatMap(f => {
      const key = atlasToKey.get((f.properties as { name: string }).name);
      return key ? [[key, f] as const] : [];
    })
  );

  const state = {
    scene: { dots: [], links: [], shaded: null } as GlobeScene,
    locked: null as string | null,
    hover: null as string | null,
    rot: [-15, -28, 0] as [number, number, number],
    k: 1,
    spin: !reduceMotion,
  };

  const ctx = canvas.getContext('2d')!;
  const proj = geoOrthographic().clipAngle(90).precision(0.4);
  const back = geoOrthographic().clipAngle(90).precision(0.6).reflectX(true);
  const path = geoPath(proj, ctx);
  const backPath = geoPath(back, ctx);
  let W = 0;
  let H = 0;
  let R0 = 0;
  let dpr = 1;
  let drawn: { key: string; x: number; y: number; r: number }[] = [];

  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    R0 = (Math.min(W, H) / 2) * 0.86;
  }

  const stroke = (obj: GeoPermissibleObjects, p = path) => {
    ctx.beginPath();
    p(obj);
  };

  // 球边发光（shadowBlur 18）每帧重算约占一帧的 15%，而它只随尺寸和缩放变：画一次存起来，之后每帧贴图。
  // 缓存只取球边外扩 RIM_PAD 与视口的交集，放大到球比视口还大时也不超过画布本身
  const RIM_PAD = 40;
  let rim: { key: string; img: HTMLCanvasElement; x: number; y: number } | null = null;
  function drawRim(R: number) {
    const x0 = Math.max(0, Math.floor(W / 2 - R - RIM_PAD));
    const y0 = Math.max(0, Math.floor(H / 2 - R - RIM_PAD));
    const x1 = Math.min(W, Math.ceil(W / 2 + R + RIM_PAD));
    const y1 = Math.min(H, Math.ceil(H / 2 + R + RIM_PAD));
    if (x1 <= x0 || y1 <= y0) return;
    const key = `${W}x${H}x${R}x${dpr}`;
    if (rim?.key !== key) {
      const img = rim?.img ?? document.createElement('canvas');
      img.width = Math.round((x1 - x0) * dpr);
      img.height = Math.round((y1 - y0) * dpr);
      const c = img.getContext('2d')!;
      c.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
      c.beginPath();
      c.arc(W / 2, H / 2, R, 0, Math.PI * 2);
      c.strokeStyle = COLORS.border;
      c.lineWidth = 1.2;
      c.shadowColor = COLORS.coast;
      c.shadowBlur = 18; // 与主画布同口径：shadowBlur 不随变换缩放，两边都是设备像素
      c.stroke();
      rim = { key, img, x: x0, y: y0 };
    }
    ctx.drawImage(rim.img, rim.x, rim.y, rim.img.width / dpr, rim.img.height / dpr);
  }

  function draw(time: number) {
    const R = R0 * state.k;
    proj.scale(R).translate([W / 2, H / 2]).rotate(state.rot);
    back.scale(R).translate([W / 2, H / 2]).rotate([state.rot[0] + 180, -state.rot[1], -state.rot[2]]);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    stroke({ type: 'Sphere' });
    const g = ctx.createRadialGradient(W / 2, H / 2, R * 0.2, W / 2, H / 2, R * 1.08);
    g.addColorStop(0, 'rgba(14, 60, 82, 0.35)');
    g.addColorStop(0.9, 'rgba(8, 36, 52, 0.55)');
    g.addColorStop(1, 'rgba(95, 212, 255, 0.25)');
    ctx.fillStyle = g;
    ctx.fill();

    // 透过球体看到背面的经纬网和海岸线
    ctx.globalAlpha = 0.28;
    stroke(graticule, backPath);
    ctx.strokeStyle = COLORS.grat;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    stroke(land, backPath);
    ctx.strokeStyle = COLORS.coast;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;

    stroke(graticule);
    ctx.strokeStyle = COLORS.grat;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    stroke(land);
    ctx.fillStyle = COLORS.land;
    ctx.fill();

    const { shaded } = state.scene;
    if (shaded) {
      ctx.fillStyle = COLORS.heat;
      for (const [key, v] of shaded) {
        const f = geoByKey.get(key);
        if (!f) continue;
        stroke(f);
        ctx.globalAlpha = 0.08 + v * 0.32;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    for (const [key, alpha] of [
      [state.hover, 0.6],
      [state.locked, 1],
    ] as const) {
      const f = key && geoByKey.get(key);
      if (!f) continue;
      stroke(f);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COLORS.landHi;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    stroke(borders);
    ctx.strokeStyle = COLORS.coast;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    stroke(land);
    ctx.strokeStyle = COLORS.coast;
    ctx.lineWidth = 1;
    ctx.shadowColor = COLORS.coast;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    drawRim(R);

    // 自北向南的扫描线
    if (!reduceMotion) {
      const y = H / 2 - R + ((time / 60) % (2 * R));
      const half = Math.sqrt(Math.max(0, R * R - (y - H / 2) ** 2));
      const sg = ctx.createLinearGradient(0, y - 14, 0, y);
      sg.addColorStop(0, 'rgba(125,255,176,0)');
      sg.addColorStop(1, 'rgba(125,255,176,0.18)');
      ctx.fillStyle = sg;
      ctx.fillRect(W / 2 - half, y - 14, half * 2, 14);
    }

    drawLinks();
    drawDots(time);
  }

  function drawLinks() {
    for (const l of [...state.scene.links].sort((x, y) => Number(x.focus) - Number(y.focus))) {
      const a = countries[l.a];
      const b = countries[l.b];
      if (!a || !b) continue;
      stroke({ type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] });
      const spread = l.kind === 'spread';
      // 先垫一道深色底，线压在青色海岸线和国家底色上也分得出来
      ctx.strokeStyle = 'rgba(4,9,14,0.75)';
      ctx.lineWidth = 4;
      ctx.stroke();
      // 原先用青色（和海岸线同色，看不清）；锁定时的琥珀色不变
      ctx.strokeStyle = l.focus ? COLORS.lock : COLORS.link;
      ctx.globalAlpha = l.focus ? 0.95 : spread ? 0.75 : 0.9;
      ctx.lineWidth = l.focus ? 1.8 : 1.5;
      ctx.setLineDash(l.focus ? [] : spread ? [6, 4] : [5, 3]);
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = l.focus ? 8 : 4;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  function drawDots(time: number) {
    const center = proj.invert!([W / 2, H / 2])!;
    drawn = [];
    const labels: { text: string; x: number; y: number; rank: number; color: string; bold: boolean }[] = [];
    for (const m of state.scene.dots) {
      const c = countries[m.key];
      if (!c) continue;
      const ll: [number, number] = [c.lon, c.lat];
      if (geoDistance(ll, center) > Math.PI / 2 - 0.03) continue;
      const [x, y] = proj(ll)!;
      const r = m.r * Math.sqrt(state.k);
      drawn.push({ key: m.key, x, y, r });
      const isLock = state.locked === m.key;
      const isHover = state.hover === m.key;
      const faded = m.fade && !isLock && !isHover;
      ctx.globalAlpha = faded ? 0.18 : 1;
      const col = isLock ? COLORS.lock : isHover ? COLORS.probe : m.hollow ? COLORS.link : COLORS.mk;

      if (m.pulse && !faded) {
        const phase = reduceMotion ? 0.5 : (time % 2200) / 2200;
        ctx.beginPath();
        ctx.arc(x, y, r + 3 + phase * 12, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.lock;
        ctx.globalAlpha = reduceMotion ? 0.6 : 0.8 * (1 - phase);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      // 连线终点：只描边不填充，和有故事的点分开
      if (!m.hollow) {
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.55 * (faded ? 0.2 : 1);
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = faded ? 0.18 : 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = isLock ? 2 : 1.3;
      ctx.stroke();
      if (isLock) {
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (!faded) {
        // 锁定 > 悬停 > 点大（故事多）> 头条脉动
        const rank = (isLock ? 1e6 : 0) + (isHover ? 1e5 : 0) + m.r * 10 + (m.pulse ? 1 : 0);
        labels.push({ text: m.label, x: x + r + 5, y, rank, color: isLock ? COLORS.lock : isHover ? COLORS.probe : COLORS.ink, bold: isLock });
      }
      ctx.globalAlpha = 1;
    }
    drawLabels(labels);
  }

  /** 点画完再画标签：按优先级放，和已放下的标签相交的就不画（欧洲这类密集区原先「UK 3」压着「Germany 1」）。点本身照画，悬停能看到 */
  function drawLabels(labels: { text: string; x: number; y: number; rank: number; color: string; bold: boolean }[]) {
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of labels.sort((a, b) => b.rank - a.rank)) {
      ctx.font = `${l.bold ? 600 : 500} 11px ${COLORS.font}`;
      const box = { x0: l.x - 2, y0: l.y - 8, x1: l.x + ctx.measureText(l.text).width + 2, y1: l.y + 8 };
      if (placed.some(p => box.x0 < p.x1 && p.x0 < box.x1 && box.y0 < p.y1 && p.y0 < box.y1)) continue;
      placed.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(4,9,14,0.85)';
      ctx.strokeText(l.text, l.x, l.y);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.x, l.y);
    }
  }

  // ── 交互 ──────────────────────────────────────────────────
  function pick(x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const m of drawn) {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d <= Math.max(m.r + 6, 12) && d < bestD) {
        best = m.key;
        bestD = d;
      }
    }
    if (best) return best;
    const ll = proj.invert!([x, y]);
    const center = proj.invert!([W / 2, H / 2])!;
    if (!ll || geoDistance(ll, center) > Math.PI / 2) return null;
    // 有点的国家，或开着底色时有报道的国家，才能点
    const { dots, shaded } = state.scene;
    for (const [key, f] of geoByKey) {
      if ((dots.some(d => d.key === key) || shaded?.has(key)) && geoContains(f, ll)) return key;
    }
    return null;
  }

  function hoverAt(key: string | null, x: number, y: number) {
    if (state.hover === key) return;
    state.hover = key;
    onHover(key, x, y);
  }

  let down: { x: number; y: number; rot: [number, number, number]; moved: boolean } | null = null;
  let animating: { from: number[]; to: number[]; t0: number; dur: number } | null = null;
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  function onPointerDown(e: PointerEvent) {
    lastInput = performance.now();
    canvas.setPointerCapture?.(e.pointerId);
    down = { x: e.clientX, y: e.clientY, rot: [...state.rot], moved: false };
    state.spin = false;
    animating = null;
  }
  function onPointerMove(e: PointerEvent) {
    lastInput = performance.now();
    const [x, y] = local(e);
    if (down) {
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 4) {
        down.moved = true;
        canvas.classList.add('dragging');
        hoverAt(null, x, y);
      }
      if (down.moved) {
        const s = 75 / (R0 * state.k);
        state.rot = [down.rot[0] + dx * s, Math.max(-85, Math.min(85, down.rot[1] - dy * s)), 0];
        return;
      }
    }
    const key = pick(x, y);
    canvas.classList.toggle('pointing', !!key);
    if (state.hover !== key) hoverAt(key, x, y);
    else if (key) onHover(key, x, y); // 同一国家内移动：提示跟着指针走
  }
  function onPointerUp(e: PointerEvent) {
    canvas.classList.remove('dragging');
    if (down && !down.moved) onLock(pick(...local(e)));
    down = null;
  }
  // 触屏上手势被系统接管（滚动、多指）时只有 pointercancel、没有 pointerup：不复位的话下次移动还当成在拖
  function onPointerCancel() {
    canvas.classList.remove('dragging');
    down = null;
  }
  function onPointerLeave(e: PointerEvent) {
    if (!down) hoverAt(null, ...local(e));
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    zoomTo(state.k * Math.exp(-e.deltaY * 0.0015));
  }
  function zoomTo(k: number) {
    lastInput = performance.now();
    state.k = Math.max(0.85, Math.min(5, k));
  }

  function rotateTo(key: string) {
    const c = countries[key];
    if (!c) return;
    const from = [...state.rot];
    let dl = (-c.lon - from[0]) % 360;
    if (dl > 180) dl -= 360;
    if (dl < -180) dl += 360;
    const to = [from[0] + dl, Math.max(-60, Math.min(60, -c.lat)), 0];
    if (reduceMotion) {
      state.rot = to as [number, number, number];
      return;
    }
    animating = { from, to, t0: performance.now(), dur: 900 };
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('lostpointercapture', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  // 省电：没人操作时只剩慢速自转、扫描线与脉动圈，限到约 30 帧（120Hz 屏上原先每秒画 120 次整张地图）；
  // 拖动、缩放、转到某国、悬停与场景变化后的一小段时间照常每帧画，手感不变。阈值留 4ms 余量，60Hz 与 120Hz 都落在整 30 帧
  const IDLE_FRAME_MS = 1000 / 30 - 4;
  const ACTIVE_MS = 600;
  let lastInput = -Infinity;
  let lastDraw = -Infinity;
  let last = performance.now();
  let raf = 0;
  function frame(now: number) {
    const dt = Math.min(64, now - last);
    last = now;
    if (animating) {
      const p = Math.min(1, (now - animating.t0) / animating.dur);
      const e = easeCubicInOut(p);
      state.rot = animating.from.map((v, i) => v + (animating!.to[i] - v) * e) as [number, number, number];
      if (p >= 1) animating = null;
    } else if (state.spin && !state.hover) {
      state.rot = [state.rot[0] + dt * 0.006, state.rot[1], 0];
    }
    const active = down || animating || now - lastInput < ACTIVE_MS;
    if (active || now - lastDraw >= IDLE_FRAME_MS) {
      draw(now);
      lastDraw = now;
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // 省电：地球滚出视口就停掉循环，回来再接上（标签页隐藏时浏览器本来就停 requestAnimationFrame）
  const io = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  });
  io.observe(stage);

  return {
    setScene(scene: GlobeScene) {
      state.scene = scene;
      lastInput = performance.now();
    },
    /** 锁定（含面板卡片按 Enter 锁的）一律转到正中，并停掉自转 */
    setLocked(key: string | null) {
      if (state.locked === key) return;
      state.locked = key;
      lastInput = performance.now();
      state.spin = false;
      if (key) rotateTo(key);
    },
    /** 面板卡片悬停时点亮对应国家；不触发 onHover */
    setHover(key: string | null) {
      state.hover = key;
      lastInput = performance.now();
    },
    zoomBy(f: number) {
      zoomTo(state.k * f);
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('lostpointercapture', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}

export type HoloGlobe = ReturnType<typeof createHoloGlobe>;
