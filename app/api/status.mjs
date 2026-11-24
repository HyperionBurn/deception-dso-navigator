import { getConfig, json } from '../lib/session-config.mjs';

export default {
  fetch(request) {
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed.' }, 405, { Allow: 'GET' });
    }
    const { agentId, liveReady } = getConfig();
    return json({ live_ready: liveReady, agent_id: agentId });
  },
};
