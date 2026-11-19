(() => {
  'use strict';

  if (location.pathname.replace(/\/$/, '') !== '/jjfz/play') return;

  let stalePause = null;

  document.addEventListener('play', event => {
    const { player, loopPause } = window.__xg ?? {};
    if (event.isTrusted && event.target === (player?.media ?? player?.video)) {
      // A manual restart can leave the timer's paused flag set from an earlier pause.
      stalePause = loopPause?.isPaused() ? loopPause : null;
    }
  }, true);

  document.addEventListener('uestc-course-helper:keep-playing-in-background', event => {
    const instance = window.__xg;
    const video = instance?.player?.media ?? instance?.player?.video;
    if (!video || event.target !== video || typeof instance.removeAutoPause !== 'function') return;

    instance.removeAutoPause();
    event.preventDefault();
  });

  document.addEventListener('uestc-course-helper:resume-timed-pause', event => {
    const { player, loopPause } = window.__xg ?? {};
    const video = player?.media ?? player?.video;
    if (!video || event.target !== video || !video.paused || video.ended) return;
    if (!loopPause || loopPause === stalePause || !loopPause.isPaused()) return;

    if (loopPause.resume()) event.preventDefault();
  });
})();
