/**
 * 全息地球的 canvas 绘制核心（d3-geo 正射投影），从原型 prototypes/globe/src/globe.js 搬来，只留 holo 皮肤。
 * 只在浏览器里由 components/HoloGlobe.client.vue 动态 import；SSR 不碰这里。
 *
 * 外面只给场景（点、连线、国家底色）和锁定 / 悬停的国家，收回指针悬停与点击锁定；
 * 绘制、拾取、旋转、缩放、配色都在这里。换 three.js 渲染器时整个替换这个文件与那个组件。
 */
import { geoContains, geoDistance, geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import type { GeoPermissibleObjects } from 'd3-geo';
import { easeCubicInOut } from 'd3-ease';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Country } from '~/lib/briefMap';

export interface GlobeDot {
  key: string;
  /** 缩放为 1 时的半径 */
  r: number;
  /** 头条所在国：外圈脉动 */
  pulse: boolean;
  label: string;
  /** 不在当前主题筛选里：淡出 */
  fade: boolean;
}

export interface GlobeLink {
  a: string;
  b: string;
  /** second = 主国家到第二国家；spread = 没有主国家时占比 ≥10% 的国家两两相连 */
  kind: 'second' | 'spread';
  /** 牵涉锁定国家的连线：实线高亮 */
  focus: boolean;
}

export interface GlobeScene {
  dots: GlobeDot[];
  links: GlobeLink[];
  /** 国家 → 0..1 的底色深浅；null = 关掉底色 */
  shaded: Map<string, number> | null;
}

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

// 全息皮肤：颜色只表示状态——青 = 基础，绿 = 探测中，琥珀 = 已锁定
const COLORS = {
  ink: '#cdefff',
  land: 'rgba(70, 190, 230, 0.10)',
  landHi: 'rgba(255, 179, 71, 0.22)',
  coast: '#5fd4ff',
  border: '#2d8fb5',
  grat: 'rgba(95, 212, 255, 0.13)',
  mk: '#5fd4ff',
  probe: '#7dffb0',
  lock: '#ffb347',
  heat: '#5fd4ff',
};
const FONT = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace";

export function createHoloGlobe({ stage, canvas, countries, world, onHover, onLock }: HoloGlobeOptions) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
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

    stroke({ type: 'Sphere' });
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = COLORS.coast;
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;

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
      ctx.strokeStyle = l.focus ? COLORS.lock : spread ? COLORS.probe : COLORS.mk;
      ctx.globalAlpha = l.focus ? 0.9 : spread ? 0.55 : 0.3;
      ctx.lineWidth = l.focus ? 1.8 : spread ? 1.3 : 1;
      ctx.setLineDash(l.focus ? [] : spread ? [6, 4] : [3, 3]);
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
      const col = isLock ? COLORS.lock : isHover ? COLORS.probe : COLORS.mk;

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
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.55 * (faded ? 0.2 : 1);
      ctx.shadowColor = col;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
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
        ctx.font = `${isLock ? 600 : 500} 11px ${FONT}`;
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(4,9,14,0.85)';
        ctx.lineJoin = 'round';
        ctx.strokeText(m.label, x + r + 5, y);
        ctx.fillStyle = isLock ? COLORS.lock : isHover ? COLORS.probe : COLORS.ink;
        ctx.fillText(m.label, x + r + 5, y);
      }
      ctx.globalAlpha = 1;
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
    canvas.setPointerCapture?.(e.pointerId);
    down = { x: e.clientX, y: e.clientY, rot: [...state.rot], moved: false };
    state.spin = false;
    animating = null;
  }
  function onPointerMove(e: PointerEvent) {
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
  function onPointerLeave(e: PointerEvent) {
    if (!down) hoverAt(null, ...local(e));
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    zoomTo(state.k * Math.exp(-e.deltaY * 0.0015));
  }
  function zoomTo(k: number) {
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
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

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
    draw(now);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    setScene(scene: GlobeScene) {
      state.scene = scene;
    },
    /** 锁定（含面板卡片按 Enter 锁的）一律转到正中，并停掉自转 */
    setLocked(key: string | null) {
      if (state.locked === key) return;
      state.locked = key;
      state.spin = false;
      if (key) rotateTo(key);
    },
    /** 面板卡片悬停时点亮对应国家；不触发 onHover */
    setHover(key: string | null) {
      state.hover = key;
    },
    zoomBy(f: number) {
      zoomTo(state.k * f);
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}

export type HoloGlobe = ReturnType<typeof createHoloGlobe>;
