(() => {
  'use strict';

  const origin = location.origin;
  const current = new URL(location.href);
  const stage = current.searchParams.get('stg');
  const centerPath = '/jjfz/lesson';
  const videoPath = '/jjfz/lesson/video';
  const playerPath = '/jjfz/play';
  const legacyPlayerPath = '/jjfz/lesson/play';
  const catalogKey = 'uestc-course-helper:catalog-stage';
  const cursorKey = 'uestc-course-helper:catalog-source';
  const enabledKey = 'uestc-course-helper:enabled';
  const path = url => url.pathname.replace(/\/$/, '');
  const listPaths = ['/jjfz/lesson/lecture', videoPath, '/jjfz/lesson/read', '/jjfz/lesson/resources'];
  if (!stage || ![centerPath, ...listPaths, playerPath].includes(path(current))) return;

  function urlFor(target, lessonId) {
    const url = new URL(target, origin);
    if (lessonId) url.searchParams.set('lesson_id', lessonId);
    url.searchParams.set('stg', stage);
    return url;
  }

  function links(page, base, target) {
    const matches = [];
    for (const anchor of page.querySelectorAll('a[href]')) {
      const href = new URL(anchor.getAttribute('href'), base);
      if (href.origin === origin && target.includes(path(href)) && href.searchParams.get('stg') === stage) {
        matches.push({ href, label: anchor.textContent.trim(), anchor });
      }
    }
    return matches;
  }

  async function load(url, signal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error('课程目录加载失败，请重试。');
    const loaded = new URL(response.url);
    if (loaded.origin !== origin || path(loaded) !== path(url) ||
        ['stg', 'lesson_id', 'page'].some(key => loaded.searchParams.get(key) !== url.searchParams.get(key))) {
      throw new Error('课程目录地址已变更，请确认登录状态。');
    }
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  function nextPage(page, url) {
    const lessonId = url.searchParams.get('lesson_id');
    const index = Number(url.searchParams.get('page') ?? 1);
    return links(page, url, [path(url)]).find(({ href, label }) =>
      label === '下一页' && href.searchParams.get('lesson_id') === lessonId &&
      Number(href.searchParams.get('page')) === index + 1)?.href;
  }

  function groupKey(url) {
    return JSON.stringify([url.searchParams.get('r'), url.searchParams.get('v_id')]);
  }

  function videoGroups(page, url) {
    const groups = new Map();
    for (const { href, label, anchor } of links(page, url, [playerPath, legacyPlayerPath])) {
      if (!href.searchParams.get('v_id') || !href.searchParams.get('r')) continue;
      if (path(href) === legacyPlayerPath) href.pathname = playerPath;
      const key = groupKey(href);
      const item = groups.get(key) ?? { key, directory: url.href, episodes: new Map() };
      const card = anchor.closest('.lesson1_lists > ul > li');
      if ([...(card?.querySelectorAll('.r_read') ?? [])].some(badge =>
        badge.textContent.replace(/\s/gu, '') === '必修')) item.required = true;
      if ([...(card?.querySelectorAll('.o_read') ?? [])].some(badge =>
        badge.textContent.replace(/\s/gu, '') === '选修')) item.optional = true;
      if (label === '完成' || label === '已完成') item.completed = true;
      const episode = href.searchParams.get('r_id');
      if (episode) item.episodes.set(episode,
        item.episodes.get(episode) === true || anchor.classList.contains('dd_cut_on'));
      const previous = item.href?.searchParams;
      if (!previous || (previous.has('r_id') && !href.searchParams.has('r_id')) ||
          (previous.has('r_id') === href.searchParams.has('r_id') && !previous.has('pg') && href.searchParams.has('pg'))) {
        item.href = href;
      }
      groups.set(key, item);
    }
    return [...groups.values()];
  }

  async function nextInLesson(first, afterGroup, signal, initialPage) {
    if (path(first) === '/jjfz/lesson/resources') return null;
    const lessonId = first.searchParams.get('lesson_id');
    const pages = [first, ...listPaths.slice(listPaths.indexOf(path(first)) + 1).map(section => urlFor(section, lessonId))]
      .filter(url => path(url) !== '/jjfz/lesson/resources');

    for (let url of pages) {
      while (url) {
        const page = initialPage ?? await load(url, signal);
        initialPage = null;
        const groups = videoGroups(page, url);
        const start = afterGroup ? groups.findIndex(group => group.key === afterGroup) + 1 : 0;
        if (afterGroup && !start) throw new Error('目录中找不到当前视频，请从课件列表重新开始。');
        afterGroup = null;
        const next = groups.slice(start).find(group => group.required && !group.optional && !group.completed &&
          !(group.episodes.size && [...group.episodes.values()].every(Boolean)));
        if (next) return next;
        url = nextPage(page, url);
      }
    }
    return null;
  }

  async function nextInCenter(afterLesson, signal, initialPage) {
    let url = urlFor(centerPath);
    let found = !afterLesson;
    const visited = new Set();
    while (url) {
      const page = initialPage ?? await load(url, signal);
      initialPage = null;
      for (const { href } of links(page, url, [videoPath])) {
        const id = href.searchParams.get('lesson_id');
        if (!id || visited.has(id)) continue;
        visited.add(id);
        if (!found) {
          found = id === afterLesson;
          continue;
        }
        const next = await nextInLesson(urlFor(listPaths[0], id), null, signal);
        if (next) return next;
      }
      url = nextPage(page, url);
    }
    if (!found) throw new Error('课程中心找不到当前课程，请检查当前目录。');
    return null;
  }

  function setEnabled(active) {
    if (active) sessionStorage.setItem(catalogKey, stage);
    else {
      sessionStorage.removeItem(catalogKey);
      sessionStorage.removeItem(cursorKey);
    }
  }

  function open(next) {
    sessionStorage.setItem(cursorKey, JSON.stringify({ key: next.key, directory: next.directory }));
    location.assign(next.href.href);
  }

  function playedDirectory() {
    const saved = sessionStorage.getItem(cursorKey);
    if (saved) {
      try {
        const cursor = JSON.parse(saved);
        const directory = new URL(cursor.directory);
        if (cursor.key === groupKey(current) && directory.origin === origin &&
            listPaths.includes(path(directory)) && directory.searchParams.get('stg') === stage &&
            directory.searchParams.has('lesson_id')) return directory;
      } catch {
        sessionStorage.removeItem(cursorKey);
      }
    }
    return links(document, current, listPaths).find(({ href, label }) =>
      href.searchParams.has('lesson_id') && label.includes('返回'))?.href;
  }

  async function nextAfterPlayer(signal) {
    const parent = playedDirectory();
    if (!parent || !current.searchParams.get('v_id')) throw new Error('找不到这一视频对应的课件列表。');

    const next = await nextInLesson(parent, groupKey(current), signal);
    return next ?? nextInCenter(parent.searchParams.get('lesson_id'), signal);
  }

  async function inspectPlayer(signal) {
    const parent = playedDirectory();
    if (!parent) throw new Error('找不到课件目录，无法核对选修和分集完成状态。');
    if (path(parent) === '/jjfz/lesson/resources') {
      return { optional: true, excludedSection: true, completed: false, completedEpisodes: [] };
    }
    const page = await load(parent, signal);
    const group = videoGroups(page, parent).find(item => item.key === groupKey(current));
    if (!group) throw new Error('目录中找不到当前视频，请从课件列表重新开始。');
    return {
      optional: Boolean(group.optional) || !group.required,
      completed: Boolean(group.completed),
      completedEpisodes: [...group.episodes].filter(([, done]) => done).map(([id]) => id),
    };
  }

  globalThis.uestcCourseCatalog = {
    isEnabled: () => sessionStorage.getItem(catalogKey) === stage,
    setEnabled,
    nextAfterPlayer,
    inspectPlayer,
    open,
  };
  if (path(current) === playerPath) return;

  const panel = document.createElement('aside');
  const shadow = panel.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; }
    section { box-sizing: border-box; width: 248px; max-width: calc(100vw - 36px); padding: 14px;
      background: #10243d; color: #fff; border: 1px solid #324b68; border-radius: 12px;
      box-shadow: 0 4px 18px #13294044; font: 14px/1.5 system-ui, "Microsoft YaHei", sans-serif; }
    button { border: 0; border-radius: 6px; padding: 5px 10px; background: #d7eaff;
      color: #10243d; font: inherit; cursor: pointer; }
    button:focus-visible { outline: 2px solid white; outline-offset: 3px; }
    p { margin: 8px 0 0; color: #c6d7ec; font-size: 12px; }
  `;
  const box = document.createElement('section');
  const start = document.createElement('button');
  start.type = 'button';
  start.textContent = '全课程连播';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = '从当前目录开始，跳过选修和已完成的视频。';
  box.append(start, status);
  shadow.append(style, box);
  document.documentElement.append(panel);

  let lookup = null;
  start.addEventListener('click', async () => {
    if (lookup) {
      lookup.abort();
      lookup = null;
      start.textContent = '全课程连播';
      status.textContent = '已取消查找视频。';
      return;
    }
    const controller = new AbortController();
    lookup = controller;
    start.textContent = '取消';
    status.textContent = '正在查找可播放的视频…';
    try {
      const { signal } = controller;
      const next = path(current) === centerPath
        ? await nextInCenter(null, signal, document)
        : await nextInLesson(current, null, signal, document) ??
          await nextInCenter(current.searchParams.get('lesson_id'), signal);
      if (signal.aborted) return;
      if (next) {
        setEnabled(true);
        sessionStorage.setItem(enabledKey, '1');
        open(next);
      } else {
        status.textContent = '后面的课程中没有找到待播放的视频。';
      }
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = error.message;
    } finally {
      if (lookup === controller) {
        lookup = null;
        start.textContent = '全课程连播';
      }
    }
  });
})();
