import axios from 'axios';
import 'dotenv/config'

console.log('META_ADS_SERVICE_URL: ', process.env.META_ADS_SERVICE_URL)
console.log('METAAADS_API_TOKEN: ', process.env.METAAADS_API_TOKEN)

class MetaAdsService {
  private baseUrl = (process.env.META_ADS_SERVICE_URL || 'https://ads-bakano-clients-backapp.vercel.app/api/meta').replace(/\/$/, '');
  private token = process.env.METAAADS_API_TOKEN || '';

  async getInsights(clientId: string, adAccountId: string, datePreset: string = 'this_month') {
    try {
      const response = await axios.get(`${this.baseUrl}/${clientId}/ads-insights`, {
        params: {
          adAccountId,
          datePreset
        },
        headers: {
          // If the API expects a token, we should pass it here. 
          // Since the error was "No token provided", it likely expects an Authorization header.
          'Authorization': `Bearer ${this.token}`
        }
      });
      return response.data;
    } catch (error: any) {
      console.error(`❌ MetaAdsService Error:`, error.response?.data || error.message);
      throw error;
    }
  }
}

export default new MetaAdsService();
