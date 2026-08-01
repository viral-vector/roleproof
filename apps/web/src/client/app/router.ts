import { createRouter, createWebHistory } from 'vue-router';

import AnalyzeView from '../features/analyze/AnalyzeView.vue';
import HistoryDetailView from '../features/history/HistoryDetailView.vue';
import HistoryView from '../features/history/HistoryView.vue';
import HomeView from '../features/home/HomeView.vue';
import SettingsView from '../features/settings/SettingsView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/analyze', component: AnalyzeView },
    { path: '/history', component: HistoryView },
    { path: '/history/:id', component: HistoryDetailView },
    { path: '/settings', component: SettingsView },
  ],
});
