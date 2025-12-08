import { env } from '../env';

export interface ProxyConfig {
  http: string;
  https: string;
}

/**
 * Proxy service for managing rotating proxies
 */
class ProxyService {
  private proxies: ProxyConfig[] = [];
  private lastRefresh: Date | null = null;
  private refreshInterval = 5 * 60 * 1000; // 5 minutes

  /**
   * Refresh the proxy list from WebShare.io
   */
  async refreshProxyList(): Promise<void> {
    if (!env.PROXY_URL) {
      this.proxies = [];
      return;
    }

    try {
      const response = await fetch(env.PROXY_URL);

      if (!response.ok) {
        console.error(`Failed to fetch proxy list: ${response.status}`);
        return;
      }

      const text = await response.text();
      const newProxies: ProxyConfig[] = [];

      for (const line of text.trim().split('\n')) {
        if (!line.trim()) continue;

        const parts = line.trim().split(':');
        if (parts.length >= 4) {
          const [ip, port, username, password] = parts;
          const proxyStr = `http://${username}:${password}@${ip}:${port}`;
          newProxies.push({
            http: proxyStr,
            https: proxyStr
          });
        }
      }

      this.proxies = newProxies;
      this.lastRefresh = new Date();
      console.log(`Loaded ${this.proxies.length} proxies`);
    } catch (error) {
      console.error('Error fetching proxy list:', error);
    }
  }

  /**
   * Get a random proxy from the pool
   */
  async getRandomProxy(): Promise<ProxyConfig | undefined> {
    // Refresh if needed
    if (!this.lastRefresh || Date.now() - this.lastRefresh.getTime() > this.refreshInterval) {
      await this.refreshProxyList();
    }

    if (this.proxies.length === 0) {
      return undefined;
    }

    const index = Math.floor(Math.random() * this.proxies.length);
    return this.proxies[index];
  }

  /**
   * Get proxy count
   */
  get count(): number {
    return this.proxies.length;
  }

  /**
   * Check if proxies are available
   */
  get hasProxies(): boolean {
    return this.proxies.length > 0;
  }
}

// Singleton instance
export const proxyService = new ProxyService();
