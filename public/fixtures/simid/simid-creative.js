/**
 * Minimal creative-side SIMID 1.1 protocol library shared by the sample
 * creatives in this folder. It implements only the standard protocol, so the
 * samples work in any SIMID-compliant player, not just this emulator:
 *
 *   - sends createSession on load and resolves player messages
 *   - surfaces init/startCreative/media events through simple hooks
 *   - exposes promise-based request helpers for creative-to-player messages
 *
 * Usage:
 *   const simid = new SimidCreative();
 *   simid.onStart = () => { ... };
 *   simid.connect();
 */
(function (global) {
  'use strict';

  var PROTOCOL = {
    CREATE_SESSION: 'createSession',
    RESOLVE: 'resolve',
    REJECT: 'reject'
  };

  var PLAYER = {
    INIT: 'SIMID:Player:init',
    LOG: 'SIMID:Player:log',
    RESIZE: 'SIMID:Player:resize',
    START_CREATIVE: 'SIMID:Player:startCreative',
    AD_SKIPPED: 'SIMID:Player:adSkipped',
    AD_STOPPED: 'SIMID:Player:adStopped',
    FATAL_ERROR: 'SIMID:Player:fatalError'
  };

  var MEDIA_PREFIX = 'SIMID:Media:';

  var CREATIVE = {
    CLICK_THRU: 'SIMID:Creative:clickThru',
    FATAL_ERROR: 'SIMID:Creative:fatalError',
    GET_MEDIA_STATE: 'SIMID:Creative:getMediaState',
    LOG: 'SIMID:Creative:log',
    REPORT_TRACKING: 'SIMID:Creative:reportTracking',
    REQUEST_CHANGE_AD_DURATION: 'SIMID:Creative:requestChangeAdDuration',
    REQUEST_CHANGE_VOLUME: 'SIMID:Creative:requestChangeVolume',
    REQUEST_EXIT_FULL_SCREEN: 'SIMID:Creative:requestExitFullscreen',
    REQUEST_FULL_SCREEN: 'SIMID:Creative:requestFullScreen',
    REQUEST_PAUSE: 'SIMID:Creative:requestPause',
    REQUEST_PLAY: 'SIMID:Creative:requestPlay',
    REQUEST_RESIZE: 'SIMID:Creative:requestResize',
    REQUEST_SKIP: 'SIMID:Creative:requestSkip',
    REQUEST_STOP: 'SIMID:Creative:requestStop'
  };

  function generateSessionId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function SimidCreative() {
    this.sessionId = generateSessionId();
    this.nextMessageId = 0;
    this.pending = {};
    this.environmentData = null;
    this.creativeData = null;

    this.onInit = null;
    this.onStart = null;
    this.onAdSkipped = null;
    this.onAdStopped = null;
    this.onPlayerFatalError = null;
    this.onMediaEvent = null;
    this.onAnyMessage = null;

    this._listener = this._handleMessage.bind(this);
  }

  SimidCreative.prototype.connect = function () {
    window.addEventListener('message', this._listener);
    this._post(PROTOCOL.CREATE_SESSION, {});
  };

  SimidCreative.prototype._post = function (type, args, handlers) {
    var message = {
      sessionId: this.sessionId,
      messageId: this.nextMessageId,
      timestamp: Date.now(),
      type: type,
      args: args || {}
    };
    this.nextMessageId += 1;
    if (handlers) {
      this.pending[message.messageId] = handlers;
    }
    window.parent.postMessage(JSON.stringify(message), '*');
    if (this.onAnyMessage) {
      this.onAnyMessage('out', message);
    }
    return message.messageId;
  };

  SimidCreative.prototype.request = function (type, args) {
    var self = this;
    return new Promise(function (resolve, reject) {
      self._post(type, args, { resolve: resolve, reject: reject });
    });
  };

  SimidCreative.prototype.resolveMessage = function (incoming, value) {
    this._post(PROTOCOL.RESOLVE, { messageId: incoming.messageId, value: value || {} });
  };

  SimidCreative.prototype.rejectMessage = function (incoming, errorCode, message) {
    this._post(PROTOCOL.REJECT, {
      messageId: incoming.messageId,
      value: { errorCode: errorCode, message: message }
    });
  };

  SimidCreative.prototype._handleMessage = function (event) {
    var data = event.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch (err) {
        return;
      }
    }
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
      return;
    }
    if (data.sessionId !== this.sessionId) {
      return;
    }
    if (this.onAnyMessage) {
      this.onAnyMessage('in', data);
    }

    if (data.type === PROTOCOL.RESOLVE || data.type === PROTOCOL.REJECT) {
      var args = data.args || {};
      var handlers = this.pending[args.messageId];
      if (handlers) {
        delete this.pending[args.messageId];
        if (data.type === PROTOCOL.RESOLVE) {
          handlers.resolve(args.value);
        } else {
          handlers.reject(args.value);
        }
      }
      return;
    }

    if (data.type === PLAYER.INIT) {
      var initArgs = data.args || {};
      this.environmentData = initArgs.environmentData || null;
      this.creativeData = initArgs.creativeData || null;
      if (this.onInit) {
        this.onInit(this.environmentData, this.creativeData);
      }
      this.resolveMessage(data, {});
      return;
    }

    if (data.type === PLAYER.START_CREATIVE) {
      if (this.onStart) {
        this.onStart();
      }
      this.resolveMessage(data, {});
      return;
    }

    if (data.type === PLAYER.AD_SKIPPED) {
      if (this.onAdSkipped) {
        this.onAdSkipped();
      }
      this.resolveMessage(data, {});
      return;
    }

    if (data.type === PLAYER.AD_STOPPED) {
      if (this.onAdStopped) {
        this.onAdStopped((data.args || {}).code);
      }
      this.resolveMessage(data, {});
      return;
    }

    if (data.type === PLAYER.FATAL_ERROR) {
      if (this.onPlayerFatalError) {
        this.onPlayerFatalError(data.args || {});
      }
      this.resolveMessage(data, {});
      return;
    }

    if (data.type.indexOf(MEDIA_PREFIX) === 0) {
      if (this.onMediaEvent) {
        this.onMediaEvent(data.type.slice(MEDIA_PREFIX.length), data.args || {});
      }
      return;
    }

    if (data.type === PLAYER.LOG || data.type === PLAYER.RESIZE) {
      this.resolveMessage(data, {});
    }
  };

  SimidCreative.prototype.requestPause = function () {
    return this.request(CREATIVE.REQUEST_PAUSE, {});
  };
  SimidCreative.prototype.requestPlay = function () {
    return this.request(CREATIVE.REQUEST_PLAY, {});
  };
  SimidCreative.prototype.requestSkip = function () {
    return this.request(CREATIVE.REQUEST_SKIP, {});
  };
  SimidCreative.prototype.requestStop = function () {
    return this.request(CREATIVE.REQUEST_STOP, {});
  };
  SimidCreative.prototype.clickThru = function (x, y, playerHandles) {
    return this.request(CREATIVE.CLICK_THRU, {
      x: x || 0,
      y: y || 0,
      playerHandles: playerHandles !== false
    });
  };
  SimidCreative.prototype.reportTracking = function (urls) {
    return this.request(CREATIVE.REPORT_TRACKING, { trackingUrls: urls });
  };
  SimidCreative.prototype.getMediaState = function () {
    return this.request(CREATIVE.GET_MEDIA_STATE, {});
  };
  SimidCreative.prototype.requestChangeVolume = function (volume, muted) {
    return this.request(CREATIVE.REQUEST_CHANGE_VOLUME, { volume: volume, muted: muted });
  };
  SimidCreative.prototype.requestFullScreen = function () {
    return this.request(CREATIVE.REQUEST_FULL_SCREEN, {});
  };
  SimidCreative.prototype.requestExitFullScreen = function () {
    return this.request(CREATIVE.REQUEST_EXIT_FULL_SCREEN, {});
  };
  SimidCreative.prototype.requestChangeAdDuration = function (duration) {
    return this.request(CREATIVE.REQUEST_CHANGE_AD_DURATION, { duration: duration });
  };
  SimidCreative.prototype.requestResize = function (creativeDimensions, mediaDimensions) {
    return this.request(CREATIVE.REQUEST_RESIZE, {
      creativeDimensions: creativeDimensions,
      mediaDimensions: mediaDimensions
    });
  };
  SimidCreative.prototype.log = function (message) {
    return this._post(CREATIVE.LOG, { message: message });
  };
  SimidCreative.prototype.fatalError = function (errorCode, message) {
    return this._post(CREATIVE.FATAL_ERROR, { errorCode: errorCode, message: message });
  };

  global.SimidCreative = SimidCreative;
  global.SIMID_CREATIVE_MESSAGES = CREATIVE;
})(window);
