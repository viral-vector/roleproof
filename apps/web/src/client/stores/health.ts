import { defineStore } from 'pinia';

import { getHealth, type LocalHealth } from '../api/client.js';

export type HealthState = 'checking' | 'ready' | 'unavailable';

export const useHealthStore = defineStore('health', {
  state: (): { status: HealthState; details: LocalHealth | null } => ({
    status: 'checking',
    details: null,
  }),
  actions: {
    async refresh() {
      this.status = 'checking';
      try {
        this.details = await getHealth();
        this.status = 'ready';
      } catch {
        this.details = null;
        this.status = 'unavailable';
      }
    },
  },
});
