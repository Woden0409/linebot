const fs = require('node:fs');
const path = require('node:path');

const byCreatedAt = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);

// 正取／備取一律由報名時間先後決定，因此有人取消時後面自動遞補，不需另外記狀態。
class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = { groups: {}, announced: {} };
    this.queue = Promise.resolve();
    try {
      this.state = { announced: {}, ...JSON.parse(fs.readFileSync(this.filePath, 'utf8')) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  update(action) {
    const job = this.queue.then(async () => {
      const result = action(this.state);
      await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      await fs.promises.writeFile(temporary, JSON.stringify(this.state, null, 2));
      await fs.promises.rename(temporary, this.filePath);
      return result;
    });
    this.queue = job.catch(() => {});
    return job;
  }

  bucket(groupId, eventDate) {
    return this.state.groups[groupId]?.events[eventDate]?.entries || [];
  }

  async getEntries(groupId, eventDate) {
    return [...this.bucket(groupId, eventDate)].sort(byCreatedAt);
  }

  register(groupId, eventDate, player) {
    return this.update((state) => {
      const group = (state.groups[groupId] ||= { events: {} });
      const event = (group.events[eventDate] ||= { entries: [] });
      if (event.entries.some((entry) => entry.userId === player.userId)) {
        return { status: 'duplicate', entries: [...event.entries].sort(byCreatedAt) };
      }
      event.entries.push({ ...player, createdAt: new Date().toISOString() });
      return { status: 'registered', entries: [...event.entries].sort(byCreatedAt) };
    });
  }

  cancel(groupId, eventDate, userId) {
    return this.update((state) => {
      const entries = state.groups[groupId]?.events[eventDate]?.entries;
      const index = entries ? entries.findIndex((entry) => entry.userId === userId) : -1;
      if (index < 0) return { status: 'not_found', entries: [...(entries || [])].sort(byCreatedAt) };
      const [removed] = entries.splice(index, 1);
      return { status: 'cancelled', removed, entries: [...entries].sort(byCreatedAt) };
    });
  }

  async listGroups(eventDate) {
    return Object.entries(this.state.groups)
      .filter(([, group]) => (group.events[eventDate]?.entries || []).length)
      .map(([groupId]) => groupId);
  }

  async wasAnnounced(groupId, eventDate) {
    return Boolean(this.state.announced[`${groupId}|${eventDate}`]);
  }

  markAnnounced(groupId, eventDate) {
    return this.update((state) => {
      state.announced[`${groupId}|${eventDate}`] = new Date().toISOString();
    });
  }
}

class SupabaseStore {
  constructor(url, serviceKey) {
    this.base = `${url.replace(/\/$/, '')}/rest/v1`;
    this.headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    };
  }

  async request(pathname, options = {}) {
    const response = await fetch(`${this.base}${pathname}`, { ...options, headers: { ...this.headers, ...options.headers } });
    const body = await response.text();
    if (!response.ok) {
      const error = new Error(`Supabase ${response.status}: ${body}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body ? JSON.parse(body) : null;
  }

  async getEntries(groupId, eventDate) {
    const rows = await this.request(
      `/linebot_registrations?group_id=eq.${encodeURIComponent(groupId)}&event_date=eq.${eventDate}&order=created_at.asc`
    );
    return rows.map((row) => ({ userId: row.user_id, name: row.name, createdAt: row.created_at }));
  }

  async register(groupId, eventDate, player) {
    try {
      await this.request('/linebot_registrations', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ group_id: groupId, event_date: eventDate, user_id: player.userId, name: player.name })
      });
    } catch (error) {
      // 23505 = 主鍵重複，代表同一個 LINE 使用者已經報過名。
      if (error.status === 409 || String(error.body).includes('23505')) {
        return { status: 'duplicate', entries: await this.getEntries(groupId, eventDate) };
      }
      throw error;
    }
    return { status: 'registered', entries: await this.getEntries(groupId, eventDate) };
  }

  async cancel(groupId, eventDate, userId) {
    const removed = await this.request(
      `/linebot_registrations?group_id=eq.${encodeURIComponent(groupId)}&event_date=eq.${eventDate}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: 'DELETE', headers: { Prefer: 'return=representation' } }
    );
    const entries = await this.getEntries(groupId, eventDate);
    if (!removed || !removed.length) return { status: 'not_found', entries };
    return { status: 'cancelled', removed: { userId, name: removed[0].name }, entries };
  }

  async listGroups(eventDate) {
    const rows = await this.request(`/linebot_registrations?event_date=eq.${eventDate}&select=group_id`);
    return [...new Set(rows.map((row) => row.group_id))];
  }

  async wasAnnounced(groupId, eventDate) {
    const rows = await this.request(
      `/linebot_announcements?group_id=eq.${encodeURIComponent(groupId)}&event_date=eq.${eventDate}&select=group_id`
    );
    return rows.length > 0;
  }

  async markAnnounced(groupId, eventDate) {
    await this.request('/linebot_announcements', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ group_id: groupId, event_date: eventDate })
    });
  }
}

function createStore(env) {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return new JsonStore(path.join(__dirname, '..', 'data', 'registrations.json'));
}

module.exports = { JsonStore, SupabaseStore, createStore };
