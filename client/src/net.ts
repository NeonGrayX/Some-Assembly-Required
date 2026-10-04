export type NetStatus = 'connecting' | 'online' | 'offline';

/**
 * M0 connection to the game server. Only reports whether the server is reachable;
 * the multiplayer protocol arrives in M3. The game runs fine without a server.
 */
export function connect(onStatus: (s: NetStatus) => void): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let retry = 1000;
  const open = () => {
    onStatus('connecting');
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 1000;
      onStatus('online');
    };
    ws.onclose = () => {
      onStatus('offline');
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 15000);
    };
  };
  open();
}
