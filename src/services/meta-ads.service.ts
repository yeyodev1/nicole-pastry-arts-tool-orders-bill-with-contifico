import axios from 'axios';

class MetaAdsService {
  private baseUrl = (process.env.METRICS_API_URL || 'http://localhost:8102').replace(/\/$/, '');
  private token = process.env.METRICS_API_TOKEN || '';

  async getInsights(clientId: string, adAccountId: string, datePreset: string = 'this_month') {
    try {
      const url = `${this.baseUrl}/api/meta/${clientId}/ads-insights`;
      console.log(`[MetaAdsService] Requesting: ${url} with account: ${adAccountId}`);

      const response = await axios.get(url, {
        params: { adAccountId, datePreset },
        headers: { Authorization: `Bearer ${this.token}` },
        timeout: 25000
      });
      return response.data;
    } catch (error: any) {
      console.error(`❌ MetaAdsService Error:`, error.response?.data || error.message);
      throw error;
    }
  }
}

export default new MetaAdsService();
