(() => {
  'use strict';

  const playPath = '/jjfz/play';
  if (location.pathname.replace(/\/$/, '') !== playPath) return;

  const sessionKey = 'uestc-course-helper:enabled';
  const rateKey = 'uestc-course-helper:playback-rate';
  const rates = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8];
  const catalog = globalThis.uestcCourseCatalog;
  const savedRate = Number(sessionStorage.getItem(rateKey));
  let enabled = sessionStorage.getItem(sessionKey) === '1';
  let playbackRate = rates.includes(savedRate) ? savedRate : 1;
  let rateVideo = null;
  let lesson = null;

  const panel = document.createElement('div');
  const shadow = panel.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; }
    section { box-sizing: border-box; width: 248px; max-width: calc(100vw - 36px);
      padding: 14px; background: #10243d; color: #fff; border: 1px solid #324b68;
      border-radius: 12px; box-shadow: 0 4px 18px #13294044;
      font: 14px/1.5 system-ui, "Microsoft YaHei", sans-serif; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    button { border: 0; border-radius: 6px; padding: 4px 10px; background: #d7eaff;
      color: #10243d; font: inherit; cursor: pointer; }
    button:focus-visible, select:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
    label { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
    select { border: 1px solid #65819e; border-radius: 6px; padding: 3px 6px;
      background: #10243d; color: #fff; font: inherit; }
    p { margin: 8px 0 0; color: #c6d7ec; font-size: 12px; }
    .catalog { width: 100%; margin-top: 10px; }
  `;
  const box = document.createElement('section');
  const heading = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = '课程续播助手';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  const rateLabel = document.createElement('label');
  const rateSelect = document.createElement('select');
  for (const rate of rates) {
    const option = document.createElement('option');
    option.value = String(rate);
    option.textContent = `${rate}×`;
    rateSelect.append(option);
  }
  rateSelect.value = String(playbackRate);
  rateLabel.append('播放倍速', rateSelect);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  heading.append(title, toggle);
  box.append(heading, rateLabel, status);
  let catalogButton;
  if (catalog) {
    catalogButton = document.createElement('button');
    catalogButton.className = 'catalog';
    catalogButton.type = 'button';
    box.append(catalogButton);
  }
  shadow.append(style, box);
  document.documentElement.append(panel);

  const completionObserver = new MutationObserver(() => {
    if (enabled && lesson) advanceAfterConfirmation(lesson);
  });

  function setStatus(message) {
    if (status.textContent !== message) status.textContent = message;
  }

  function available(element) {
    return element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === 'visible' &&
      !element.closest('[hidden], [inert], [aria-disabled="true"], :disabled');
  }

  function lessonLink(anchor) {
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin || url.pathname.replace(/\/$/, '') !== playPath) return null;
    return url.searchParams.get('v_id') && url.searchParams.get('r_id') ? url : null;
  }

  function samePlaylist(url, current) {
    return ['v_id', 'stg', 'r'].every(key => url.searchParams.get(key) === current.searchParams.get(key));
  }

  function playlistState() {
    const current = new URL(location.href);
    const currentEpisode = current.searchParams.get('r_id');
    if (!current.searchParams.get('v_id')) return {};
    const entries = new Map();
    for (const anchor of document.querySelectorAll('.vlist a[href]')) {
      if (!available(anchor)) continue;
      const url = lessonLink(anchor);
      if (!url || !samePlaylist(url, current)) continue;
      const id = url.searchParams.get('r_id');
      const completed = lesson?.catalogState?.completed ||
        lesson?.catalogState?.completedEpisodes.includes(id) || anchor.classList.contains('dd_cut_on');
      const entry = entries.get(id) ?? { url, completed: false };
      entry.completed ||= Boolean(completed);
      entries.set(id, entry);
    }
    const order = [...entries.keys()];
    // The site's group links without r_id open the first episode.
    const currentIndex = currentEpisode ? order.indexOf(currentEpisode) : order.length ? 0 : -1;
    if (currentIndex < 0) return {};
    const remaining = order.slice(currentIndex + 1).map(id => entries.get(id));
    return {
      currentComplete: entries.get(order[currentIndex]).completed,
      next: remaining.find(entry => !entry.completed)?.url ?? null,
    };
  }

  function findNext() {
    return playlistState().next;
  }

  function findResumeButton(title = '继续观看') {
    return [...document.querySelectorAll('button')].find(button => {
      const dialogTitle = button.parentElement?.parentElement?.firstElementChild;
      return button.textContent.trim() === '继续播放' &&
        dialogTitle?.textContent.trim() === title && available(button);
    });
  }

  function advanceAfterConfirmation(current) {
    if (current.advanced || !current.started || !current.video.ended) return;
    const confirmed = [...document.querySelectorAll('.layui-layer-content')].some(element =>
      available(element) && /^当前视频播放完毕[！!]?$/u.test(element.textContent.trim()));
    const canAdvanceAfterGrace = catalog?.isEnabled() || new URL(current.url).searchParams.get('r') === 'resources';
    if (!confirmed && canAdvanceAfterGrace && !current.completionDeadline) {
      current.completionDeadline = Date.now() + 4000;
      setTimeout(() => {
        if (enabled && lesson === current) advanceAfterConfirmation(current);
      }, 4000);
    }
    if (!confirmed && (!canAdvanceAfterGrace || Date.now() < current.completionDeadline)) {
      setStatus('视频已结束，正在等待平台确认…');
      if (!current.waitingForConfirmation) {
        current.waitingForConfirmation = true;
        completionObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
      }
      return;
    }

    advancePlaylist(current);
  }

  function advancePlaylist(current) {
    completionObserver.disconnect();
    const next = findNext();
    current.advanced = true;
    if (next) {
      setStatus('正在打开下一集未完成的视频…');
      location.assign(next.href);
    } else if (next === null && catalog?.isEnabled()) {
      void advanceCatalog(current);
    } else {
      setStatus('当前播放列表没有可识别的下一集待播放视频。');
    }
  }

  async function inspectLesson(current) {
    const controller = new AbortController();
    current.lookup = controller;
    setStatus('正在核对选修和分集完成状态…');
    try {
      const result = await catalog.inspectPlayer(controller.signal);
      if (controller.signal.aborted || lesson !== current || !enabled) return;
      current.catalogState = result;
      current.inspected = true;
      update();
    } catch (error) {
      if (controller.signal.aborted || lesson !== current) return;
      current.inspectionFailed = true;
      catalogButton.disabled = false;
      catalogButton.textContent = '重试状态检查';
      setStatus(error.message);
    } finally {
      if (current.lookup === controller) current.lookup = null;
    }
  }

  async function advanceCatalog(current) {
    const controller = new AbortController();
    current.lookup = controller;
    setStatus('本组已播完，正在查找下一组视频…');
    try {
      const next = await catalog.nextAfterPlayer(controller.signal);
      if (controller.signal.aborted || lesson !== current) return;
      if (next) {
        setStatus('正在打开下一组视频…');
        catalog.open(next);
      } else {
        catalog.setEnabled(false);
        showToggle();
        setStatus('课程中心的后续视频已播完。');
      }
    } catch (error) {
      if (controller.signal.aborted || lesson !== current) return;
      catalogButton.disabled = false;
      catalogButton.textContent = '重试全课程连播';
      setStatus(error.message);
    } finally {
      if (current.lookup === controller) current.lookup = null;
    }
  }

  function scheduleAutoplay(current, delay) {
    current.autoplayAt = Date.now() + delay;
    // A one-shot from the media event also runs when the background polling interval is throttled.
    setTimeout(() => {
      if (lesson === current) update();
    }, delay);
  }

  async function startPlayback(current) {
    const { video } = current;
    current.attempted = true;
    try {
      await video.play();
    } catch (error) {
      if (!enabled || lesson !== current) return;
      if (error.name !== 'NotAllowedError') {
        setStatus('视频暂时无法自动播放，请点击播放器的播放键。');
        return;
      }
      const wasMuted = video.muted;
      video.muted = true;
      try {
        await video.play();
      } catch {
        video.muted = wasMuted;
        if (enabled && lesson === current) setStatus('请点击播放器的播放键来继续。');
      }
    }
  }

  function canRecoverPause(current) {
    const { video } = current;
    return enabled && lesson === current && !current.advanced && video.currentSrc === current.source &&
      video.paused && !video.ended &&
      !findResumeButton('休息一下') && !findResumeButton();
  }

  async function recoverBackgroundPause(current, retryOnReturn) {
    if (!canRecoverPause(current)) return;
    setStatus('检测到后台暂停，正在恢复播放…');
    try {
      await current.video.play();
    } catch (error) {
      if (!canRecoverPause(current)) return;
      if (retryOnReturn && error.name === 'NotAllowedError') {
        if (!document.hidden && document.hasFocus()) {
          void recoverBackgroundPause(current, false);
        } else {
          current.resumeOnReturn = true;
          setStatus('后台播放受限，回到课程页时会再试一次。');
        }
      } else {
        setStatus('视频已暂停，可以在播放器里继续。');
      }
    }
  }

  function onBackgroundChange(isBackground) {
    if (!enabled || !lesson) return;
    if (isBackground) {
      // Capture the transition before the player's visibility listener pauses the media.
      if (!lesson.video.paused && !lesson.video.ended) {
        lesson.backgroundPauseUntil = Date.now() + 1500;
      }
    } else if (!document.hidden && document.hasFocus()) {
      if (!lesson.video.paused) lesson.backgroundPauseUntil = 0;
      if (lesson.resumeOnReturn) {
        lesson.resumeOnReturn = false;
        void recoverBackgroundPause(lesson, false);
      }
    }
  }

  function update(reapplyRate = false) {
    const video = document.querySelector('#player video');
    if (!video || !available(video)) {
      rateVideo = null;
      lesson?.lookup?.abort();
      lesson = null;
      completionObserver.disconnect();
      if (enabled) setStatus('正在等待课程播放器…');
      return;
    }
    if (video !== rateVideo || reapplyRate || enabled) {
      if (video.defaultPlaybackRate !== playbackRate) video.defaultPlaybackRate = playbackRate;
      if (video.playbackRate !== playbackRate) video.playbackRate = playbackRate;
      rateVideo = video;
    }
    if (!enabled) return;
    if (lesson?.video !== video || lesson.url !== location.href || lesson.source !== video.currentSrc) {
      lesson?.lookup?.abort();
      completionObserver.disconnect();
      lesson = {
        video,
        url: location.href,
        source: video.currentSrc,
        attempted: false,
        started: false,
        resumeClicked: false,
        autoplayAt: 0,
        advanced: false,
        waitingForConfirmation: false,
        completionDeadline: 0,
        backgroundConfigured: false,
        backgroundPauseUntil: 0,
        resumeOnReturn: false,
        inspected: !catalog?.inspectPlayer,
        initialCompletionChecked: false,
      };
    }
    if (lesson.advanced || lesson.inspectionFailed) return;
    if (!lesson.inspected) {
      if (!lesson.lookup) void inspectLesson(lesson);
      return;
    }
    if (lesson.catalogState?.optional) {
      lesson.advanced = true;
      if (!video.paused) video.pause();
      if (catalog.isEnabled()) void advanceCatalog(lesson);
      else setStatus('当前课件不在必修播放范围，已跳过。可点全课程连播继续。');
      return;
    }
    if (!lesson.initialCompletionChecked) {
      const state = playlistState();
      if (state.next !== undefined) lesson.initialCompletionChecked = true;
      if (state.currentComplete) {
        // Only inspect the entry state: a new near-end completion must not cut playback short.
        lesson.advanced = true;
        if (!video.paused) video.pause();
        advancePlaylist(lesson);
        return;
      }
    }
    if (!lesson.backgroundConfigured) {
      lesson.backgroundConfigured = !video.dispatchEvent(new Event('uestc-course-helper:keep-playing-in-background', {
        bubbles: true,
        cancelable: true,
      }));
    }
    if (!video.paused && !video.ended) {
      lesson.started = true;
      lesson.attempted = true;
      lesson.resumeOnReturn = false;
      const state = video.readyState < 3 ? '正在缓冲' : video.muted ? '正在静音播放' : '正在播放';
      setStatus(`${state}（播放器 ${video.playbackRate}×）。`);
    } else if (video.ended) {
      advanceAfterConfirmation(lesson);
    } else if (lesson.started && !lesson.resumeOnReturn) {
      setStatus('视频已暂停，可以在播放器里继续。');
    } else if (!lesson.attempted && video.readyState > 0) {
      // The site's player checks for saved progress after receiving metadata.
      const resume = findResumeButton();
      if (resume && !lesson.resumeClicked) {
        lesson.resumeClicked = true;
        scheduleAutoplay(lesson, 1500);
        setStatus('正在从已保存的进度继续播放…');
        resume.click();
      } else if (!lesson.autoplayAt) {
        scheduleAutoplay(lesson, 4000);
      } else if (!resume && Date.now() >= lesson.autoplayAt) {
        setStatus('正在启动播放…');
        void startPlayback(lesson);
      }
    }
  }

  function showToggle() {
    toggle.textContent = enabled ? '关闭' : '开启';
    toggle.setAttribute('aria-pressed', String(enabled));
    if (catalogButton) {
      const active = catalog.isEnabled();
      catalogButton.disabled = active;
      catalogButton.textContent = active ? '全课程连播中' : '全课程连播';
    }
  }

  toggle.addEventListener('click', () => {
    enabled = !enabled;
    sessionStorage.setItem(sessionKey, enabled ? '1' : '0');
    if (!enabled) catalog?.setEnabled(false);
    lesson?.lookup?.abort();
    lesson = null;
    completionObserver.disconnect();
    showToggle();
    setStatus(enabled ? '正在等待课程播放器…' : '开启后自动播放并切到下一节。');
    update();
  });
  catalogButton?.addEventListener('click', () => {
    if (lesson?.inspectionFailed) {
      lesson.inspectionFailed = false;
      showToggle();
      update();
      return;
    }
    catalog.setEnabled(true);
    enabled = true;
    sessionStorage.setItem(sessionKey, '1');
    showToggle();
    if (lesson?.advanced && (lesson.catalogState?.optional || findNext() === null)) {
      void advanceCatalog(lesson);
    } else {
      update();
    }
  });
  rateSelect.addEventListener('change', () => {
    playbackRate = Number(rateSelect.value);
    sessionStorage.setItem(rateKey, String(playbackRate));
    update(true);
  });
  document.addEventListener('ended', event => {
    if (event.isTrusted && event.target === lesson?.video) update();
  }, true);
  document.addEventListener('pause', event => {
    const current = lesson;
    if (!event.isTrusted || event.target !== current?.video) return;
    const backgroundPause = Date.now() <= current.backgroundPauseUntil;
    current.backgroundPauseUntil = 0;
    if (!canRecoverPause(current)) return;
    const handled = !current.video.dispatchEvent(new Event('uestc-course-helper:resume-timed-pause', {
      bubbles: true,
      cancelable: true,
    }));
    if (handled) {
      setStatus('检测到播放器定时暂停，正在续播…');
      return;
    }
    if (backgroundPause) void recoverBackgroundPause(current, true);
  }, true);
  window.addEventListener('visibilitychange', () => onBackgroundChange(document.hidden), true);
  window.addEventListener('blur', event => {
    if (event.target === window) onBackgroundChange(true);
  }, true);
  window.addEventListener('focus', event => {
    if (event.target === window) onBackgroundChange(false);
  }, true);
  for (const type of ['loadedmetadata', 'canplay', 'playing']) {
    document.addEventListener(type, event => {
      if (event.target.matches?.('#player video')) update(true);
    }, true);
  }
  setInterval(update, 800);
  showToggle();
  setStatus(enabled ? '正在等待课程播放器…' : '开启后自动播放并切到下一节。');
  update();
})();
