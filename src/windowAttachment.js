function createWindowAttachmentService(options) {
  const {
    tabs,
    windows,
    pendingWindowOpens,
    nowUnix,
    clearClosedTabCleanup,
    broadcast,
    log = console.log,
  } = options;

  function getTab(threadId) {
    return tabs.get(threadId) || null;
  }

  function normalizePid(value) {
    const pid = Number.parseInt(value, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  }

  function applyTabWindowState(threadId, nextState, options = {}) {
    const { broadcastUpdate = true, touchUpdatedAt = true } = options;
    const tab = getTab(threadId);
    if (!tab) {
      return { changed: false, tab: null };
    }

    const nextPid = normalizePid(nextState?.windowPid);
    const nextStatus = nextState?.windowStatus === 'attached' ? 'attached' : 'closed';
    const changed = tab.windowPid !== nextPid || tab.windowStatus !== nextStatus;

    tab.windowPid = nextPid;
    tab.windowStatus = nextStatus;
    if (nextStatus !== 'closed') {
      clearClosedTabCleanup(threadId);
    }
    if (touchUpdatedAt && changed) {
      tab.updatedAt = nowUnix();
    }
    if (broadcastUpdate && changed) {
      broadcast({ type: 'tab_updated', tab });
    }

    return { changed, tab };
  }

  async function snapshotDiscoveredWindows() {
    const map = new Map();
    const discovered = await windows.listResumeWindows();
    for (const entry of discovered) {
      map.set(entry.threadId, entry);
    }
    return map;
  }

  async function checkTrackedWindow(threadId) {
    const tab = getTab(threadId);
    const pid = windows.getPid(threadId) || normalizePid(tab?.windowPid);
    if (!pid) {
      return null;
    }

    let alive = false;
    try {
      alive = await windows.isPidAlive(pid);
    } catch (error) {
      log(`[window] failed checking pid ${pid} for ${threadId}: ${error.message}`);
      alive = false;
    }

    if (!alive) {
      windows.clearPid(threadId);
      return null;
    }

    return { threadId, pid, source: 'tracked' };
  }

  async function findDiscoveredWindow(threadId, discoveredWindows = null) {
    if (discoveredWindows instanceof Map) {
      return discoveredWindows.get(threadId) || null;
    }
    try {
      return await windows.findResumeWindow(threadId);
    } catch (error) {
      log(`[window] failed discovering resume window for ${threadId}: ${error.message}`);
      return null;
    }
  }

  async function launchWindow(threadId) {
    let pendingOpen = pendingWindowOpens.get(threadId);
    if (!pendingOpen) {
      pendingOpen = windows.openWindow(threadId).finally(() => {
        pendingWindowOpens.delete(threadId);
      });
      pendingWindowOpens.set(threadId, pendingOpen);
    }

    const pid = await pendingOpen;
    windows.rememberPid(threadId, pid);
    return { threadId, pid, source: 'launched' };
  }

  async function refreshTabWindowStatus(threadId, options = {}) {
    const {
      allowDiscovery = true,
      allowLaunch = false,
      broadcastUpdate = true,
      touchUpdatedAt = true,
      discoveredWindows = null,
    } = options;

    const tab = getTab(threadId);
    if (!tab) {
      return { status: 'missing', tab: null, pid: null, source: 'missing' };
    }

    let attachment = null;
    if (allowDiscovery) {
      const discovered = await findDiscoveredWindow(threadId, discoveredWindows);
      if (discovered?.pid) {
        windows.rememberPid(threadId, discovered.pid);
        attachment = {
          threadId,
          pid: discovered.pid,
          source: discovered.source || 'discovered',
        };
      }
    }

    if (!attachment) {
      attachment = await checkTrackedWindow(threadId);
    }

    if (attachment?.pid) {
      const result = applyTabWindowState(threadId, {
        windowPid: attachment.pid,
        windowStatus: 'attached',
      }, {
        broadcastUpdate,
        touchUpdatedAt,
      });
      return {
        status: 'attached',
        tab: result.tab,
        pid: attachment.pid,
        source: attachment.source,
        changed: result.changed,
      };
    }

    if (allowLaunch) {
      const launched = await launchWindow(threadId);
      const result = applyTabWindowState(threadId, {
        windowPid: launched.pid,
        windowStatus: 'attached',
      }, {
        broadcastUpdate,
        touchUpdatedAt,
      });
      return {
        status: 'attached',
        tab: result.tab,
        pid: launched.pid,
        source: launched.source,
        changed: result.changed,
      };
    }

    windows.clearPid(threadId);
    const result = applyTabWindowState(threadId, {
      windowPid: null,
      windowStatus: 'closed',
    }, {
      broadcastUpdate,
      touchUpdatedAt,
    });
    return {
      status: 'closed',
      tab: result.tab,
      pid: null,
      source: 'none',
      changed: result.changed,
    };
  }

  async function refreshAllTabsWindowStatus(options = {}) {
    const { broadcastUpdates = true, touchUpdatedAt = true } = options;
    let discoveredWindows = null;
    try {
      discoveredWindows = await snapshotDiscoveredWindows();
    } catch (error) {
      log(`[window] failed listing resume windows: ${error.message}`);
    }

    const checks = Array.from(tabs.keys()).map((threadId) => refreshTabWindowStatus(threadId, {
      allowDiscovery: true,
      allowLaunch: false,
      broadcastUpdate: broadcastUpdates,
      touchUpdatedAt,
      discoveredWindows,
    }));
    await Promise.allSettled(checks);
  }

  function markTabClosed(threadId, options = {}) {
    windows.clearPid(threadId);
    return applyTabWindowState(threadId, {
      windowPid: null,
      windowStatus: 'closed',
    }, {
      broadcastUpdate: options.broadcastUpdate !== false,
      touchUpdatedAt: options.touchUpdatedAt !== false,
    }).tab;
  }

  return {
    markTabClosed,
    refreshTabWindowStatus,
    refreshAllTabsWindowStatus,
    snapshotDiscoveredWindows,
  };
}

module.exports = { createWindowAttachmentService };
