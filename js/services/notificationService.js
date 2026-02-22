/**
 * WebSocket notification service for Genesys Cloud.
 *
 * Manages a single notification channel + WebSocket connection.
 * Supports:
 *   - Dynamic subscribe / unsubscribe (over the socket)
 *   - Auto-reconnect with exponential back-off
 *   - Heartbeat ping/pong
 *   - Polling fallback while disconnected
 */

const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export class NotificationService {
  /**
   * @param {Object}   opts
   * @param {Object}   opts.api              API client (from createApiClient)
   * @param {Function} opts.onEvent          (topicName, eventBody) => void
   * @param {Function} [opts.onStateChange]  ("connected"|"reconnecting"|"polling"|"closed") => void
   * @param {Function} [opts.pollFn]         Async function called every pollInterval when socket is down
   * @param {number}   [opts.pollInterval]   Polling interval in ms (default 15000)
   */
  constructor({ api, onEvent, onStateChange, pollFn, pollInterval = 15_000 }) {
    this._api = api;
    this._onEvent = onEvent;
    this._onStateChange = onStateChange || (() => {});
    this._pollFn = pollFn;
    this._pollInterval = pollInterval;

    this._channelId = null;
    this._ws = null;
    this._topics = new Set();
    this._heartbeatTimer = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;
    this._pollTimer = null;
    this._destroyed = false;
    this._state = "closed";
  }

  /** Create channel + connect. Call once at startup. */
  async connect() {
    if (this._destroyed) return;
    const channel = await this._api.createNotificationChannel();
    this._channelId = channel.id;
    this._connectWs(channel.connectUri);
  }

  /** Subscribe to one or more topic strings. */
  subscribe(topics) {
    const newTopics = topics.filter((t) => !this._topics.has(t));
    if (!newTopics.length) return;
    newTopics.forEach((t) => this._topics.add(t));
    this._sendSubscribe(newTopics);
  }

  /** Unsubscribe from one or more topic strings. */
  unsubscribe(topics) {
    const removed = topics.filter((t) => this._topics.has(t));
    if (!removed.length) return;
    removed.forEach((t) => this._topics.delete(t));
    this._sendUnsubscribe(removed);
  }

  /** Replace all subscriptions with a new set. */
  setTopics(topics) {
    const next = new Set(topics);
    const toAdd = topics.filter((t) => !this._topics.has(t));
    const toRemove = [...this._topics].filter((t) => !next.has(t));
    if (toRemove.length) this.unsubscribe(toRemove);
    if (toAdd.length) this.subscribe(toAdd);
  }

  /** Tear down everything. */
  destroy() {
    this._destroyed = true;
    this._setState("closed");
    this._clearTimers();
    if (this._ws) {
      this._ws.onclose = null;
      this._ws.close();
      this._ws = null;
    }
  }

  // ── Internal ──────────────────────────────────────────────

  _setState(s) {
    if (s === this._state) return;
    this._state = s;
    this._onStateChange(s);
  }

  _connectWs(uri) {
    if (this._destroyed) return;
    this._setState("reconnecting");

    const ws = new WebSocket(uri);
    this._ws = ws;

    ws.onopen = () => {
      this._reconnectAttempts = 0;
      this._setState("connected");
      this._startHeartbeat();
      this._stopPolling();

      // Re-subscribe all current topics
      if (this._topics.size) {
        this._sendSubscribe([...this._topics]);
      }
    };

    ws.onmessage = (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }

      // Heartbeat pong
      if (msg.topicName === "channel.metadata") return;

      // System messages
      if (msg.topicName === "v2.system.socket_closing") {
        // Server maintenance — reconnect proactively
        this._scheduleReconnect();
        return;
      }

      // Subscription confirmation
      if (msg.status === "subscribed" || msg.status === "unsubscribed") return;

      // Real event
      if (msg.topicName && msg.eventBody) {
        this._onEvent(msg.topicName, msg.eventBody);
      }
    };

    ws.onerror = () => {
      // onclose will fire next
    };

    ws.onclose = () => {
      this._stopHeartbeat();
      if (!this._destroyed) {
        this._startPolling();
        this._scheduleReconnect();
      }
    };
  }

  _sendSubscribe(topics) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(
        JSON.stringify({ message: "subscribe", topics }),
      );
    }
  }

  _sendUnsubscribe(topics) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(
        JSON.stringify({ message: "unsubscribe", topics }),
      );
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ message: "ping" }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  async _scheduleReconnect() {
    if (this._destroyed || this._reconnectTimer) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this._reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this._reconnectAttempts++;

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        const channel = await this._api.createNotificationChannel();
        this._channelId = channel.id;
        this._connectWs(channel.connectUri);
      } catch {
        this._scheduleReconnect();
      }
    }, delay);
  }

  _startPolling() {
    if (this._pollTimer || !this._pollFn) return;
    this._setState("polling");
    this._pollTimer = setInterval(() => {
      this._pollFn().catch(() => {});
    }, this._pollInterval);
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _clearTimers() {
    this._stopHeartbeat();
    this._stopPolling();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}
